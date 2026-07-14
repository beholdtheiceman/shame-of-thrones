import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { photos } from "@/db/schema";
import { realmPayload } from "@/lib/server/realm";
import { resetDb } from "./db";
import { makeThrone, makeUser } from "./fixtures";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";
import { GET as photoGET } from "@/app/api/photos/[id]/route";
import { GET as throneListGET } from "@/app/api/thrones/[id]/photos/route";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

async function makePhoto(throneId: string, uploadedBy: string, status: "pending" | "approved" | "rejected") {
  const [p] = await db.insert(photos).values({
    throneId, uploadedBy, bytes: JPEG, contentType: "image/jpeg", status,
  }).returning();
  return p;
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("photo serving authz", () => {
  beforeEach(resetDb);

  it("anonymous: approved streams, pending 404s", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    const approved = await makePhoto(throne.id, owner.id, "approved");
    const pending = await makePhoto(throne.id, owner.id, "pending");

    const ok = await photoGET(new Request("http://t"), params(approved.id));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("image/jpeg");
    expect((await photoGET(new Request("http://t"), params(pending.id))).status).toBe(404);
  });

  it("uploader sees own pending; strangers don't; moderator sees everything", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    const pending = await makePhoto(throne.id, owner.id, "pending");

    vi.mocked(auth).mockResolvedValue({ googleSubject: owner.googleSubject } as never);
    expect((await photoGET(new Request("http://t"), params(pending.id))).status).toBe(200);

    const rando = await makeUser();
    vi.mocked(auth).mockResolvedValue({ googleSubject: rando.googleSubject } as never);
    expect((await photoGET(new Request("http://t"), params(pending.id))).status).toBe(404);

    const mod = await makeUser({ role: "moderator" });
    vi.mocked(auth).mockResolvedValue({ googleSubject: mod.googleSubject } as never);
    expect((await photoGET(new Request("http://t"), params(pending.id))).status).toBe(200);
  });

  it("throne listing: approved for all, own photos included for the uploader", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    await makePhoto(throne.id, owner.id, "approved");
    await makePhoto(throne.id, owner.id, "pending");

    vi.mocked(auth).mockResolvedValue(null as never);
    const anon = await (await throneListGET(new Request("http://t"), params(throne.id))).json();
    expect(anon.photos).toHaveLength(1);

    vi.mocked(auth).mockResolvedValue({ googleSubject: owner.googleSubject } as never);
    const mine = await (await throneListGET(new Request("http://t"), params(throne.id))).json();
    expect(mine.photos).toHaveLength(2);
    expect(mine.photos.some((p: { mine: boolean; status: string }) => p.mine && p.status === "pending")).toBe(true);
  });

  it("realm throne DTO counts only approved photos", async () => {
    const owner = await makeUser();
    const throne = await makeThrone(owner.id);
    await makePhoto(throne.id, owner.id, "approved");
    await makePhoto(throne.id, owner.id, "pending");
    const realm = await realmPayload();
    expect(realm.thrones.find((t) => t.id === throne.id)!.photoCount).toBe(1);
  });
});
