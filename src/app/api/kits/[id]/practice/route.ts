import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { findKit, saveKit } from "@/lib/store";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Please sign in." } }, { status: 401 });
  const { id } = await context.params;
  const stored = findKit(user.id, id);
  if (!stored) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Kit not found." } }, { status: 404 });
  try {
    const body = await request.json() as { flashcardId?: string; confidence?: number };
    if (!stored.kit.flashcards.some((card) => card.id === body.flashcardId)) throw new Error("Flashcard not found.");
    if (!Number.isInteger(body.confidence) || body.confidence! < 1 || body.confidence! > 5) throw new Error("Confidence must be an integer from 1 to 5.");
    stored.practice[body.flashcardId!] = { confidence: body.confidence!, coveredAt: new Date().toISOString() };
    stored.updatedAt = new Date().toISOString();
    saveKit(stored);
    return NextResponse.json({ practice: stored.practice });
  } catch (error) {
    return NextResponse.json({
      error: { code: "INVALID_PRACTICE", message: error instanceof Error ? error.message : "Invalid practice record." },
    }, { status: 400 });
  }
}
