export const STAGE_DEFINITIONS = [
  { nameJa: "ユノハナ大渓谷", imagePath: "/stages/yunohana.webp" },
  { nameJa: "ゴンズイ地区", imagePath: "/stages/gonzui.webp" },
  { nameJa: "ヤガラ市場", imagePath: "/stages/yagara.webp" },
  { nameJa: "マテガイ放水路", imagePath: "/stages/mategai.webp" },
  { nameJa: "ナメロウ金属", imagePath: "/stages/namero.webp" },
  { nameJa: "マサバ海峡大橋", imagePath: "/stages/masaba.webp" },
  { nameJa: "キンメダイ美術館", imagePath: "/stages/kinmedai.webp" },
  { nameJa: "マヒマヒリゾート＆スパ", imagePath: "/stages/mahimahi.webp" },
  { nameJa: "海女美術大学", imagePath: "/stages/amabi.webp" },
  { nameJa: "チョウザメ造船", imagePath: "/stages/chozame.webp" },
  { nameJa: "ザトウマーケット", imagePath: "/stages/zatou.webp" },
  { nameJa: "スメーシーワールド", imagePath: "/stages/sumeshi.webp" },
  { nameJa: "クサヤ温泉", imagePath: "/stages/kusaya.webp" },
  { nameJa: "ヒラメが丘団地", imagePath: "/stages/hirame.webp" },
  { nameJa: "ナンプラー遺跡", imagePath: "/stages/nampla.webp" },
  { nameJa: "マンタマリア号", imagePath: "/stages/mantamaria.webp" },
  { nameJa: "タラポートショッピングパーク", imagePath: "/stages/taraport.webp" },
  { nameJa: "コンブトラック", imagePath: "/stages/kombu.webp" },
  { nameJa: "タカアシ経済特区", imagePath: "/stages/takaashi.webp" },
  { nameJa: "オヒョウ海運", imagePath: "/stages/ohyo.webp" },
  { nameJa: "バイガイ亭", imagePath: "/stages/baigai.webp" },
  { nameJa: "ネギトロ炭鉱", imagePath: "/stages/negitoro.webp" },
  { nameJa: "カジキ空港", imagePath: "/stages/kajiki.webp" },
  { nameJa: "リュウグウターミナル", imagePath: "/stages/ryugu.webp" },
] as const;

export const DEFAULT_STAGE_NAMES = STAGE_DEFINITIONS.map((stage) => stage.nameJa);

export function stageImagePath(stageName: string | null | undefined) {
  if (!stageName) return null;
  return STAGE_DEFINITIONS.find((stage) => stage.nameJa === stageName)?.imagePath ?? null;
}
