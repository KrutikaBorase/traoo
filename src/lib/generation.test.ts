import assert from "node:assert/strict";
import test from "node:test";
import { extractJobDescription } from "./generation";

test("Gemini uses the configured server-side key header and model", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = "test-only-not-a-real-key";
  process.env.GEMINI_MODEL = "gemini-flash-latest";
  let requestUrl = "";
  let requestHeaders: Headers | undefined;

  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    return Response.json({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              title: "Staff Engineer",
              seniority: "Staff",
              location: "",
              responsibilities: [],
              requirements: [{
                text: "Five years of TypeScript experience",
                kind: "technical",
                priority: "must",
              }],
            }),
          }],
        },
      }],
    });
  };

  try {
    const result = await extractJobDescription("Staff Engineer\nFive years of TypeScript experience.");
    assert.match(requestUrl, /\/models\/gemini-flash-latest:generateContent$/);
    assert.equal(new URL(requestUrl).search, "");
    assert.equal(requestHeaders?.get("x-goog-api-key"), "test-only-not-a-real-key");
    assert.equal(result.title, "Staff Engineer");
    assert.equal(result.requirements.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalModel;
  }
});
