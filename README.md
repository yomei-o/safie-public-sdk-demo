# Safie OAuth2.0 Public クライアント + cpp-httplib サンプル

cpp-httplib で立てた HTTP サーバーが `www/` の静的ファイルを返し、認可（PKCE）・トークン管理・Safie API 呼び出しは
すべてブラウザ上の **Safie SDK (JavaScript)** が行う構成です。サーバー側にアプリケーションロジックも秘密情報もありません。

```
server.cpp            cpp-httplib の静的ファイルサーバー（これだけが C++）
serve.py              同じことをする Python 版（標準ライブラリのみ）
third_party/httplib.h cpp-httplib v0.62.0（単一ヘッダ）
www/index.html        画面
www/app.js            Safie SDK を使った認可とデバイス一覧取得
www/style.css
```

## なぜ SDK 経由なのか

Safie の REST API（`https://openapi.safie.link`）はブラウザからの直接呼び出しを CORS で拒否します
（`Access-Control-Allow-Origin` が返るのは `https://safie.link` オリジンだけ。`localhost` では返りません）。
そのため「HTML + JS だけ」で完結させるには、Safie SDK を使う必要があります。SDK は `https://safie.link` 上の
iframe から API を呼ぶので、ページ側は CORS もトークンエンドポイントも意識しません。

Client 種別 **Public** は Client Secret を持たず PKCE で認可する種別で、SDK の `Safie.Auth.authorize` /
`Safie.Auth.initialize({ clientId })` がそのまま対応しています。

生の REST API をブラウザから叩きたい場合は、cpp-httplib 側に `/api/*` を `openapi.safie.link` へ中継する
プロキシを書く必要があります（OpenSSL を有効にした cpp-httplib クライアントが必要）。このサンプルには含めていません。

## Safie Developers 側の準備

1. https://developers.safie.link/ にログインし、OAuth2.0 認証のアプリケーションを「新規作成」。
2. Client 種別は **Public** を選択。Public では OIDC の利用が必須なので「ID情報」か「ID情報 + メールアドレス情報」を選ぶ。
   Client 種別と OIDC 設定は作成後に変更できない。
3. 利用する API / SDK(JavaScript) にチェック。このサンプルは SDK の `Devices.queryDevices` と
   `Devices.queryThumbnail` を使う。迷ったら「現在及び今後追加されるすべての Safie API および SDK を利用する」。
4. 作成完了画面に表示される **Scope** を控える（例: `safie-api openid`）。
5. アプリケーション詳細で「Client 新規作成」。Redirect URI に `http://localhost:8080/` を登録して発行。
   表示される **Client ID** を控える（Public なので Client Secret は「—」）。

ポートを変える場合は Redirect URI も合わせること。SDK は Web Crypto を使うため、ページは
`http://localhost` か `https` で開く必要がある（LAN の IP アドレス + http では動かない）。

## ビルドと実行

w64devkit / MinGW:

```sh
make          # server.exe を生成
./server.exe  # http://localhost:8080/ で www/ を配信
```

MSVC:

```sh
cmake -S . -B build
cmake --build build --config Release
build\Release\server.exe
```

オプション: `--host localhost` `--port 8080` `--root www`

Python 版（C++ をビルドしたくない場合。挙動は同じ）:

```sh
python serve.py            # 同じく http://localhost:8080/ で www/ を配信
python serve.py --port 8081
```

## 使い方

1. `http://localhost:8080/` を開く。
2. Client ID と Scope を貼り付けて「保存」。
3. 「Safie でログイン」→ Safie のログイン画面でメールアドレスとパスワードを入力して許可。
4. `http://localhost:8080/?code=...&state=...` に戻ってくると、`Safie.Auth.initialize` が認可コードを
   トークンに交換し、デバイス一覧が表示される。「サムネイルを取得」で各デバイスの最新サムネイルを表示。

設定は `localStorage`、トークンは SDK が保持する（`rememberMe: true` でタブを閉じても維持、
`enableTokenRefresh: true` でアクセストークンの期限切れを SDK が自動更新）。「ログアウト」は
SDK が保持するトークンを消すだけで、Safie アカウント自体のログアウトは行わない。

## GitHub Pages で動かす

このリポジトリは GitHub Pages（`main` ブランチのルート）で公開しています。アプリ本体は `www/` 以下なので、
Pages 上の URL は次のとおりです（ルートの `index.html` はここへリダイレクトするだけ）。

```
https://yomei-o.github.io/safie-public-sdk-demo/www/
```

`app.js` は Redirect URI を「今開いているページの URL（クエリ・ハッシュ・`index.html` を除いたもの）」として
計算するので、Safie Developers 側でこの URL（末尾のスラッシュまで）を Redirect URI に登録した Client を作り、
その Client ID をページに貼り付ければ localhost と同じコードで動きます。Client は 1 アプリにつき 2 つまで
作れるので、localhost 用と Pages 用で分けるのが簡単です。

## 参考

- チュートリアル: https://developers.safie.link/tutorial/oauth
- SDK リファレンス: https://safie.link/sdk/js/api/v1/latest/doc/ （`Auth.authorize` / `Auth.initialize`）
- API リファレンス（Auth v2）: https://developers.safie.link/reference/api#tag/Auth-v2
- OpenAPI 定義: https://developers.safie.link/static/openapi.json
