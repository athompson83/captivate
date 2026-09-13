import { afterEach, describe, expect, it, vi } from "vitest";
import { ROOM_MAX_BYTES, readCapped, roomAssetId, roomForCard } from "@/lib/marketing/share-room";

/**
 * The room is fetched for the card under a deadline, only from the deck's
 * own storage, and anything that is not a drawable picture arriving in time
 * is "no room": the card without its room is the card every deck had, never
 * an error and never a wait.
 */
const ASSET = "0f3c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6";
const ROOM = `/api/assets/${ASSET}/content`;

const jpeg = (size = 32) => {
  const bytes = new Uint8Array(new ArrayBuffer(size)).fill(1);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
};
const png = () => {
  const bytes = new Uint8Array(new ArrayBuffer(32)).fill(1);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
};

const body = (bytes: Uint8Array<ArrayBuffer>, init: ResponseInit = {}) =>
  new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" }, ...init });

const source = (type = "image/jpeg") =>
  vi.fn(async (assetId: string) =>
    assetId === ASSET ? { url: "https://storage.example/signed/room.jpg", type } : null,
  );

describe("the room for the card", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the asset behind an app-owned room address, and nothing else", () => {
    // Codex, reviewing the PR: every room the app makes, finds or uploads is
    // addressed as `/api/assets/<id>/content`, and the first draft refused
    // exactly those — the room reached the card only when linked by hand.
    expect(roomAssetId(ROOM)).toBe(ASSET);
    expect(roomAssetId(`/api/assets/${ASSET.toUpperCase()}/content`)).toBe(ASSET);
    expect(roomAssetId("https://pictures.example/room.jpg")).toBeNull();
    expect(roomAssetId("javascript:alert(1)")).toBeNull();
    expect(roomAssetId("/api/assets/not-a-uuid/content")).toBeNull();
    expect(roomAssetId("/api/assets/" + ASSET)).toBeNull();
  });

  it("carries a room the deck holds, read from its own storage, as its real type", async () => {
    const fetchMock = vi.fn(async () => body(png(), { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const from = source("image/png");
    const room = await roomForCard(ROOM, from);
    expect(from).toHaveBeenCalledWith(ASSET);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.example/signed/room.jpg",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(room).toMatch(/^data:image\/png;base64,/);
  });

  it("never fetches an address an author typed, and never asks the source about it", async () => {
    // Codex, reviewing the PR: a room linked by hand is any https address,
    // and the server fetching it is a request to a host of the author's
    // choosing. The viewer loads such a room in the browser; the card goes
    // without it.
    const fetchMock = vi.fn(async () => body(jpeg()));
    vi.stubGlobal("fetch", fetchMock);
    const from = source();
    expect(await roomForCard("https://pictures.example/room.jpg", from)).toBeNull();
    expect(await roomForCard("http://169.254.169.254/latest/meta-data", from)).toBeNull();
    expect(from).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("goes without a room the link-holder may not see, or that is not a drawable picture", async () => {
    const fetchMock = vi.fn(async () => body(jpeg()));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await roomForCard(
        ROOM,
        vi.fn(async () => null),
      ),
    ).toBeNull();
    expect(await roomForCard(ROOM, source("image/webp"))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    // Declared a JPEG, but the bytes are not one.
    fetchMock.mockImplementationOnce(async () => body(new Uint8Array(new ArrayBuffer(32)).fill(7)));
    expect(await roomForCard(ROOM, source())).toBeNull();
    fetchMock.mockImplementationOnce(async () => body(jpeg(), { status: 404 }));
    expect(await roomForCard(ROOM, source())).toBeNull();
  });

  it("gives up on a picture past the cap, declared or streamed, without holding it", async () => {
    // Codex, reviewing the PR: the first draft buffered the whole body before
    // measuring it, so an unfurl could hold far more than the cap on its way
    // to saying no.
    const declared = vi.fn(async () =>
      body(jpeg(), {
        headers: { "content-type": "image/jpeg", "content-length": String(ROOM_MAX_BYTES + 1) },
      }),
    );
    vi.stubGlobal("fetch", declared);
    expect(await roomForCard(ROOM, source())).toBeNull();

    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1_000_000).fill(1));
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(await readCapped(endless, ROOM_MAX_BYTES)).toBeNull();
    expect(cancelled).toBe(true);
  });

  it("gives up on a room that does not arrive within the deadline", async () => {
    // The source never answers; the card must not wait for it.
    const never = vi.fn(() => new Promise<null>(() => {}));
    const started = Date.now();
    expect(await roomForCard(ROOM, never, 40)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);

    // The storage read honours its signal as a real fetch does.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );
    expect(await roomForCard(ROOM, source(), 40)).toBeNull();
  });
});
