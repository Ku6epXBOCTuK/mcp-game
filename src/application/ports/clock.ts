export interface Clock {
	now(): number;
}

export function systemClock(): Clock {
	return {
		now: () => Math.floor(Date.now() / 1000),
	};
}

export function fixedClock(at: number): Clock {
	return {
		now: () => at,
	};
}
