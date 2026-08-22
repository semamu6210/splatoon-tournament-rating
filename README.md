# Splatoon Tournament Rating System

Splatoon向けの大会期間限定4v4個人レーティング・マッチングWebサービスです。大会作成、参加登録、フェーズ進行、Queue、マッチング、勝敗報告、PlayerVote、レート更新、ランキング、Admin監査ログまでの主要フローを実装しています。

## 必要環境

- Node.js 20.19以上
- npm 10以上
- PostgreSQL
- Discord Developer Portalで作成したOAuth Application

## 開発セットアップ

```bash
npm install
cp .env.example .env
```

`.env` に開発用の値を設定します。秘密情報はREADMEやコードへ直接書かないでください。

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/splatoon_rating?schema=public"
AUTH_SECRET="開発用の長いランダム文字列"
AUTH_DISCORD_ID=""
AUTH_DISCORD_SECRET=""
AUTH_URL="http://localhost:3000"
ENABLE_TEST_AUTH="false"
```

## PostgreSQL

開発DBを作成します。

```sql
CREATE DATABASE splatoon_rating;
```

schema検証、Prisma Client生成、migrationは以下です。

```bash
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate
```

本番では必ず以下を使います。

```bash
npm run prisma:deploy
```

本番で禁止:

- `prisma migrate dev`
- `prisma migrate reset`
- `prisma db push`

`DATABASE_URL` を変更するだけで、ローカルPostgreSQLからホスティングされたPostgreSQLへ接続できます。接続先DBサービスのSSL要件がある場合は、そのサービス指定の接続文字列を `DATABASE_URL` に設定してください。

## Discord OAuth

Discord Developer PortalでApplicationを作成し、OAuth2 Redirect URIを追加します。

開発:

```text
http://localhost:3000/api/auth/callback/discord
```

本番:

```text
https://YOUR_DOMAIN/api/auth/callback/discord
```

Client IDを `AUTH_DISCORD_ID`、Client Secretを `AUTH_DISCORD_SECRET` に設定します。本番の `AUTH_URL` は `https://YOUR_DOMAIN` にしてください。localhost固定のまま本番公開しないでください。

## ADMIN作成

初回はDiscordログイン後、Prisma StudioまたはDB管理画面で対象ユーザーの `User.role` を `ADMIN` または `OWNER` に変更します。

```bash
npm run prisma:studio
```

一般ユーザーが画面やAPIから自分をADMINへ昇格する機能はありません。

## 開発サーバー

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。

## 開発Seed

32人大会、ADMIN、XP分散、レート設定、予選/本戦フェーズ、複数ブロックを作る開発用seedがあります。

```bash
npm run seed:dev
```

このseedは `Phase8 Dev Tournament` と `phase8-*` ユーザーを作り直します。localhost DB以外では拒否されます。隔離済みの開発DBでだけ `SEED_DEV_CONFIRM=true npm run seed:dev` を使えます。本番ユーザーデータがあるDBでは実行しないでください。

## テスト

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

E2EはPlaywrightを使います。Discord外部OAuthには依存せず、localhostかつ `ENABLE_TEST_AUTH=true` の時だけ有効なテストログインAPIを使います。

```bash
npx playwright install chromium
npm run test:e2e
```

E2Eでは32人大会の通しフローをAPI経由で確認し、スマホ幅のランキング/大会詳細画面も開きます。

## 本番環境変数

最低限必要な環境変数:

- `DATABASE_URL`: 本番PostgreSQL接続文字列
- `AUTH_SECRET`: 本番専用の長いランダム文字列
- `AUTH_DISCORD_ID`: Discord OAuth Client ID
- `AUTH_DISCORD_SECRET`: Discord OAuth Client Secret
- `AUTH_URL`: `https://YOUR_DOMAIN`
- `ENABLE_TEST_AUTH`: 本番では `false` または未設定

`ENABLE_TEST_AUTH=true` が誤って設定されても、`NODE_ENV=production` ではテストログインAPIは無条件で404になります。本番では必ず `false` または未設定にしてください。

本番では `.env` をGitへ含めないでください。

## Vercel本番デプロイ手順

まだ本番URL、PostgreSQLサービス、Discord設定値が未確定の場合は、実デプロイを開始しないでください。

1. GitHub repositoryを作成する
2. `.env`、`node_modules`、`.next` がGit対象外であることを確認する
3. Gitへcommitしてpushする

