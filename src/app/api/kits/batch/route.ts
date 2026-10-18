import { randomUUID } from "node:crypto";
import { currentUser } from "@/lib/auth";
import { buildKit, validateCaseInput } from "@/lib/pipeline";
import { saveKit } from "@/lib/store";
import type { CaseInput, StoredKit } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Please sign in." } }, { status: 401 });
  let cases: unknown;
  try {
    cases = await request.json();
  } catch {
    return Response.json({ error: { code: "INVALID_JSON", message: "Upload must be a JSON array of cases." } }, { status: 400 });
  }
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > 20) {
    return Response.json({ error: { code: "INVALID_BATCH", message: "Provide between 1 and 20 cases." } }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      void (async () => {
        for (let index = 0; index < cases.length; index += 1) {
          const candidate = cases[index] as Partial<CaseInput>;
          const id = typeof candidate?.id === "string" ? candidate.id : `case-${index + 1}`;
          try {
            const input = { ...candidate, id: randomUUID() } as CaseInput;
            validateCaseInput({ ...input, id });
            send({ type: "progress", step: `Preparing batch case ${index + 1} of ${cases.length}: ${id}` });
            const kit = await buildKit(input, (step) => send({ type: "progress", step: `${id}: ${step}` }));
            const now = new Date().toISOString();
            const stored: StoredKit = {
              id: input.id,
              ownerId: user.id,
              title: kit.role.title || `${kit.source.company} interview preparation`,
              kit,
              questionState: Object.fromEntries(kit.questions.map((question) => [question.id, "generated"])),
              flashcardState: Object.fromEntries(kit.flashcards.map((card) => [card.id, "generated"])),
              practice: {},
              createdAt: now,
              updatedAt: now,
            };
            saveKit(stored);
            send({ type: "case_complete", caseId: id, stored });
          } catch (error) {
            send({
              type: "case_error",
              caseId: id,
              error: { code: "GENERATION_FAILED", message: error instanceof Error ? error.message : "Generation failed." },
            });
          }
        }
        send({ type: "complete" });
        controller.close();
      })().catch((error: unknown) => {
        send({ type: "error", error: { code: "BATCH_FAILED", message: error instanceof Error ? error.message : "Batch failed." } });
        controller.close();
      });
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform" },
  });
}
