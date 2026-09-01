import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Which gateway makes a picture, and what comes back from it.
 *
 * The two questions are related by one bug. Image generation used to be one
 * provider and therefore one file type, so the accept path tested for a PNG
 * signature and stored `image/png`. The moment a deployment could choose its
 * model that stopped being true, and the check written to catch a *lie* — the
 * browser claiming a data URL is an image — would instead reject a perfectly
 * good WebP, or worse, store one under a content type that renders nowhere.
 */

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("@/lib/ai/visual-sourcing");
}

/** The first bytes of each format, which is all the sniffer reads. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
]);

describe("choosing an image gateway", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps a working OpenAI deployment on OpenAI when a second key appears", async () => {
    // Same rule as the text provider, for the same reason: adding a key must
    // not move a deployment onto a different bill and a different model
    // without anybody choosing it.
    const m = await load({
      OPENAI_API_KEY: "sk-openai",
      OPENROUTER_API_KEY: "sk-or",
      CAPTIVATE_IMAGE_PROVIDER: "",
    });
    expect(m.IMAGE_PROVIDER).toBe("openai");
    expect(m.isImageGenerationConfigured()).toBe(true);
  });

  it("uses OpenRouter when that is the only key present", async () => {
    const m = await load({
      OPENAI_API_KEY: "",
      OPENROUTER_API_KEY: "sk-or",
      CAPTIVATE_IMAGE_PROVIDER: "",
    });
    expect(m.IMAGE_PROVIDER).toBe("openrouter");
    // The part that matters to an author: with only an OpenRouter key set,
    // the picker used to say image generation was unavailable while a working
    // key sat in the environment.
    expect(m.isImageGenerationConfigured()).toBe(true);
  });

  it("resolves independently of the text gateway", async () => {
    // Running text through OpenRouter and images through OpenAI, or the
    // reverse, is a reasonable thing to want — a deployment might have credit
    // in one place and a preferred image model in the other.
    const m = await load({
      OPENAI_API_KEY: "sk-openai",
      OPENROUTER_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      CAPTIVATE_IMAGE_PROVIDER: "",
      CAPTIVATE_AI_PROVIDER: "",
    });
    const text = await import("@/lib/ai/provider");
    expect(m.IMAGE_PROVIDER).toBe("openai");
    expect(text.AI_PROVIDER).toBe("anthropic");
  });

  it("reports itself unconfigured with no key at all, rather than half-on", async () => {
    const m = await load({
      OPENAI_API_KEY: "",
      OPENROUTER_API_KEY: "",
      CAPTIVATE_IMAGE_PROVIDER: "",
    });
    expect(m.isImageGenerationConfigured()).toBe(false);
  });
});

describe("what the bytes actually are", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("recognises each type a generated image can arrive as", async () => {
    const { sniffImage } = await load({});
    expect(sniffImage(PNG)).toEqual({ mimeType: "image/png", extension: "png" });
    expect(sniffImage(JPEG)).toEqual({ mimeType: "image/jpeg", extension: "jpg" });
    expect(sniffImage(WEBP)).toEqual({ mimeType: "image/webp", extension: "webp" });
  });

  it("still refuses something that is not an image at all", async () => {
    // The check this replaced existed to catch a browser claiming a data URL
    // holds a picture. Widening the accepted set must not widen that.
    const { sniffImage } = await load({});
    expect(sniffImage(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull(); // "<svg"
    expect(sniffImage(new Uint8Array([0x4d, 0x5a]))).toBeNull(); // a DOS executable
    expect(sniffImage(new Uint8Array([]))).toBeNull();
  });

  it("is not fooled by a RIFF container that is not WebP", async () => {
    // RIFF is a wrapper — a .wav is RIFF too. Reading only the first four
    // bytes would store an audio file as an image.
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    const { sniffImage } = await load({});
    expect(sniffImage(wav)).toBeNull();
  });
});
