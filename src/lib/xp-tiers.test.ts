import { describe, expect, it } from "vitest";

import { buildXpTierRanges } from "./xp-tiers";

describe("buildXpTierRanges", () => {
  it("builds fixed 100 XP tiers from under 2000 through 3000 and above", () => {
    const tiers = buildXpTierRanges(100);

    expect(tiers[0]).toEqual({ minXp: null, maxXp: 1999, sortOrder: 1 });
    expect(tiers[1]).toEqual({ minXp: 2000, maxXp: 2099, sortOrder: 2 });
    expect(tiers.at(-1)).toEqual({ minXp: 3000, maxXp: null, sortOrder: 12 });
    expect(tiers).toHaveLength(12);
  });

  it("builds fixed 50 XP tiers from under 2000 through 3000 and above", () => {
    const tiers = buildXpTierRanges(50);

    expect(tiers[0]).toEqual({ minXp: null, maxXp: 1999, sortOrder: 1 });
    expect(tiers[1]).toEqual({ minXp: 2000, maxXp: 2049, sortOrder: 2 });
    expect(tiers.at(-1)).toEqual({ minXp: 3000, maxXp: null, sortOrder: 22 });
    expect(tiers).toHaveLength(22);
  });
});
