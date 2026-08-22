export const STAGE_DEFINITIONS = [
  { nameJa: "ユノハナ大渓谷", imagePath: "/stages/img.png" },
  { nameJa: "ゴンズイ地区", imagePath: "/stages/スクリーンショット 2026-08-22 073242.png" },
  { nameJa: "ヤガラ市場", imagePath: "/stages/スクリーンショット 2026-08-22 073140" },
  { nameJa: "マテガイ放水路", imagePath: "/stages/スクリーンショット 2026-08-22 073145.png" },
  { nameJa: "ナメロウ金属", imagePath: "/stages/スクリーンショット 2026-08-22 073454.png" },
  { nameJa: "マサバ海峡大橋", imagePath: "/stages/スクリーンショット 2026-08-22 073121.png" },
  { nameJa: "キンメダイ美術館", imagePath: "/stages/スクリーンショット 2026-08-22 073321.png" },
  { nameJa: "マヒマヒリゾート＆スパ", imagePath: "/stages/スクリーンショット 2026-08-22 073416.png" },
  { nameJa: "海女美術大学", imagePath: "/stages/スクリーンショット 2026-08-22 073106.png" },
  { nameJa: "チョウザメ造船", imagePath: "/stages/スクリーンショット 2026-08-22 073501.png" },
  { nameJa: "ザトウマーケット", imagePath: "/stages/スクリーンショット 2026-08-22 073427.png" },
  { nameJa: "スメーシーワールド", imagePath: "/stages/スクリーンショット 2026-08-22 073303.png" },
  { nameJa: "クサヤ温泉", imagePath: "/stages/スクリーンショット 2026-08-22 073253.png" },
  { nameJa: "ヒラメが丘団地", imagePath: "/stages/スクリーンショット 2026-08-22 073339.png" },
  { nameJa: "ナンプラー遺跡", imagePath: "/stages/スクリーンショット 2026-08-22 073055.png" },
  { nameJa: "マンタマリア号", imagePath: "/stages/スクリーンショット 2026-08-22 073449.png" },
  { nameJa: "タラポートショッピングパーク", imagePath: "/stages/スクリーンショット 2026-08-22 073029.png" },
  { nameJa: "コンブトラック", imagePath: "/stages/スクリーンショット 2026-08-22 073421.png" },
  { nameJa: "タカアシ経済特区", imagePath: "/stages/スクリーンショット 2026-08-22 073333.png" },
  { nameJa: "オヒョウ海運", imagePath: "/stages/スクリーンショット 2026-08-22 073409.png" },
  { nameJa: "バイガイ亭", imagePath: "/stages/スクリーンショット 2026-08-22 073249.png" },
  { nameJa: "ネギトロ炭鉱", imagePath: "/stages/スクリーンショット 2026-08-22 073135.png" },
  { nameJa: "カジキ空港", imagePath: "/stages/スクリーンショット 2026-08-22 073314.png" },
  { nameJa: "リュウグウターミナル", imagePath: "/stages/リュウグウターミナル.png" },
] as const;

export const DEFAULT_STAGE_NAMES = STAGE_DEFINITIONS.map((stage) => stage.nameJa);

export function stageImagePath(stageName: string | null | undefined) {
  if (!stageName) return null;
  return STAGE_DEFINITIONS.find((stage) => stage.nameJa === stageName)?.imagePath ?? null;
}
