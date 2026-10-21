# 仕組みの解説

このデモが裏で何をしているかのメモです。Safie の公開ドキュメントと、SDK 本体
（`https://safie.link/sdk/js/api/v1/latest/`）および SDK が読み込む iframe のコードを読んで確認した内容です
（2026-10 時点、SDK v1.10）。SDK の内部実装は非公開の仕様なので、将来変わる可能性があります。

## 1. 全体像

```
ブラウザ
┌───────────────────────────────────────────────────────────────┐
│ あなたのページ (localhost:8080 / yomei-o.github.io)            │
│   index.html + app.js + Safie SDK (<script src=safie.link/...>)│
│                                                               │
│   ┌ iframe (非表示) safie.link/.../lib/iframe.html#safie-sdk-proxy
│   │   トークン保存・リフレッシュ、REST API 呼び出し              │
│   └──────────────── postMessage ───────────────┐              │
│                                                │              │
│   ┌ iframe (表示) ...#safie-sdk-streaming-player│              │
│   │   <video>、HLS / WebRTC で映像取得          │              │
│   └─────────────────────────────────────────────┘              │
└───────────────────────────────────────────────────────────────┘
        │ HTML/JS の配信だけ                 │ API・映像
        ▼                                    ▼
  server.cpp / serve.py / GitHub Pages   openapi.safie.link
```

- **ローカルのサーバー（cpp-httplib / Python）や GitHub Pages は静的ファイルを配るだけ**です。
  Safie との通信には一切関わりません。だから同じコードがどこに置いても動きます。
- Safie との通信はすべて、SDK がページに埋め込む **`https://safie.link` オリジンの iframe** が行います。

## 2. なぜ SDK が必要か（CORS）

Safie の REST API `https://openapi.safie.link` は、CORS の許可ヘッダー
`Access-Control-Allow-Origin` を **`https://safie.link` オリジンにしか返しません**。
`localhost` や `yomei-o.github.io` のページから `fetch` すると、ブラウザがレスポンスをブロックします
（トークンエンドポイント `/v2/auth/token` も同じ）。

```sh
# Origin: https://safie.link → 200 + access-control-allow-origin: https://safie.link
# Origin: http://localhost:3000 → 400、allow-origin ヘッダーなし
curl -s -D - -o /dev/null -X OPTIONS https://openapi.safie.link/v2/devices \
  -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: GET"
```

SDK はこれを「回避」しているのではなく、**API を呼ぶのが最初から safie.link 自身**という構成になっています。

## 3. ページと iframe の通信（postMessage）

1. `<script src="https://safie.link/sdk/js/api/v1/latest/">` を読むと、SDK は自分の URL から
   `.../lib/iframe.html` を組み立て、`display:none` の iframe（`#safie-sdk-proxy`）をページに追加します。
2. 親ページと iframe は `syn` → `ack` → `connected` のハンドシェイクをします。secure context のときは
   RSA-OAEP + AES-GCM で鍵交換して、以降のメッセージを暗号化します。
   **SDK が `http://localhost` か `https` を要求するのはこのため**（Web Crypto が secure context 限定）です。
   LAN の IP アドレス + http では動きません。
3. `Safie.Devices.queryDevices()` などを呼ぶと、SDK は `invoke` メッセージを iframe に送ります。
   iframe が `openapi.safie.link` を叩き、結果を `invoke_result` で返します。
4. 受信側は `event.origin` を確認し、想定外のオリジンからのメッセージは無視します。

`postMessage` は別オリジンのウィンドウ同士で安全にメッセージを渡すためのブラウザ標準の仕組みで、CORS の対象外です。

## 4. 認可の流れ（Public クライアント + PKCE）

Client 種別 **Public** は Client Secret を持たず、PKCE（RFC 7636）で認可コードを守る方式です。
2026/10/15 のリリースで追加されました（それ以前に作られたアプリはすべて Confidential）。

