import { test } from "vitest";
import assert from "node:assert/strict";

test("smoke: test runner is wired", () => {
	assert.equal(1 + 1, 2);
});
