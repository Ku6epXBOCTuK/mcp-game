import { test } from "vitest";
import assert from "node:assert/strict";
import {
	createRng,
	mulberry32,
	nextRandom,
} from "../../src/domain/shared/rng.ts";

test("same seed produces the same sequence", () => {
	const a = createRng({ seed: 42, counter: 0 });
	const b = createRng({ seed: 42, counter: 0 });
	const seqA = Array.from({ length: 20 }, () => a.nextFloat());
	const seqB = Array.from({ length: 20 }, () => b.nextFloat());
	assert.deepEqual(seqA, seqB);
});

test("different seeds produce different sequences", () => {
	const a = createRng({ seed: 42, counter: 0 });
	const b = createRng({ seed: 43, counter: 0 });
	assert.notEqual(a.nextFloat(), b.nextFloat());
});

test("values stay within [0, 1)", () => {
	const rng = createRng({ seed: 7, counter: 0 });
	for (let i = 0; i < 500; i++) {
		const value = rng.nextFloat();
		assert.ok(value >= 0 && value < 1, `value out of range: ${value}`);
	}
});

test("counter advances and snapshot captures state", () => {
	const rng = createRng({ seed: 1, counter: 0 });
	rng.nextFloat();
	rng.nextFloat();
	const snap = rng.snapshot();
	assert.equal(snap.counter, 2);
	assert.equal(snap.seed, 1);
});

test("restoring a snapshot continues the same sequence", () => {
	const rng = createRng({ seed: 99, counter: 0 });
	rng.nextFloat();
	rng.nextFloat();
	rng.nextFloat();
	const snapshot = rng.snapshot();
	const expected = rng.nextFloat();

	const restored = createRng(snapshot);
	assert.equal(restored.nextFloat(), expected);

	const fromScratch = createRng({ seed: 99, counter: 3 });
	assert.equal(fromScratch.nextFloat(), expected);
});

test("nextInt respects bounds", () => {
	const rng = createRng({ seed: 5, counter: 0 });
	for (let i = 0; i < 200; i++) {
		const value = rng.nextInt(3, 7);
		assert.ok(value >= 3 && value < 7);
	}
	assert.throws(() => rng.nextInt(5, 5), RangeError);
});

test("pick returns an element of the list", () => {
	const rng = createRng({ seed: 3, counter: 0 });
	const items = ["a", "b", "c"];
	for (let i = 0; i < 50; i++) {
		assert.ok(items.includes(rng.pick(items)));
	}
	assert.throws(() => rng.pick([]), RangeError);
});

test("pickWeighted respects weights", () => {
	const rng = createRng({ seed: 11, counter: 0 });
	const weights = { common: 99, rare: 1 };
	const items = ["common", "rare"] as const;
	let rare = 0;
	for (let i = 0; i < 1000; i++) {
		if (rng.pickWeighted(items, (item) => weights[item]) === "rare") rare++;
	}
	assert.ok(rare < 100, `rare hit too often: ${rare}`);
	assert.ok(rare > 0, "rare never hit");
});

test("mulberry32 matches the reference implementation", () => {
	assert.equal(mulberry32(42, 0), 0.6011037519201636);
	assert.equal(mulberry32(42, 1), 0.44829055899754167);
	assert.equal(mulberry32(42, 2), 0.8524657934904099);
});

test("nextRandom is a pure function of seed and counter", () => {
	const first = nextRandom({ seed: 11, counter: 0 });
	const second = nextRandom({ seed: 11, counter: 0 });
	assert.deepEqual(first, second);
	assert.equal(first.state.counter, 1);
	assert.equal(first.state.seed, 11);
});
