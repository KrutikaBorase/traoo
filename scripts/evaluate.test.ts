import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("batch evaluator writes the required output and continues after an invalid case", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(404, { "content-type": "text/plain" }).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }).end(
      "<html><head><title>Acme</title></head><body><p>We build services for small businesses.</p></body></html>",
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const directory = await mkdtemp(resolve(tmpdir(), "trao-evaluate-"));
  try {
    const inputPath = resolve(directory, "cases.json");
    const outputPath = resolve(directory, "kits.json");
    await writeFile(inputPath, JSON.stringify([
      {
        id: "valid-case",
        jd: "Senior Backend Engineer\nRequired: 5 years of TypeScript experience.",
        company_url: `http://127.0.0.1:${address.port}/`,
        days: 3,
      },
      {
        id: "invalid-case",
        jd: "Join our team.",
        company_url: `http://127.0.0.1:${address.port}/`,
        days: 0,
      },
    ]));

    const child = spawn(process.execPath, [
      "--import", "tsx",
      "--import", pathToFileURL(resolve("scripts", "test-fetch-mock.cjs")).href,
      "scripts/evaluate.ts",
      "--input", inputPath,
      "--output", outputPath,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, GEMINI_API_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    const exitCode = await new Promise<number | null>((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
    });
    assert.equal(exitCode, 0, `${stdout}\n${stderr}`);

    const output = JSON.parse(await readFile(outputPath, "utf8")) as {
      version: string;
      generated_at: string;
      kits: Array<{ id: string; status: string; kit: { schedule: { days_available: number; days: unknown[] } } | null; error: unknown }>;
    };
    assert.equal(output.version, "1.0");
    assert.ok(Number.isFinite(Date.parse(output.generated_at)));
    assert.equal(output.kits.length, 2);
    assert.equal(output.kits[0].id, "valid-case");
    assert.equal(output.kits[0].status, "ok");
    assert.equal(output.kits[0].kit?.schedule.days_available, 3);
    assert.equal(output.kits[0].kit?.schedule.days.length, 3);
    assert.equal(output.kits[1].id, "invalid-case");
    assert.equal(output.kits[1].status, "failed");
    assert.ok(output.kits[1].error);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
});
