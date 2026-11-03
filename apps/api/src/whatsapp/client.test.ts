import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { getMedia, inWindow, MediaTooLargeError, sendButtons, sendCtaUrl, sendTemplate, sendText, showTyping, WhatsAppSendError } from "./client";

const fetchMock = vi.fn();
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const sent = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);

beforeAll(() => {
  Object.assign(env, { WHATSAPP_ACCESS_TOKEN: "token", WHATSAPP_PHONE_NUMBER_ID: "PNID" });
  vi.stubGlobal("fetch", fetchMock);
});
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ok({ messages: [{ id: "wamid.out" }] }));
});

describe("WhatsApp client", () => {
  it("sends text to the phone number's messages endpoint with the access token", async () => {
    await sendText("60123456789", "Hello");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/PNID\/messages$/);
    expect(init.headers.authorization).toBe("Bearer token");
    expect(sent()).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "60123456789", type: "text", text: { body: "Hello", preview_url: false } });
  });

  it("sends reply buttons, and rejects bad buttons before calling Meta", async () => {
    await sendButtons("60123456789", "Accept Ali's quote?", [{ id: "approve:a1", title: "Approve" }, { id: "reject:a1", title: "Reject" }]);
    expect(sent()).toMatchObject({
      type: "interactive",
      interactive: { type: "button", body: { text: "Accept Ali's quote?" }, action: { buttons: [{ type: "reply", reply: { id: "approve:a1", title: "Approve" } }, { type: "reply", reply: { id: "reject:a1", title: "Reject" } }] } },
    });
    fetchMock.mockClear();
    expect(() => sendButtons("60123456789", "x", [{ id: "a", title: "This title is far too long" }])).toThrow("1-20 characters");
    expect(() => sendButtons("60123456789", "x", [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: `B${i}` })))).toThrow("1-3");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a cta_url with a header image, and checks the button text", async () => {
    await sendCtaUrl("60123456789", { body: "Your concept is ready", buttonText: "Open 3D view", url: "https://app.veenix.my/concepts/1", headerImageUrl: "https://s3/preview.jpg" });
    expect(sent()).toMatchObject({
      type: "interactive",
      interactive: {
        type: "cta_url", header: { type: "image", image: { link: "https://s3/preview.jpg" } }, body: { text: "Your concept is ready" },
        action: { name: "cta_url", parameters: { display_text: "Open 3D view", url: "https://app.veenix.my/concepts/1" } },
      },
    });
    expect(() => sendCtaUrl("60123456789", { body: "x", buttonText: "Open the 3D view in Veenix", url: "https://x" })).toThrow("1-20 characters");
  });

  it("sends a template and the typing indicator", async () => {
    await sendTemplate("60123456789", "morning_summary", "en", [{ type: "body", parameters: [{ type: "text", text: "3" }] }]);
    expect(sent()).toMatchObject({ type: "template", template: { name: "morning_summary", language: { code: "en" }, components: [{ type: "body" }] } });
    await showTyping("wamid.in");
    expect(sent()).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.in", typing_indicator: { type: "text" } });
  });

  it("a Meta error raises WhatsAppSendError", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }), { status: 400 }));
    await expect(sendText("60123456789", "late")).rejects.toThrow(WhatsAppSendError);
  });

  it("downloads media in two steps, and refuses over 16 MB without downloading", async () => {
    fetchMock.mockResolvedValueOnce(ok({ url: "https://lookaside.fbsbx.com/m/1", mime_type: "audio/ogg", file_size: 3 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    expect(await getMedia("MEDIA1")).toEqual({ bytes: Buffer.from([1, 2, 3]), mimeType: "audio/ogg" });
    expect(fetchMock.mock.calls[1][0]).toBe("https://lookaside.fbsbx.com/m/1");
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe("Bearer token");

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(ok({ url: "https://lookaside.fbsbx.com/m/2", mime_type: "video/mp4", file_size: 17 * 1024 * 1024 }));
    await expect(getMedia("MEDIA2")).rejects.toThrow(MediaTooLargeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the reply window is 24 hours from the last inbound message", () => {
    expect(inWindow({ lastInboundAt: new Date(Date.now() - 23 * 3_600_000) })).toBe(true);
    expect(inWindow({ lastInboundAt: new Date(Date.now() - 25 * 3_600_000) })).toBe(false);
    expect(inWindow({ lastInboundAt: null })).toBe(false);
  });
});
