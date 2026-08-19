# 進撃ゲームコミュニティ サーバー版

Node.js + Express + SQLite + Socket.IO + JWT のサーバー土台です。

## スマホで動かす場合
Androidなら Termux などのNode.js環境、またはGitHubへアップロードしてNode.js対応ホスティングへデプロイできます。

## 起動
1. Node.js 20+ を用意
2. このフォルダで `npm install`
3. `.env` のJWT_SECRETをランダムな長い文字列に変更
4. `npm start`
5. ブラウザで `http://localhost:3000`

## API
- POST /api/register
- POST /api/login
- GET /api/me
- GET/POST /api/posts
- POST /api/posts/:id/like
- GET/POST /api/posts/:id/comments
- GET /api/messages
- GET /api/members
- POST /api/friends/:id
- POST /api/block/:id
- POST /api/report
- GET/POST /api/rooms
- GET/POST /api/videos
- GET /api/notifications
- POST /api/notifications/read

## 本番で追加推奨
- HTTPS
- 本番用JWT_SECRET
- クラウドDB
- 動画用オブジェクトストレージ
- ウイルス/ファイル種別検査
- レート制限
- CSRF/CORS設定
- 管理者画面
- 通報モデレーション
- WebRTC TURNサーバー

※このサーバー版は「バックエンドを動かせる完成土台」です。公開サービスとして使うにはホスティング先へのデプロイと、本番セキュリティ設定が必要です。
