# ステージ画像配置場所

ステージ画像はこのフォルダに配置してください。

例:

```text
public/stages/yunohana.webp
public/stages/gonzui.webp
public/stages/yagara-market.webp
```

ステージ名と画像ファイルの紐付けは `src/lib/stages.ts` の `STAGE_DEFINITIONS` で管理します。

例:

```ts
{ nameJa: "ユノハナ大渓谷", imagePath: "/stages/yunohana.webp" }
```

画像ファイル名を変更した場合は、必ず `src/lib/stages.ts` の `imagePath` も同じパスへ更新してください。
