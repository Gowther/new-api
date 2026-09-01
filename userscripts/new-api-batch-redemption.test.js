"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  analyzeRedemptionText,
  extractRedemptionCodes,
  getUserIdCandidates,
  redeemCode,
  resolveSession,
} = require("./new-api-batch-redemption.user.js");

const CODE_A = "550e8400e29b41d4a716446655440000";
const CODE_B = "6ba7b8109dad41d180b400c04fd430c8";

test("extracts UUID v4 redemption codes from mixed multiline text", () => {
  const input = `
    兑换码一：${CODE_A}
    unrelated text
    redemption code: ${CODE_B}
  `;

  assert.deepEqual(extractRedemptionCodes(input), [CODE_A, CODE_B]);
});

test("normalizes hyphenated, uppercase, and canonically wrapped codes", () => {
  const input = `
    550E8400-E29B-41D4-A716-446655440000
    6ba7b810
    9dad
    41d1
    80b4
    00c04fd430c8
  `;

  assert.deepEqual(extractRedemptionCodes(input), [CODE_A, CODE_B]);
});

test("deduplicates codes while preserving their first occurrence", () => {
  const input = `${CODE_B}\n${CODE_A}\n${CODE_B.toUpperCase()}`;

  assert.deepEqual(extractRedemptionCodes(input), [CODE_B, CODE_A]);
});

test("rejects 32-character values that are not UUID v4 redemption codes", () => {
  const wrongVersion = "550e8400e29b11d4a716446655440000";
  const wrongVariant = "550e8400e29b41d44716446655440000";
  const result = analyzeRedemptionText(`${wrongVersion}\n${wrongVariant}\n${CODE_A}`);

  assert.deepEqual(result.codes, [CODE_A]);
  assert.equal(result.rejectedCount, 2);
});

test("does not merge arbitrary fragments separated by blank lines", () => {
  const input = "550e8400\n\n\ne29b41d4a716446655440000";

  assert.deepEqual(extractRedemptionCodes(input), []);
});

test("reads user IDs used by both default and classic frontends", () => {
  const values = new Map([
    ["uid", "42"],
    ["user", JSON.stringify({ id: 73 })],
  ]);
  const storage = { getItem: (key) => values.get(key) ?? null };

  assert.deepEqual(getUserIdCandidates(storage), ["42", "73"]);
});

test("ignores malformed or unsafe local user IDs", () => {
  const values = new Map([
    ["uid", "-1"],
    ["user", "not-json"],
  ]);
  const storage = { getItem: (key) => values.get(key) ?? null };

  assert.deepEqual(getUserIdCandidates(storage), []);
});

test("preflight and redemption use the authenticated new-api request contract", async () => {
  const calls = [];
  const storage = { getItem: (key) => (key === "uid" ? "42" : null) };
  const fetchMock = async (url, options) => {
    calls.push({ url, options });
    if (url === "/api/user/topup/info") {
      return new Response(
        JSON.stringify({ success: true, data: { enable_redemption: true } }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ success: true, data: 500000 }), {
      status: 200,
    });
  };

  const userId = await resolveSession(fetchMock, storage);
  const result = await redeemCode(fetchMock, userId, CODE_A);

  assert.equal(userId, "42");
  assert.equal(result.kind, "success");
  assert.equal(result.quota, 500000);
  assert.deepEqual(
    calls.map(({ url, options }) => ({
      url,
      method: options.method,
      userId: options.headers["New-Api-User"],
      body: options.body,
    })),
    [
      {
        url: "/api/user/topup/info",
        method: "GET",
        userId: "42",
        body: undefined,
      },
      {
        url: "/api/user/topup",
        method: "POST",
        userId: "42",
        body: JSON.stringify({ key: CODE_A }),
      },
    ],
  );
});

test("stops immediately when the server rate limit responds with 429", async () => {
  let requestCount = 0;
  const result = await redeemCode(async () => {
    requestCount += 1;
    return new Response("", { status: 429 });
  }, "42", CODE_A);

  assert.equal(requestCount, 1);
  assert.equal(result.kind, "blocked");
  assert.equal(result.stop, true);
  assert.match(result.message, /429/);
});
