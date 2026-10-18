import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { listKits } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Please sign in." } }, { status: 401 });
  return NextResponse.json({ kits: listKits(user.id) });
}
