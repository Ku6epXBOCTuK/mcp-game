export type RngState = {
	seed: number;
	counter: number;
};

export interface Rng {
	nextFloat(): number;
	nextInt(minInclusive: number, maxExclusive: number): number;
	pick<T>(items: readonly T[]): T;
	pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T;
	snapshot(): RngState;
}

const UINT32 = 0x100000000;
const MULBERRY_INCREMENT = 0x6d2b79f5;

export function mulberry32(seed: number, counter: number): number {
	const a = (seed + Math.imul(counter + 1, MULBERRY_INCREMENT)) | 0;
	let t = Math.imul(a ^ (a >>> 15), 1 | a);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / UINT32;
}

export function nextRandom(state: RngState): {
	value: number;
	state: RngState;
} {
	const value = mulberry32(state.seed, state.counter);
	return { value, state: { seed: state.seed, counter: state.counter + 1 } };
}

export function createRng(initial: RngState): Rng & { state: RngState } {
	let state: RngState = { seed: initial.seed, counter: initial.counter };

	const nextFloat = (): number => {
		const result = nextRandom(state);
		state = result.state;
		return result.value;
	};

	const nextInt = (minInclusive: number, maxExclusive: number): number => {
		if (maxExclusive <= minInclusive) {
			throw new RangeError(
				`maxExclusive must be greater than minInclusive, got ${maxExclusive} <= ${minInclusive}`,
			);
		}
		const span = maxExclusive - minInclusive;
		return minInclusive + Math.floor(nextFloat() * span);
	};

	const pick = <T>(items: readonly T[]): T => {
		if (items.length === 0)
			throw new RangeError("cannot pick from an empty list");
		return items[nextInt(0, items.length)] as T;
	};

	const pickWeighted = <T>(
		items: readonly T[],
		weightOf: (item: T) => number,
	): T => {
		if (items.length === 0)
			throw new RangeError("cannot pick from an empty list");
		let total = 0;
		for (const item of items) {
			const weight = weightOf(item);
			if (weight < 0) throw new RangeError("weights must be >= 0");
			total += weight;
		}
		if (total <= 0) throw new RangeError("total weight must be > 0");
		let roll = nextFloat() * total;
		for (const item of items) {
			roll -= weightOf(item);
			if (roll < 0) return item;
		}
		return items[items.length - 1] as T;
	};

	return {
		nextFloat,
		nextInt,
		pick,
		pickWeighted,
		snapshot: () => ({ ...state }),
		get state() {
			return { ...state };
		},
	};
}
