import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { buildKit } from "./pipeline";

test("pipeline crawls company links and produces a covered, correctly sized kit without credentials", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(404, { "content-type": "text/plain" }).end();
      return;
    }
    if (request.url === "/acme/careers/process") {
      response.writeHead(200, { "content-type": "text/html" }).end(
        "<html><title>How we hire</title><body><p>Our interview includes practical system design and a collaborative conversation.</p></body></html>",
      );
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }).end(
      '<html><head><title>Acme</title></head><body><p>We build services for small businesses.</p><a href="/acme/careers/process">Our interview process</a></body></html>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "html.duckduckgo.com") {
      return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
    }
    return originalFetch(input, init);
  };
  try {
    const kit = await buildKit({
      id: "local-test",
      jd: "Senior Backend Engineer\nRequired: 5+ years of TypeScript experience.\nYou will mentor engineers and design distributed services.",
      company_url: `http://127.0.0.1:${address.port}/acme/`,
      days: 5,
    });
    assert.equal(kit.schedule.days.length, 5);
    assert.ok(kit.source.pages_used.some((url) => url.endsWith("/careers/process")));
    assert.deepEqual(kit.source.skipped_sources, []);
    assert.equal(kit.source.discussion_results, 0);
    assert.ok(kit.role.requirements.length >= 2);
    assert.deepEqual(kit.coverage.uncovered_requirement_ids, []);
    assert.equal(kit.coverage.passes, 2);
    assert.ok(kit.role.requirements.filter((item) => item.priority === "must").every((requirement) =>
      kit.questions.some((question) => question.requirement_ids.includes(requirement.id)),
    ));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("pipeline keeps a two-line stub thin rather than inventing requirements", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(404, { "content-type": "text/plain" }).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }).end("<html><body><p>Company information is not available.</p></body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "html.duckduckgo.com") {
      return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
    }
    return originalFetch(input, init);
  };
  try {
    const kit = await buildKit({
      id: "thin-test",
      jd: "Join our team.\nWe look forward to meeting you.",
      company_url: `http://127.0.0.1:${address.port}/`,
      days: 1,
    });
    assert.equal(kit.role.requirements.length, 0);
    assert.equal(kit.questions.length, 0);
    assert.equal(kit.schedule.days.length, 1);
    assert.match(kit.company_brief.summary, /Company/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
