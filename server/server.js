const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });
const upload = multer({ dest: path.join(__dirname, "uploads/") });
const db = new Database(path.join(__dirname, "community.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 icon TEXT DEFAULT '⚔️',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 tag TEXT DEFAULT '雑談',
 likes INTEGER DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS comments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 post_id INTEGER NOT NULL,
 user_id INTEGER NOT NULL,
 body TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 body TEXT NOT NULL,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS friendships(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 from_user INTEGER NOT NULL,
 to_user INTEGER NOT NULL,
 status TEXT DEFAULT 'pending',
 UNIQUE(from_user,to_user)
);
CREATE TABLE IF NOT EXISTS blocks(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 blocked_user INTEGER NOT NULL,
 UNIQUE(user_id,blocked_user)
);
CREATE TABLE IF NOT EXISTS rooms(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 owner_id INTEGER NOT NULL,
 max_users INTEGER DEFAULT 4,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS videos(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 title TEXT NOT NULL,
 url TEXT,
 file_name TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 text TEXT NOT NULL,
 is_read INTEGER DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(__dirname, "../public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

function tokenFor(user){ return jwt.sign({id:user.id, username:user.username}, JWT_SECRET, {expiresIn:"7d"}); }
function auth(req,res,next){
 const h=req.headers.authorization||"";
 try{
  const data=jwt.verify(h.startsWith("Bearer ")?h.slice(7):"",JWT_SECRET);
  const user=db.prepare("SELECT id,username,icon FROM users WHERE id=?").get(data.id);
  if(!user) throw new Error();
  req.user=user; next();
 }catch{res.status(401).json({error:"ログインが必要です"});}
}
function notify(userId,text){
 db.prepare("INSERT INTO notifications(user_id,text) VALUES(?,?)").run(userId,text);
 io.to("user:"+userId).emit("notification",{text});
}

app.post("/api/register",(req,res)=>{
 const {username,password}=req.body;
 if(!username||!password||username.length>30||password.length<6) return res.status(400).json({error:"ユーザー名と6文字以上のパスワードが必要です"});
 try{
  const hash=bcrypt.hashSync(password,10);
  const info=db.prepare("INSERT INTO users(username,password_hash) VALUES(?,?)").run(username,hash);
  const user=db.prepare("SELECT id,username,icon FROM users WHERE id=?").get(info.lastInsertRowid);
  res.json({token:tokenFor(user),user});
 }catch{res.status(409).json({error:"そのユーザー名は使用されています"});}
});
app.post("/api/login",(req,res)=>{
 const {username,password}=req.body;
 const row=db.prepare("SELECT * FROM users WHERE username=?").get(username);
 if(!row||!bcrypt.compareSync(password,row.password_hash)) return res.status(401).json({error:"ログイン情報が違います"});
 const user={id:row.id,username:row.username,icon:row.icon};
 res.json({token:tokenFor(user),user});
});
app.get("/api/me",auth,(req,res)=>res.json(req.user));

app.get("/api/posts",(req,res)=>{
 const rows=db.prepare(`SELECT p.*,u.username,u.icon FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 100`).all();
 res.json(rows);
});
app.post("/api/posts",auth,(req,res)=>{
 const {title,body,tag}=req.body;
 if(!title||!body)return res.status(400).json({error:"タイトルと本文が必要です"});
 const info=db.prepare("INSERT INTO posts(user_id,title,body,tag) VALUES(?,?,?,?)").run(req.user.id,title,body,tag||"雑談");
 const post=db.prepare("SELECT p.*,u.username,u.icon FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?").get(info.lastInsertRowid);
 io.emit("post:new",post); res.json(post);
});
app.post("/api/posts/:id/like",auth,(req,res)=>{
 db.prepare("UPDATE posts SET likes=likes+1 WHERE id=?").run(req.params.id);
 const p=db.prepare("SELECT * FROM posts WHERE id=?").get(req.params.id);
 if(p) notify(p.user_id,`${req.user.username}さんが投稿にいいねしました`);
 io.emit("post:like",{id:+req.params.id}); res.json({ok:true});
});
app.get("/api/posts/:id/comments",(req,res)=>{
 res.json(db.prepare(`SELECT c.*,u.username,u.icon FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.id`).all(req.params.id));
});
app.post("/api/posts/:id/comments",auth,(req,res)=>{
 const {body}=req.body;if(!body)return res.status(400).json({error:"本文が必要です"});
 const info=db.prepare("INSERT INTO comments(post_id,user_id,body) VALUES(?,?,?)").run(req.params.id,req.user.id,body);
 const c=db.prepare(`SELECT c.*,u.username,u.icon FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?`).get(info.lastInsertRowid);
 const p=db.prepare("SELECT user_id FROM posts WHERE id=?").get(req.params.id);if(p&&p.user_id!==req.user.id)notify(p.user_id,`${req.user.username}さんが投稿に返信しました`);
 io.emit("comment:new",c);res.json(c);
});

app.get("/api/messages",auth,(req,res)=>{
 res.json(db.prepare(`SELECT m.id,m.body,m.created_at,u.username,u.icon FROM messages m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 100`).all().reverse());
});

app.get("/api/members",auth,(req,res)=>{
 res.json(db.prepare("SELECT id,username,icon FROM users ORDER BY username LIMIT 100").all());
});
app.post("/api/friends/:id",auth,(req,res)=>{
 const id=+req.params.id;if(id===req.user.id)return res.status(400).json({error:"自分には送れません"});
 try{db.prepare("INSERT INTO friendships(from_user,to_user) VALUES(?,?)").run(req.user.id,id);notify(id,`${req.user.username}さんからフレンド申請が届きました`);res.json({ok:true});}
 catch{res.status(409).json({error:"申請済みです"});}
});
app.post("/api/block/:id",auth,(req,res)=>{
 db.prepare("INSERT OR IGNORE INTO blocks(user_id,blocked_user) VALUES(?,?)").run(req.user.id,+req.params.id);res.json({ok:true});
});
app.post("/api/report",auth,(req,res)=>{
 console.log("REPORT",req.user.username,req.body);
 res.json({ok:true});
});

app.get("/api/rooms",auth,(req,res)=>{
 res.json(db.prepare(`SELECT r.*,u.username owner_name,(SELECT COUNT(*) FROM friendships f WHERE 1=0) dummy FROM rooms r JOIN users u ON u.id=r.owner_id ORDER BY r.id DESC`).all());
});
app.post("/api/rooms",auth,(req,res)=>{
 const {name,maxUsers}=req.body;
 const info=db.prepare("INSERT INTO rooms(name,owner_id,max_users) VALUES(?,?,?)").run(name,req.user.id,maxUsers||4);
 const room=db.prepare(`SELECT r.*,u.username owner_name FROM rooms r JOIN users u ON u.id=r.owner_id WHERE r.id=?`).get(info.lastInsertRowid);
 io.emit("room:new",room);res.json(room);
});

app.get("/api/videos",auth,(req,res)=>res.json(db.prepare(`SELECT v.*,u.username FROM videos v JOIN users u ON u.id=v.user_id ORDER BY v.id DESC`).all()));
app.post("/api/videos",auth,upload.single("video"),(req,res)=>{
 const {title,url}=req.body;const fileName=req.file?path.basename(req.file.path):null;
 const info=db.prepare("INSERT INTO videos(user_id,title,url,file_name) VALUES(?,?,?,?)").run(req.user.id,title,url||null,fileName);
 res.json({id:info.lastInsertRowid,title,url,file_name:fileName});
});

app.get("/api/notifications",auth,(req,res)=>res.json(db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50").all(req.user.id)));
app.post("/api/notifications/read",auth,(req,res)=>{db.prepare("UPDATE notifications SET is_read=1 WHERE user_id=?").run(req.user.id);res.json({ok:true});});

io.use((socket,next)=>{
 try{const data=jwt.verify(socket.handshake.auth?.token||"",JWT_SECRET);socket.user=db.prepare("SELECT id,username,icon FROM users WHERE id=?").get(data.id);if(!socket.user)throw 0;next()}
 catch{next(new Error("auth"))}
});
io.on("connection",socket=>{
 socket.join("user:"+socket.user.id);
 socket.on("chat:send",body=>{
  if(typeof body!=="string"||!body.trim())return;
  const info=db.prepare("INSERT INTO messages(user_id,body) VALUES(?,?)").run(socket.user.id,body.trim().slice(0,500));
  const msg={id:info.lastInsertRowid,body:body.trim(),username:socket.user.username,icon:socket.user.icon,created_at:new Date().toISOString()};
  io.emit("chat:message",msg);
 });
 socket.on("room:join",roomId=>socket.join("room:"+roomId));
 socket.on("room:signal",(roomId,data)=>socket.to("room:"+roomId).emit("room:signal",socket.id,data));
 socket.on("room:leave",roomId=>socket.leave("room:"+roomId));
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"../public/index.html")));
server.listen(PORT,()=>console.log(`Server running: http://localhost:${PORT}`));
