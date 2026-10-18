import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MongoClient, type Db } from "mongodb";
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
const mongoGlobal = globalThis as typeof globalThis & {
  __traoMongoClientPromise?: Promise<MongoClient>;
  __traoMongoIndexesPromise?: Promise<void>;
};

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

async function database(): Promise<Db | null> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    if (process.env.VERCEL === "1") {
      throw new Error("MONGODB_URI must be configured for persistent storage on Vercel.");
    }
    return null;
  }

  if (!mongoGlobal.__traoMongoClientPromise) {
    const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8_000 });
    mongoGlobal.__traoMongoClientPromise = client.connect().catch(async (error: unknown) => {
      mongoGlobal.__traoMongoClientPromise = undefined;
      try {
        await client.close();
      } catch (closeError) {
        throw new AggregateError([error, closeError], "MongoDB connection failed and the client could not close cleanly.");
      }
      throw error;
    });
  }
  const client = await mongoGlobal.__traoMongoClientPromise;
  const db = client.db();
  if (!mongoGlobal.__traoMongoIndexesPromise) {
    mongoGlobal.__traoMongoIndexesPromise = Promise.all([
      db.collection<UserRecord>("users").createIndex({ id: 1 }, { unique: true }),
      db.collection<UserRecord>("users").createIndex({ email: 1 }, { unique: true }),
      db.collection<StoredKit>("kits").createIndex({ id: 1, ownerId: 1 }, { unique: true }),
      db.collection<StoredKit>("kits").createIndex(
        { ownerId: 1, inputFingerprint: 1 },
        { unique: true, partialFilterExpression: { inputFingerprint: { $type: "string" } } },
      ),
    ]).then(() => undefined).catch((error: unknown) => {
      mongoGlobal.__traoMongoIndexesPromise = undefined;
      throw error;
    });
  }
  await mongoGlobal.__traoMongoIndexesPromise;
  return db;
}

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === 11000);
}

export async function findUserByEmail(email: string): Promise<UserRecord | undefined> {
  const db = await database();
  if (db) {
    return (await db.collection<UserRecord>("users").findOne(
      { email: email.toLowerCase() },
      { projection: { _id: 0 } },
    )) ?? undefined;
  }
  return readStore().users.find((user) => user.email === email.toLowerCase());
}

export async function findUserById(id: string): Promise<UserRecord | undefined> {
  const db = await database();
  if (db) {
    return (await db.collection<UserRecord>("users").findOne({ id }, { projection: { _id: 0 } })) ?? undefined;
  }
  return readStore().users.find((user) => user.id === id);
}

export async function createUser(user: UserRecord): Promise<void> {
  const db = await database();
  if (db) {
    try {
      await db.collection<UserRecord>("users").insertOne(user);
    } catch (error) {
      if (isDuplicateKey(error)) throw new Error("An account with this email already exists.");
      throw error;
    }
    return;
  }
  const data = readStore();
  if (data.users.some((entry) => entry.email === user.email)) throw new Error("An account with this email already exists.");
  data.users.push(user);
  writeStore(data);
}

export async function listKits(ownerId: string): Promise<StoredKit[]> {
  const db = await database();
  if (db) {
    return db.collection<StoredKit>("kits")
      .find({ ownerId }, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .toArray();
  }
  return readStore().kits.filter((kit) => kit.ownerId === ownerId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function findKit(ownerId: string, id: string): Promise<StoredKit | undefined> {
  const db = await database();
  if (db) {
    return (await db.collection<StoredKit>("kits").findOne(
      { ownerId, id },
      { projection: { _id: 0 } },
    )) ?? undefined;
  }
  return readStore().kits.find((kit) => kit.ownerId === ownerId && kit.id === id);
}

export async function findKitByFingerprint(ownerId: string, fingerprint: string): Promise<StoredKit | undefined> {
  const db = await database();
  if (db) {
    return (await db.collection<StoredKit>("kits").findOne(
      { ownerId, inputFingerprint: fingerprint },
      { projection: { _id: 0 } },
    )) ?? undefined;
  }
  return readStore().kits.find((kit) => kit.ownerId === ownerId && kit.inputFingerprint === fingerprint);
}

export async function saveKit(kit: StoredKit): Promise<void> {
  const db = await database();
  if (db) {
    await db.collection<StoredKit>("kits").replaceOne(
      { id: kit.id, ownerId: kit.ownerId },
      kit,
      { upsert: true },
    );
    return;
  }
  const data = readStore();
  const index = data.kits.findIndex((entry) => entry.id === kit.id && entry.ownerId === kit.ownerId);
  if (index < 0) data.kits.push(kit);
  else data.kits[index] = kit;
  writeStore(data);
}

export async function deleteKit(ownerId: string, id: string): Promise<boolean> {
  const db = await database();
  if (db) {
    const result = await db.collection<StoredKit>("kits").deleteOne({ ownerId, id });
    return result.deletedCount > 0;
  }
  const data = readStore();
  const filtered = data.kits.filter((kit) => !(kit.id === id && kit.ownerId === ownerId));
  if (filtered.length === data.kits.length) return false;
  data.kits = filtered;
  writeStore(data);
  return true;
}
