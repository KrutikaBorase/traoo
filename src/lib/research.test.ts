import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { crawlCompanySite } from "./research";

test("crawler respects robots disallows and reports skipped page URLs", async () => {
  let restrictedPageRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" }).end("User-agent: *\nDisallow: /secret");
    } else if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" }).end(
        '<html><body><a href="/secret/careers">Careers</a></body></html>',
      );
    } else if (request.url === "/secret/careers") {
      restrictedPageRequests += 1;
      response.writeHead(200, { "content-type": "text/html" }).end("<html></html>");
    } else {
      response.writeHead(404, { "content-type": "text/plain" }).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const result = await crawlCompanySite(`http://127.0.0.1:${address.port}/`);
    assert.equal(result.pages.length, 1);
    assert.equal(restrictedPageRequests, 0);
    assert.ok(result.skipped.includes(`http://127.0.0.1:${address.port}/secret/careers`));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("crawler fails closed and reports sources when robots.txt is unavailable", async () => {
  let homepageRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(503, { "content-type": "text/plain" }).end("temporarily unavailable");
      return;
    }
    homepageRequests += 1;
    response.writeHead(200, { "content-type": "text/html" }).end("<html></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const result = await crawlCompanySite(`http://127.0.0.1:${address.port}/`);
    assert.deepEqual(result.pages, []);
    assert.equal(homepageRequests, 0);
    assert.ok(result.skipped.includes(`http://127.0.0.1:${address.port}/robots.txt`));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("crawler reports an unreachable host without aborting the research phase", async () => {
  const url = "https://company-does-not-exist.invalid/";
  const result = await crawlCompanySite(url);
  assert.deepEqual(result.pages, []);
  assert.ok(result.skipped.includes(url));
});

test("crawler retries a transient server error before fetching the company page", async () => {
  let robotsAttempts = 0;
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") {
      robotsAttempts += 1;
      if (robotsAttempts === 1) {
        response.writeHead(503, { "content-type": "text/plain" }).end("try again");
      } else {
        response.writeHead(404, { "content-type": "text/plain" }).end();
      }
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }).end("<html><body>Acme</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const result = await crawlCompanySite(`http://127.0.0.1:${address.port}/`);
    assert.equal(robotsAttempts, 2);
    assert.equal(result.pages.length, 1);
    assert.deepEqual(result.skipped, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
