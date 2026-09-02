import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Keeping a generated image, after the first production save was lost.
 *
 * The preview is a data URL of several megabytes, and the first accept path
 * handed the whole string to a server action, which stops reading its body at
 * one megabyte: the action threw before its first line, the caller's await
 * never settled, and the button spun with no sentence. These pin the shape of
 * the replacement — bytes to storage from the browser, only a row through the
 * action — and what the action refuses.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const dataUrl = (bytes: Uint8Array, claimed = "image/png") =>
  `data:${claimed};base64,${Buffer.from(bytes).toString("base64")}`;

describe("keepGeneratedImage", () => {
  const upload = vi.fn();
  const register = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    upload.mockResolvedValue({ error: null });
    register.mockResolvedValue({
      ok: true,
      data: { id: "asset-1", url: "/api/assets/asset-1/content" },
    });
    vi.doMock("@/lib/supabase/client", () => ({
      supabaseBrowser: () => ({
        auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
        storage: { from: () => ({ upload }) },
      }),
    }));
    vi.doMock("@/lib/data/sourced-assets", () => ({ registerGeneratedImage: register }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock("@/lib/supabase/client");
    vi.doUnmock("@/lib/data/sourced-assets");
  });

  const preview = (bytes: Uint8Array, claimed?: string) => ({
    previewDataUrl: dataUrl(bytes, claimed),
    model: "gpt-image-2",
    prompt: "a calm wash of teal",
    quality: "medium",
    generationMs: 41_702,
  });

  it("sends the bytes to storage and only their description through the action", async () => {
    const { keepGeneratedImage } = await import("@/lib/data/upload-generated");
    const result = await keepGeneratedImage(preview(PNG), {
      altText: "a calm wash of teal",
      presentationId: "1e0c2f8e-7d2f-4a3e-9b6d-2a9a2f1c0d11",
    });

    expect(result).toEqual({
      ok: true,
      asset: { id: "asset-1", url: "/api/assets/asset-1/content", alt: "a calm wash of teal" },
    });

    // The object lands in the caller's own prefix, under the type read out of
    // the bytes, with the bytes themselves.
    const [path, body, options] = upload.mock.calls[0];
    expect(path).toMatch(/^user-1\/[0-9a-f-]{36}\.png$/);
    expect(new Uint8Array(body)).toEqual(PNG);
    expect(options).toMatchObject({ contentType: "image/png", upsert: false });

    // The action never sees a data URL — that is the whole point.
    const registered = register.mock.calls[0][0];
    expect(JSON.stringify(registered)).not.toContain("base64");
    expect(registered).toMatchObject({
      storagePath: path,
      mimeType: "image/png",
      byteSize: PNG.byteLength,
      model: "gpt-image-2",
      prompt: "a calm wash of teal",
      quality: "medium",
      generationMs: 41_702,
      presentationId: "1e0c2f8e-7d2f-4a3e-9b6d-2a9a2f1c0d11",
    });
  });

  it("stores what the bytes are, not what the preview claimed", async () => {
    const { keepGeneratedImage } = await import("@/lib/data/upload-generated");
    await keepGeneratedImage(preview(WEBP, "image/png"), { altText: "", presentationId: null });

    const [path, , options] = upload.mock.calls[0];
    expect(path).toMatch(/\.webp$/);
    expect(options).toMatchObject({ contentType: "image/webp" });
    expect(register.mock.calls[0][0]).toMatchObject({ mimeType: "image/webp" });
  });

  it("refuses bytes that are not an image before anything is uploaded", async () => {
    const { keepGeneratedImage } = await import("@/lib/data/upload-generated");
    const result = await keepGeneratedImage(preview(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), {
      altText: "",
      presentationId: null,
    });
    expect(result.ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("returns the registration's own reason when the row cannot be written", async () => {
    register.mockResolvedValue({ ok: false, error: "Invalid upload path." });
    const { keepGeneratedImage } = await import("@/lib/data/upload-generated");
    const result = await keepGeneratedImage(preview(PNG), { altText: "", presentationId: null });
    expect(result).toEqual({ ok: false, error: "Invalid upload path." });
  });
});

describe("registerGeneratedImage", () => {
  const insert = vi.fn();
  const remove = vi.fn();
  let userId: string | null = "user-1";

  beforeEach(() => {
    vi.resetModules();
    userId = "user-1";
    insert.mockReturnValue({
      select: () => ({ single: async () => ({ data: { id: "asset-9" }, error: null }) }),
    });
    remove.mockResolvedValue({ error: null });
    vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));
    vi.doMock("@/lib/supabase/server", () => ({
      supabaseServer: async () => ({
        auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
        from: () => ({ insert }),
        storage: { from: () => ({ remove }) },
      }),
    }));
    vi.doMock("@/lib/ai/visual-sourcing", () => ({
      fetchImageBytes: vi.fn(),
      storeSourcedImage: vi.fn(),
      IMAGE_PROVIDER: "openai",
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock("next/cache");
    vi.doUnmock("@/lib/supabase/server");
    vi.doUnmock("@/lib/ai/visual-sourcing");
  });

  const input = (overrides: Record<string, unknown> = {}) => ({
    storagePath: "user-1/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.png",
    mimeType: "image/png",
    byteSize: 2_400_000,
    prompt: "a calm wash of teal",
    model: "gpt-image-2",
    quality: "medium",
    generationMs: 41_702,
    altText: "a calm wash of teal",
    presentationId: null,
    ...overrides,
  });

  it("writes the provenance row for an object in the caller's own prefix", async () => {
    const { registerGeneratedImage } = await import("@/lib/data/sourced-assets");
    const result = await registerGeneratedImage(input());

    expect(result).toEqual({
      ok: true,
      data: { id: "asset-9", url: "/api/assets/asset-9/content" },
    });
    expect(insert.mock.calls[0][0]).toMatchObject({
      storage_path: "user-1/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.png",
      mime_type: "image/png",
      byte_size: 2_400_000,
      kind: "image",
      source: "generated",
      provider: "openai",
      model: "gpt-image-2",
      prompt: "a calm wash of teal",
      quality: "medium",
      generation_ms: 41_702,
    });
  });

  it("refuses a path outside the caller's prefix", async () => {
    const { registerGeneratedImage } = await import("@/lib/data/sourced-assets");
    const result = await registerGeneratedImage(input({ storagePath: "user-2/theirs.png" }));
    expect(result).toEqual({ ok: false, error: "Invalid upload path." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses a type the deployment does not keep, and the old bytes-carrying shape", async () => {
    const { registerGeneratedImage } = await import("@/lib/data/sourced-assets");
    expect((await registerGeneratedImage(input({ mimeType: "image/svg+xml" }))).ok).toBe(false);
    expect((await registerGeneratedImage({ dataUrl: dataUrl(PNG), prompt: "x" })).ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    userId = null;
    const { registerGeneratedImage } = await import("@/lib/data/sourced-assets");
    expect(await registerGeneratedImage(input())).toEqual({
      ok: false,
      error: "You're signed out.",
    });
  });
});