| 手順 | app.js | SDK が内部でやること |
|---|---|---|
| 1 | `Safie.Auth.authorize({clientId, redirectUri, scope, rememberMe, enableTokenRefresh})` | `code_verifier` を生成・保存し、`code_challenge`（S256）付きで `GET /v2/auth/authorize` へ遷移 |
| 2 | （Safie のログイン画面でユーザーが ID / パスワードを入力して許可） | |
| 3 | `redirectUri?code=...&state=...` に戻る | |
| 4 | `Safie.Auth.initialize({clientId})` | `POST /v2/auth/token` に `code` + `code_verifier` を送ってトークン取得、URL から `code`/`state` を除去 |
| 5 | `Safie.Devices.*` / `Safie.Player.*` | 保存したアクセストークンで API を呼ぶ。期限切れはリフレッシュトークンで自動更新 |

- `redirectUri` は Safie Developers に登録した URL と**末尾のスラッシュまで完全一致**が必要です。
  app.js は「今開いているページの URL からクエリと `index.html` を除いたもの」を使います。
- Redirect URI ごとに Client を作ります（1 アプリ 2 つまで）。このデモは localhost 用と GitHub Pages 用で
  Client ID を分け、ホスト名で初期値を切り替えています。
- Public 種別は OIDC の利用が必須です。Client 種別と OIDC 設定は作成後に変更できません。

## 5. 認可で得られるもの

`/v2/auth/token` のレスポンス:

| 項目 | 中身 |
|---|---|
| `access_token` | API を呼ぶ鍵。有効期限は `expires_in` 秒（例: 604800 = 7 日） |
| `refresh_token` | アクセストークン更新用。使うたびに新しいものに入れ替わり、古いものは無効になる |
| `token_type` | `Bearer` |
| `id_token` | scope に `openid` を含めたときだけ。ログインしたユーザーを表す JWT（ES256 署名） |

**メールアドレスは ID トークンのクレームの 1 つ**です。単独では返りません。

- 常に入る: `sub`（ユーザー ID）、`iss`、`aud`（= Client ID）、`exp`、`iat`、`auth_time`、`at_hash`、`nonce`
- `email`、`email_verified` は、アプリ作成時に「ID情報 + メールアドレス情報」を選んだ（`email` スコープ）ときだけ

**SDK 経由の場合、ページの JS から見えるのは ID トークンだけ**です。

| | ページの JS から |
|---|---|
| ID トークン | 見える（`initialize()` の戻り値 `idToken`）。デモの「状態」欄の `sub` / `email` はこれをデコードしたもの |
| アクセストークン | 見えない（iframe = safie.link オリジンのストレージに保存） |
| リフレッシュトークン | 見えない（同上。`enableTokenRefresh: true` で SDK が自動更新） |

ID トークンを表示に使うだけならデコードで十分です。SDK が検証するのは `nonce` だけなので、
**本人確認の根拠として自前サーバーで使うなら、署名（`/v2/auth/jwks` の公開鍵）と `iss` / `aud` / `exp` をサーバー側で検証**してください。

アクセストークンを自分で持ちたい（自前サーバーから API を叩きたい）場合は、SDK の `authorize` は使えません。
トークン交換もブラウザからは CORS で拒否されるので、その用途なら Confidential 種別でサーバー側で交換するのが素直です。

## 6. 動画の再生経路

`new Safie.Player.StreamingPlayer(element, config)` を作ると、SDK は `element` の中に
**見える iframe**（`...lib/iframe.html#safie-sdk-streaming-player`）を入れます。画面の動画はこの iframe の中の `<video>` です。

| モード | 取得方法 |
|---|---|
| HLS（既定） | iframe が `openapi.safie.link/v2/devices/{id}/live/playlist.m3u8` を hls.js で再生。録画は `.../vod/playlist.m3u8?timestamp=...&playback_rate=...` |
| WebRTC（`liveBroadcastMode: 'webrtc'`、低遅延） | `wss://openapi.safie.link/` でシグナリング → `RTCPeerConnection`（必要に応じて TURN 経由） |

親ページと iframe がやりとりするのは制御とイベントだけです。

- 親 → iframe: `play` / `stop` / `pause` / 音量・ミュート / `deviceId` 切り替え
- iframe → 親: `statusChange`（loading / streaming / paused / error / retrying）、`playTimeChange`

