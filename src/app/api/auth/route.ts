import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { clearSessionCookie, currentUser, newPasswordSalt, passwordHash, setSessionCookie, verifyPassword } from "@/lib/auth";
import { createUser, findUserByEmail } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ user });
}

export async function POST(request: Request) {
  let body: { action?: string; email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be JSON." } }, { status: 400 });
  }
  const action = body.action;
  if (action === "logout") {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  }
  if (action !== "register" && action !== "login") {
    return NextResponse.json({ error: { code: "INVALID_ACTION", message: "Choose register, login or logout." } }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: { code: "INVALID_EMAIL", message: "Enter a valid email address." } }, { status: 400 });
  }
  if (password.length < 10 || password.length > 200) {
    return NextResponse.json({ error: { code: "INVALID_PASSWORD", message: "Password must be between 10 and 200 characters." } }, { status: 400 });
  }
  if (action === "register") {
    const salt = newPasswordSalt();
    try {
      createUser({
        id: randomUUID(),
        email,
        passwordHash: passwordHash(password, salt),
        salt,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      return NextResponse.json({
        error: { code: "ACCOUNT_EXISTS", message: error instanceof Error ? error.message : "Could not create account." },
      }, { status: 409 });
    }
  } else {
    const user = findUserByEmail(email);
    if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
      return NextResponse.json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } }, { status: 401 });
    }
    await setSessionCookie(user.id);
    return NextResponse.json({ user: { id: user.id, email: user.email } });
  }

  const user = findUserByEmail(email);
  if (!user) {
    return NextResponse.json({ error: { code: "ACCOUNT_UNAVAILABLE", message: "Account creation did not complete." } }, { status: 500 });
  }
  await setSessionCookie(user.id);
  return NextResponse.json({ user: { id: user.id, email: user.email } }, { status: 201 });
}
