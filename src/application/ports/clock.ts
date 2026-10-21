export interface Clock {
  now(): number;
}

export function systemClock(): Clock {
  return {
    now: () => Date.now(),
  };
}

export function fixedClock(at: number): Clock {
  return {
    now: () => at,
  };
}
