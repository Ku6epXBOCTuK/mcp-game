import { test } from "node:test";
import assert from "node:assert/strict";
import { ok } from "neverthrow";
import {
  alreadyActing,
  contentInvalid,
  describeError,
  insufficientFunds,
  isDomainError,
  noActiveAction,
  notEnoughResources,
  questAlreadyClaimed,
  skillTooLow,
  toMessage,
  upgradeLocked,
  zoneLocked,
} from "../../src/domain/shared/result.ts";
import type { DomainError } from "../../src/domain/shared/errors.ts";

test("errors are returned as Err, not thrown", () => {
  const result = insufficientFunds(100, 10);
  assert.equal(result.isErr(), true);
  assert.equal(result.isOk(), false);
});

test("ok values unwrap cleanly", () => {
  const result = ok<number, DomainError>(5);
  assert.equal(result.isOk(), true);
  assert.equal(result._unsafeUnwrap(), 5);
});

test("not enough resources carries the numbers the agent needs", () => {
  const result = notEnoughResources("wood", 10, 3);
  assert.equal(result.isErr(), true);
  if (result.isErr()) {
    assert.equal(result.error.code, "NotEnoughResources");
    assert.equal(result.error.item, "wood");
    assert.equal(result.error.required, 10);
    assert.equal(result.error.available, 3);
    assert.match(result.error.message, /wood/);
  }
});

test("every error carries a non-empty message", () => {
  const results = [
    notEnoughResources("wood", 1, 0),
    skillTooLow("chopping", 5, 2),
    alreadyActing("chop"),
    noActiveAction(),
    insufficientFunds(10, 0),
    upgradeLocked("forge", "нужен уровень 10"),
    zoneLocked("cave", "нужен квест"),
    questAlreadyClaimed("q1"),
    contentInvalid("content/items.json", "wood", "нет sellPrice"),
  ];
  for (const result of results) {
    assert.equal(result.isErr(), true);
    if (result.isErr()) {
      assert.ok(result.error.message.length > 0);
      assert.ok(isDomainError(result.error));
      assert.equal(toMessage(result.error), result.error.message);
      assert.equal(describeError(result.error).code, result.error.code);
    }
  }
});

test("isDomainError rejects non-errors", () => {
  assert.equal(isDomainError(null), false);
  assert.equal(isDomainError("boom"), false);
  assert.equal(isDomainError({}), false);
  assert.equal(isDomainError({ code: "AlreadyActing" }), true);
});
