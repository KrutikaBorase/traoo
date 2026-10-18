import { createHmac, randomBytes, timingSafeEqual, pbkdf2Sync } from "node:crypto";
import { cookies } from "next/headers";
import { findUserById } from "./store";

const COOKIE_NAME = "trao_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production" && (!value || value.length < 32)) {
    throw new Error("SESSION_SECRET must contain at least 32 characters in production.");
  }
  return value || "local-development-only-session-secret";
}

export function passwordHash(password: string, salt: string): string {
  return pbkdf2Sync(password, salt, 210_000, 32, "sha256").toString("hex");
}

export function verifyPassword(password: string, salt: string, expectedHex: string): boolean {
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(passwordHash(password, salt), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signInToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

async function verifyToken(token: string): Promise<{ id: string; email: string } | null> {
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra) return null;
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let decoded: { sub?: string; exp?: number };
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number };
  } catch {
    return null;
  }
  if (typeof decoded.sub !== "string" || typeof decoded.exp !== "number" || decoded.exp <= Date.now() / 1000) return null;
  const user = await findUserById(decoded.sub);
  return user ? { id: user.id, email: user.email } : null;
}

export async function currentUser(): Promise<{ id: string; email: string } | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function setSessionCookie(userId: string): Promise<void> {
  (await cookies()).set(COOKIE_NAME, signInToken(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

export function newPasswordSalt(): string {
  return randomBytes(16).toString("hex");
}
