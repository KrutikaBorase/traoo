import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import type { StoredKit } from "./types";

test("local store persists users and owner-scoped kits", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "trao-store-test-"));
  const originalDataDir = process.env.DATA_DIR;
  const originalMongoUri = process.env.MONGODB_URI;
  const originalVercel = process.env.VERCEL;
  process.env.DATA_DIR = directory;
  delete process.env.MONGODB_URI;
  delete process.env.VERCEL;
  try {
    const store = await import("./store");
    const user = {
      id: "user-1",
      email: "person@example.test",
      passwordHash: "hashed-password",
      salt: "random-salt",
      createdAt: new Date().toISOString(),
    };
    await store.createUser(user);
    assert.equal((await store.findUserByEmail(user.email))?.id, user.id);
    assert.equal((await store.findUserById(user.id))?.email, user.email);
    await assert.rejects(
      () => store.createUser({ ...user, id: "duplicate" }),
      /An account with this email already exists/,
    );

    const kit: StoredKit = {
      id: "kit-1",
      ownerId: user.id,
      inputFingerprint: "fingerprint",
      title: "Engineer preparation",
      kit: {
        source: {
          company: "Acme",
          company_url: "https://acme.example/",
          role: "Engineer",
          location: "",
          jd_chars: 0,
          researched_at: new Date().toISOString(),
          pages_used: [],
        },
        company_brief: { summary: "Unknown.", what_they_do: "Unknown.", sources: [] },
        role: { title: "Engineer", seniority: "", responsibilities: [], requirements: [] },
        questions: [],
        flashcards: [],
        schedule: { days_available: 1, days: [{ day: 1, focus: "Review", question_ids: [], minutes: 0 }] },
        coverage: { uncovered_requirement_ids: [], passes: 2 },
      },
      questionState: {},
      flashcardState: {},
      practice: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.saveKit(kit);
    assert.equal((await store.findKit(user.id, kit.id))?.title, kit.title);
    assert.equal(await store.findKit("another-user", kit.id), undefined);
    assert.equal((await store.findKitByFingerprint(user.id, "fingerprint"))?.id, kit.id);
    assert.equal((await store.listKits(user.id)).length, 1);
    assert.equal(await store.deleteKit(user.id, kit.id), true);
    assert.equal(await store.deleteKit(user.id, kit.id), false);
    process.env.VERCEL = "1";
    await assert.rejects(() => store.listKits(user.id), /MONGODB_URI must be configured/);
    delete process.env.VERCEL;
  } finally {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    if (originalMongoUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = originalMongoUri;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
    await rm(directory, { recursive: true, force: true });
  }
});
