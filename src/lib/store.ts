import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { StoredKit } from "./types";

interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

interface StoreData {
  users: UserRecord[];
  kits: StoredKit[];
}

const storePath = resolve(process.env.DATA_DIR ?? "./data", "trao-store.json");
const emptyStore = (): StoreData => ({ users: [], kits: [] });

function readStore(): StoreData {
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Partial<StoreData>;
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      kits: Array.isArray(parsed.kits) ? parsed.kits : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw new Error(`Could not read application data: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function writeStore(data: StoreData): void {
  mkdirSync(dirname(storePath), { recursive: true });
  const temporary = `${storePath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(temporary, storePath);
}

export function findUserByEmail(email: string): UserRecord | undefined {
  return readStore().users.find((user) => user.email === email.toLowerCase());
}

export function findUserById(id: string): UserRecord | undefined {
  return readStore().users.find((user) => user.id === id);
}

export function createUser(user: UserRecord): void {
  const data = readStore();
  if (data.users.some((entry) => entry.email === user.email)) throw new Error("An account with this email already exists.");
  data.users.push(user);
  writeStore(data);
}

export function listKits(ownerId: string): StoredKit[] {
  return readStore().kits.filter((kit) => kit.ownerId === ownerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function findKit(ownerId: string, id: string): StoredKit | undefined {
  return readStore().kits.find((kit) => kit.ownerId === ownerId && kit.id === id);
}

export function findKitByFingerprint(ownerId: string, fingerprint: string): StoredKit | undefined {
  return readStore().kits.find((kit) => kit.ownerId === ownerId && kit.inputFingerprint === fingerprint);
}

export function saveKit(kit: StoredKit): void {
  const data = readStore();
  const index = data.kits.findIndex((entry) => entry.id === kit.id && entry.ownerId === kit.ownerId);
  if (index < 0) data.kits.push(kit);
  else data.kits[index] = kit;
  writeStore(data);
}

export function deleteKit(ownerId: string, id: string): boolean {
  const data = readStore();
  const filtered = data.kits.filter((kit) => !(kit.id === id && kit.ownerId === ownerId));
  if (filtered.length === data.kits.length) return false;
  data.kits = filtered;
  writeStore(data);
  return true;
}
