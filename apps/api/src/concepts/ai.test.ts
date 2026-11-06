import { describe, expect, it, vi } from "vitest";
import { redis } from "../common/redis";
import { asOrg, newId } from "../../test/ctx";
import { imageCostMicros, spendKey } from "../assistant/limits";
import { createMessage } from "../assistant/llm";

const usage = { input_tokens: 1300, input_tokens_details: { text_tokens: 100, image_tokens: 1200 }, output_tokens: 4000, total_tokens: 5300 };
vi.mock("openai", () => ({
  default: class {
    images = { edit: vi.fn().mockResolvedValue({ data: [{ b64_json: Buffer.from([0xff, 0xd8, 1]).toString("base64") }], usage }) };
  },
  toFile: vi.fn(async (b: Buffer) => b),
}));
vi.mock("../assistant/llm", () => ({ createMessage: vi.fn().mockResolvedValue({ output_text: "{}", usage: null }) }));
vi.mock("../config/env", async (importOriginal) => ({ env: { ...(await importOriginal<typeof import("../config/env")>()).env, OPENAI_API_KEY: "test" } }));

describe("image costs", () => {
  it("prices image input, text input and output tokens", () => {
    // US$5, 8 and 30 per 1M tokens: 1 micro-dollar per token times the rate.
    expect(imageCostMicros(usage)).toBe(100 * 5 + 1200 * 8 + 4000 * 30);
  });

  it("a restyle adds its cost to today's spend", async () => {
    const { restyle } = await import("./ai");
    const org = newId();
    await asOrg(org, () => restyle(Buffer.from([0xff, 0xd8]), ".jpg", "Japandi"));
    expect(Number(await redis.get(spendKey(String(org))))).toBe(imageCostMicros(usage));
  });
});

describe("room description", () => {
  it("leaves room for a full v2 room plus reasoning", async () => {
    const { describeRoom } = await import("./ai");
    await asOrg(newId(), () => describeRoom(Buffer.from([0xff, 0xd8]), [], "Japandi", null));
    expect(vi.mocked(createMessage).mock.calls[0][0].max_output_tokens).toBeGreaterThanOrEqual(8_000);
  });
});
