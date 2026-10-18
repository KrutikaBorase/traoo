import { createHash, randomUUID } from "node:crypto";
import { currentUser } from "@/lib/auth";
import { buildKit, validateCaseInput } from "@/lib/pipeline";
import { findKitByFingerprint, saveKit } from "@/lib/store";
import type { CaseInput, StoredKit } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const activeGenerations = new Map<string, Promise<StoredKit>>();

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
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([input.jd.trim(), new URL(input.company_url).href, input.days]))
    .digest("hex");
  const generationKey = `${user.id}:${fingerprint}`;

  const encoder = new TextEncoder();
  let clientDisconnected = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: object) => {
        if (!clientDisconnected) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      void (async () => {
        try {
          const existing = findKitByFingerprint(user.id, fingerprint);
          if (existing) {
            send({ type: "progress", step: "Opening the matching saved kit" });
            send({ type: "complete", kit: existing });
            return;
          }
          send({ type: "progress", step: "Starting your preparation kit" });
          let generation = activeGenerations.get(generationKey);
          if (generation) {
            send({ type: "progress", step: "A matching kit is already being prepared" });
          } else {
            generation = (async () => {
              const kit = await buildKit(input, (step) => send({ type: "progress", step }));
              const now = new Date().toISOString();
              const stored: StoredKit = {
                id: input.id,
                ownerId: user.id,
                inputFingerprint: fingerprint,
                title: kit.role.title || `${kit.source.company} interview preparation`,
                kit,
                questionState: Object.fromEntries(kit.questions.map((question) => [question.id, "generated"])),
                flashcardState: Object.fromEntries(kit.flashcards.map((card) => [card.id, "generated"])),
                practice: {},
                createdAt: now,
                updatedAt: now,
              };
              saveKit(stored);
              return stored;
            })();
            activeGenerations.set(generationKey, generation);
          }
          const stored = await generation;
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
          activeGenerations.delete(generationKey);
          if (!clientDisconnected) controller.close();
        }
      })();
    },
    cancel() {
      clientDisconnected = true;
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
