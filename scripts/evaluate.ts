import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildKit, validateCaseInput } from "../src/lib/pipeline";
import type { CaseInput } from "../src/lib/types";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const inputPath = argument("--input");
  const outputPath = argument("--output");
  if (!inputPath || !outputPath) {
    throw new Error("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>");
  }
  const raw = JSON.parse(await readFile(resolve(inputPath), "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("Input file must contain an array of cases.");
  const kits = [];
  for (let index = 0; index < raw.length; index += 1) {
    const candidate = raw[index] as Partial<CaseInput>;
    const id = typeof candidate?.id === "string" ? candidate.id : `case-${index + 1}`;
    try {
      validateCaseInput(candidate as CaseInput);
      const kit = await buildKit(candidate as CaseInput);
      kits.push({ id, status: "ok", kit, error: null });
      console.log(`[${index + 1}/${raw.length}] ${id}: ok`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kit generation failed.";
      const code = /unreachable|resolve|fetch|timeout/i.test(message) ? "COMPANY_UNREACHABLE" : "GENERATION_FAILED";
      kits.push({ id, status: "failed", kit: null, error: { code, message } });
      console.error(`[${index + 1}/${raw.length}] ${id}: ${message}`);
    }
  }
  const output = {
    version: "1.0",
    generated_at: new Date().toISOString(),
    kits,
  };
  await writeFile(resolve(outputPath), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${kits.length} result(s) to ${resolve(outputPath)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Evaluation failed.");
  process.exitCode = 1;
});