```bash
git init
git add .
git commit -m "Initial working tournament rating system"
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

4. hosted PostgreSQLを作成する
5. providerの管理画面から `DATABASE_URL` を取得する
6. SSLが必要なproviderでは、provider指定のSSL対応接続文字列を使う
7. ローカルまたはCIから、本番DBに対して `npm run prisma:deploy` を実行する
8. VercelでGitHub repositoryをImportする
9. Vercel Project Settingsで本番環境変数を設定する
10. VercelへDeployする
11. Discord Developer Portalで本番Redirect URIを追加する

```text
https://YOUR_DOMAIN/api/auth/callback/discord
```

12. Vercelの `AUTH_URL` を本番URLへ設定する

```text
https://YOUR_DOMAIN
```

13. 初回ADMIN/OWNERを設定する
14. 本番URLでDiscordログインを確認する
15. テスト大会を作成する
16. 非公開で参加登録、Queue、Match、投票、レート確定、ランキング、大会終了まで通す
17. 問題がなければ公開する

Vercel buildでは `postinstall` で `prisma generate` を実行し、`npm run build` で Next.js production build を行います。

## デプロイ準備チェック

1. 本番DBを作成する
2. 本番環境変数をホスティング先へ設定する
3. Discord Developer Portalへ本番Redirect URIを追加する
4. `npm run prisma:deploy` を本番DBへ実行する
5. `npm run build` が通ることを確認する
6. デプロイ後に初回ADMINをDB管理画面で設定する
7. 小規模な非公開大会でQueueから大会終了まで確認する

まだサービス選定や本番URLが未確定の場合、実デプロイは行わないでください。

## セキュリティと公開情報

一般参加者へ公開しない情報:

- `matchingRating`
- `matchingRatingAtMatch`
- 連敗補正適用後の内部値
- 他人の得票数
- `voterUserId`
- 他人のRatingHistory詳細
- `AdminActionLog`
- Auth.js内部情報
- `AUTH_DISCORD_SECRET`
- `DATABASE_URL`

一般ユーザーAPI/ページは、本人情報または公開してよいランキング・参加者情報だけを返します。admin系APIは `ADMIN`/`OWNER` のみ許可します。

## Rate Limit方針

本格的な分散rate limitは本番インフラで導入してください。優先対象は以下です。

- `/api/phases/:phaseId/queue/join`
- `/api/phases/:phaseId/queue/leave`
- `/api/matches/:matchId/result-reports`
- `/api/matches/:matchId/player-votes`
- `/api/phases/:phaseId/matchmaking/run`
- `/api/admin/*`
- Auth.js/Discord OAuth周辺

単一Nodeプロセスのメモリrate limitはサーバーレスや複数台構成では不十分です。Redis、Upstash、Cloudflare、Vercel Firewallなど、デプロイ先に合わせた共有ストア型の制限を推奨します。

導入時は、API routeの入口で `requireUser` / `requireAdmin` と同じ階層に小さなrate limit helperを挟む構成にします。まずはauth、Queue join/leave、PlayerVote、result report、matchmaking、admin危険操作を優先してください。

## バックアップ/復旧

PostgreSQLホスティングサービスの自動バックアップを有効化してください。最低限、以下のタイミングでバックアップを取得します。

- 大会開始前
- 大会終了後
- migration実行前
- 大規模な設定変更前

復旧手順は採用DBサービスに合わせて追記してください。復旧テストは本番DBではなくステージングDBで行います。

本番DBサービス選定後にREADMEへ追記する項目:

- 自動backupの保持期間
- 手動backupの取得手順
- restore先DBの作成手順
- migration前backupの確認手順
- 大会開始前/終了後backupの運用担当

## 初回ADMIN/OWNER設定案

最も簡単なのは、本番初回ログイン後にDB管理画面で対象ユーザーの `User.role` を `OWNER` に変更する方法です。より安全に自動化する場合は、将来 `INITIAL_OWNER_DISCORD_ID` のような環境変数を追加し、初回Discordログイン時に一致したDiscord IDだけを `OWNER` に昇格する方式を推奨します。

この方式を実装する場合も、昇格後は環境変数を空にする、既存OWNERがいる場合は自動昇格しない、AdminActionLogへ記録する、という制約を入れてください。

## Git初期化

このディレクトリはGitリポジトリではない場合があります。秘密情報が含まれていないことを確認してから初期化します。

```bash
git init
git add .
git commit -m "Initial working tournament rating system"
```

`.gitignore` では `.env`、`node_modules`、`.next`、`playwright-report`、`test-results`、`*.tsbuildinfo` を除外しています。

## トラブルシューティング

- DB接続エラー: `DATABASE_URL`、DB起動状態、SSL要件を確認する
- Discordログイン不可: Redirect URI、`AUTH_URL`、Client ID/Secretを確認する
- 本番migration失敗: 直前バックアップを確認し、`prisma migrate deploy` のログを保存する
- 403: ログイン状態と `User.role` を確認する
- Queue参加不可: 大会/フェーズがACTIVEか、参加済みか、規定試合数に達していないか確認する
- 投票不可: Matchが `VOTE_REPORTING` か、投票済みでないか、投票受付が締め切られていないか確認する
