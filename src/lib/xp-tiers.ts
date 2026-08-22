export type XpTier = {
  minXp: number | null;
  maxXp: number | null;
  multiplier: string;
  sortOrder: number;
};

export function buildXpTierRanges(stepSize: 50 | 100): Array<Omit<XpTier, "multiplier">> {
  const tiers: Array<Omit<XpTier, "multiplier">> = [
    { minXp: null, maxXp: 1999, sortOrder: 1 },
  ];

  let sortOrder = 2;

  for (let minXp = 2000; minXp < 3000; minXp += stepSize) {
    tiers.push({
      minXp,
      maxXp: minXp + stepSize - 1,
      sortOrder,
    });
    sortOrder += 1;
  }

  tiers.push({ minXp: 3000, maxXp: null, sortOrder });

  return tiers;
}
