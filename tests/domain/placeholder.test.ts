import { test } from "vitest";
import assert from "node:assert/strict";

test("domain test folder is picked up by the runner", () => {
	assert.equal(typeof structuredClone({ a: 1 }), "object");
});
