import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/assets/[id]/content` is the only door to a private object, and it has
 * two keys: ownership (RLS on `assets`) and a live share link (the token-gated
 * `captivate_shared_asset`). The bug these tests pin is that having *a*
 * session was mistaken for having the *owner's* session — a signed-in visitor
 * matches no row under RLS, so every image on a shared deck 404'd for them and
 * resolved fine for a logged-out stranger.
 *
 * The other direction matters just as much: the fallback must stay gated. It
 * resolves only what the RPC returns, so an id whose deck is not shared is a
 * 404 for owner and visitor alike, and revoking kills it for both.
 */

const PATH = "11111111-1111-1111-1111-111111111111/asset1.png";
const ASSET = "dddddddd-0000-0000-0000-000000000001";

function mockSupabase(opts: {
  user: { id: string } | null;
  /** What RLS on `assets` returns — null unless the caller owns the row. */
  ownedPath?: string | null;
  /** What the token-gated resolver returns — null unless the deck is shared. */
  sharedPath?: string | null;
}) {
  const rpc = vi.fn(async () => ({
    data: opts.sharedPath ? [{ storage_path: opts.sharedPath, mime_type: "image/png" }] : [],
    error: null,
  }));
  const createSignedUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://storage.test/${path}?token=signed` },
    error: null,
  }));

  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.maybeSingle = async () => ({
    data: opts.ownedPath ? { storage_path: opts.ownedPath } : null,
    error: null,
  });

  vi.doMock("@/lib/supabase/server", () => ({
    supabaseServer: vi.fn(async () => ({
      auth: { getUser: async () => ({ data: { user: opts.user } }) },
      from: () => chain,
      rpc,
      storage: { from: () => ({ createSignedUrl }) },
    })),
  }));
  return { rpc, createSignedUrl };
}

async function get(id: string) {
  const { GET } = await import("@/app/api/assets/[id]/content/route");
  return GET({} as never, { params: Promise.resolve({ id }) });
}

describe("shared asset content route", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("signs the object for its owner without consulting the share resolver", async () => {
    const { rpc, createSignedUrl } = mockSupabase({
      user: { id: "11111111-1111-1111-1111-111111111111" },
      ownedPath: PATH,
    });
    const res = await get(ASSET);
    expect(res.status).toBe(307);
    expect(createSignedUrl).toHaveBeenCalledWith(PATH, expect.any(Number));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("signs the object for a logged-out link holder", async () => {
    const { rpc } = mockSupabase({ user: null, sharedPath: PATH });
    const res = await get(ASSET);
    expect(res.status).toBe(307);
    expect(rpc).toHaveBeenCalledWith("captivate_shared_asset", { p_asset_id: ASSET });
  });

  it("signs the object for a signed-in visitor who does not own it", async () => {
    // The regression: a session, no matching row, a live share link.
    const { rpc } = mockSupabase({
      user: { id: "22222222-2222-2222-2222-222222222222" },
      ownedPath: null,
      sharedPath: PATH,
    });
    const res = await get(ASSET);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain(PATH);
    expect(rpc).toHaveBeenCalledWith("captivate_shared_asset", { p_asset_id: ASSET });
  });

  it("404s a signed-in visitor when the deck is not shared", async () => {
    mockSupabase({
      user: { id: "22222222-2222-2222-2222-222222222222" },
      ownedPath: null,
      sharedPath: null,
    });
    expect((await get(ASSET)).status).toBe(404);
  });

  it("404s a logged-out caller once the share is revoked", async () => {
    mockSupabase({ user: null, sharedPath: null });
    expect((await get(ASSET)).status).toBe(404);
  });

  it("404s a malformed id before touching the database", async () => {
    const { rpc } = mockSupabase({ user: null, sharedPath: PATH });
    expect((await get("not-a-uuid")).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});
