export const DEFAULT_SKILL_RATE_K = 0.1;
export const MAX_TRADING_DISCOUNT = 0.4;
export const TRADING_DISCOUNT_PER_LEVEL = 0.02;
export const MARKET_DRIFT_RANGE = 0.3;

export function xpToNext(level: number): number {
  if (level < 1) throw new RangeError(`level must be >= 1, got ${level}`);
  return 15 * Math.pow(level, 1.4);
}

export function totalXpToReach(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l);
  return total;
}

export function upgradeCost(
  costBase: number,
  costGrowth: number,
  level: number,
): number {
  if (level < 0) throw new RangeError(`level must be >= 0, got ${level}`);
  if (costGrowth < 1) throw new RangeError(`costGrowth must be >= 1, got ${costGrowth}`);
  return costBase * Math.pow(costGrowth, level);
}

export function productionRate(params: {
  rateBase: number;
  skillLevel: number;
  upgradeMult?: number;
  prestigeMult?: number;
  k?: number;
}): number {
  const {
    rateBase,
    skillLevel,
    upgradeMult = 1,
    prestigeMult = 1,
    k = DEFAULT_SKILL_RATE_K,
  } = params;
  if (skillLevel < 0) throw new RangeError(`skillLevel must be >= 0, got ${skillLevel}`);
  return rateBase * (1 + k * skillLevel) * upgradeMult * prestigeMult;
}

export function tradingDiscount(tradingLevel: number): number {
  if (tradingLevel < 0) throw new RangeError(`tradingLevel must be >= 0, got ${tradingLevel}`);
  return Math.min(MAX_TRADING_DISCOUNT, TRADING_DISCOUNT_PER_LEVEL * tradingLevel);
}

export function marketPrice(basePrice: number, drift: number): number {
  if (drift < -1 || drift > 1) throw new RangeError(`drift must be within [-1, 1], got ${drift}`);
  return basePrice * (1 + MARKET_DRIFT_RANGE * drift);
}

export function prestigeMultiplier(points: number, exponent: number): number {
  if (points < 0) throw new RangeError(`points must be >= 0, got ${points}`);
  return Math.pow(points + 1, exponent);
}
