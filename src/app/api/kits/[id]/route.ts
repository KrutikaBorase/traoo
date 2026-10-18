import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { validateKit } from "@/lib/kit";
import { deleteKit, findKit, saveKit } from "@/lib/store";
import type { InterviewKit } from "@/lib/types";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Please sign in." } }, { status: 401 });
  const { id } = await context.params;
  const kit = findKit(user.id, id);
  return kit
    ? NextResponse.json({ kit })
    : NextResponse.json({ error: { code: "NOT_FOUND", message: "Kit not found." } }, { status: 404 });
}

export async function PUT(request: Request, context: Context) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Please sign in." } }, { status: 401 });
  const { id } = await context.params;
  const stored = findKit(user.id, id);
  if (!stored) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Kit not found." } }, { status: 404 });
  try {
    const body = await request.json() as { kit?: InterviewKit; questionState?: StoredState; flashcardState?: StoredState };
    validateKit(body.kit);
    const updated = {
      ...stored,
      kit: body.kit,
      questionState: body.questionState ?? stored.questionState,
      flashcardState: body.flashcardState ?? stored.flashcardState,
      updatedAt: new Date().toISOString(),
    };
    saveKit(updated);
    return NextResponse.json({ kit: updated });
  } catch (error) {
    return NextResponse.json({
      error: { code: "INVALID_KIT", message: error instanceof Error ? error.message : "Kit validation failed." },
    }, { status: 400 });
  }
}

type StoredState = Record<string, "generated" | "edited" | "pinned">;

export async function DELETE(_request: Request, context: Context) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Please sign in." } }, { status: 401 });
  const { id } = await context.params;
  if (!deleteKit(user.id, id)) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Kit not found." } }, { status: 404 });
  return NextResponse.json({ ok: true });
}
