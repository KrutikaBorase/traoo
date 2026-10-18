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

  let input: CaseInput;
  try {
    const body = await request.json();
    input = { id: randomUUID(), jd: body.jd, company_url: body.company_url, days: body.days };
    validateCaseInput(input);
  } catch (error) {
    return Response.json({ error: { code: "INVALID_INPUT", message: error instanceof Error ? error.message : "Invalid request." } }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      void (async () => {
        try {
          send({ type: "progress", step: "Starting your preparation kit" });
          const kit = await buildKit(input, (step) => send({ type: "progress", step }));
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
          send({ type: "complete", kit: stored });
        } catch (error) {
          send({
            type: "error",
            error: {
              code: "GENERATION_FAILED",
              message: error instanceof Error ? error.message : "Kit generation failed.",
            },
          });
        } finally {
          controller.close();
        }
      })();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
    },
  });
}