**映像は別オリジンの iframe の中にあるので、ページの JS から `canvas` に描いて解析する、といったことはできません。**
それが必要なら REST API の Live v2（`/v2/devices/{id}/live/playlist`）を使いますが、ブラウザからは CORS で拒否されるので
サーバー側の中継が必要です。また 1 つのアプリに SDK の Player と API の Live v2 は同時に設定できません。

再生に必要なもの:

- scope: `safie-api`、または `api:device:live:view` + `api:device:timeline:view`
- デバイスオプション「ストリーミング SDK」系（トライアルプランは不要）
- アプリケーションの設定で SDK の Player にチェック

## 7. 誰のカメラが見えるのか

**ログインした本人が権限を持つカメラだけ**です。公開ページだからといって、デモの作者のカメラが他人に見えることはありません。

- 「Safie でログイン」した人は自分の Safie ID でログインし、自分のカメラへのアクセスをこのアプリに許可します。
  トークンはそのユーザーに紐づき、`queryDevices` はそのユーザーが権限を持つデバイスだけを返します。
- トークンはログインした人のブラウザ（safie.link オリジンのストレージ）にだけ保存されます。サーバーにも GitHub にも置かれません。
- Client ID が公開されているのは Public 種別の前提どおりです。認可コードは登録済みの Redirect URI にしか返らないので、
  Client ID をコピーして別サイトで使っても認可は成立しません。

気をつける点:

- 誰でも自分のカメラをこのアプリに預けられる状態です。アプリに XSS などがあれば、その人のトークンが漏れる責任はアプリ側にあります。
  デモ用途なら Safie Developers の「アクセス許可」で自分の IP だけに絞ると安心です（SDK 利用時は設定が推奨されています）。
- `rememberMe: true` なのでブラウザを閉じてもセッションが残ります。共用端末では「ログアウト」を押してください
  （SDK が保持するトークンを消すだけで、Safie アカウント自体のログアウトではありません）。

## 8. 公式ガイドラインのサンプルとの違い

[SDK 設計ガイドライン](https://developers.safie.link/guidelines/sdk) のサンプルも、同じ SDK・同じ iframe・同じ
`StreamingPlayer` を使っています。違うのは**アクセストークンを SDK に渡す方法**だけです。

```js
// ガイドラインのサンプル: 外で用意したトークンを手で貼る
await Safie.Auth.initialize();            // clientId なし
await Safie.Auth.setToken(token, type);   // API キー or アクセストークン

// このデモ: SDK がログイン経由で自動取得
await Safie.Auth.authorize({ clientId, redirectUri, scope, ... });
await Safie.Auth.initialize({ clientId });
```

| | ガイドラインのサンプル | このデモ |
|---|---|---|
| トークンの入手 | 外で取得して `window.prompt` で貼る | SDK が PKCE で自動取得 |
| 必要なもの | API キー、または Confidential クライアントでサーバー側が取得したアクセストークン | Public 種別の Client ID だけ |
| 自動更新 | なし（期限切れで貼り直し） | `enableTokenRefresh: true` で自動 |
| 見えるカメラ | API キーに紐づけたデバイス / トークンの持ち主のデバイス | ログインした本人のデバイス |
| 動画再生 | `StreamingPlayer` | 同じ `StreamingPlayer` |

ガイドラインのサンプルは Public 種別ができる前の書き方で、当時はブラウザだけではトークンを取得できませんでした。
アクセストークンが不要になったわけではなく、**SDK が取ってきて隠し持っているので手で扱わなくてよくなった**、という違いです。

ガイドラインのサンプルにあってこのデモにない機能（認証方式に関係なく使えます）:

- `Safie.Users.queryInformation()` でメールアドレスとユーザー名を表示
- `Safie.UIControl.Timeline` でタイムライン UI、カレンダーと再生速度を指定した録画再生

## 参考

- OAuth チュートリアル: https://developers.safie.link/tutorial/oauth
- SDK 設計ガイドライン: https://developers.safie.link/guidelines/sdk
- SDK リファレンス: https://safie.link/sdk/js/api/v1/latest/doc/
- API リファレンス（Auth v2）: https://developers.safie.link/reference/api#tag/Auth-v2
- OpenAPI 定義: https://developers.safie.link/static/openapi.json
