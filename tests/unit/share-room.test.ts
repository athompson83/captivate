import { afterEach, describe, expect, it, vi } from "vitest";
import { ROOM_MAX_BYTES, roomForCard } from "@/lib/marketing/share-room";

/**
 * The room is fetched for the card under a deadline, and anything that is
 * not a drawable picture arriving in time is "no room": the card without
 * its room is the card every deck had, never an error and never a wait.
 */
const picture = (type: string, bytes = 16, status = 200) =>
  new Response(new Uint8Array(bytes).fill(1), { status, headers: { "content-type": type } });

describe("the room for the card", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("hands a picture over as a data URI of its own type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => picture("image/jpeg; charset=binary")),
    );
    const room = await roomForCard("https://pictures.example/room.jpg");
    expect(room).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("goes without a room that is not a picture, not there, empty or too large", async () => {
    const fetchMock = vi.fn(async () => picture("text/html"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await roomForCard("https://pictures.example/room")).toBeNull();
    fetchMock.mockImplementationOnce(async () => picture("image/webp"));
    expect(await roomForCard("https://pictures.example/room.webp")).toBeNull();
    fetchMock.mockImplementationOnce(async () => picture("image/png", 16, 404));
    expect(await roomForCard("https://pictures.example/gone.png")).toBeNull();
    fetchMock.mockImplementationOnce(async () => picture("image/png", 0));
    expect(await roomForCard("https://pictures.example/empty.png")).toBeNull();
    fetchMock.mockImplementationOnce(async () => picture("image/png", ROOM_MAX_BYTES + 1));
    expect(await roomForCard("https://pictures.example/huge.png")).toBeNull();
  });

  it("never fetches anything but https, and treats a failed fetch as no room", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("refused");
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await roomForCard("http://pictures.example/room.jpg")).toBeNull();
    expect(await roomForCard("javascript:alert(1)")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await roomForCard("https://pictures.example/room.jpg")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up on a room that does not arrive within the deadline", async () => {
    // The fetch honours its signal as a real one does: it settles only when
    // aborted. A room that never arrives must not hold the card.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );
    const started = Date.now();
    expect(await roomForCard("https://pictures.example/slow.jpg", 40)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
