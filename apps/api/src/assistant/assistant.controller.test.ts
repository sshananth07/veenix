import { describe, expect, it, vi } from "vitest";
import "./tools.project";
import { createMessage } from "./llm";
import { getConversation, postMessage } from "./assistant.controller";
import { runTurn } from "./turn";
import { AssistantMessageModel } from "./models";
import { ProjectModel } from "../projects/project.model";
import { asOrg, newId } from "../../test/ctx";

vi.mock("./llm", () => ({ createMessage: vi.fn() })); // no member records exist, so the queued jobs stop before the LLM; turns run by hand

const org = newId(), alice = newId(), bob = newId();
const asAlice = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: alice });
const asBob = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: bob });

describe("in-app chat API", () => {
  it("a user only ever gets their own conversation", async () => {
    const [p] = await asAlice(() => ProjectModel.create([{ code: "P1", name: "Condo", clientName: "A" }]));
    await asAlice(() => postMessage({ projectId: String(p._id), text: "alice secret", photos: [] }));
    await asBob(() => postMessage({ projectId: String(p._id), text: "bob here", photos: [] }));
    const a = await asAlice(() => getConversation(String(p._id)));
    const b = await asBob(() => getConversation(String(p._id)));
    expect(a.messages.map((m) => m.text)).toEqual(["alice secret"]);
    expect(b.messages.map((m) => m.text)).toEqual(["bob here"]);
    expect(a.id).not.toEqual(b.id);
  });

  it("the display DTO contains no reasoning or tool call items", async () => {
    const { conversationId } = await asAlice(() => postMessage({ projectId: null, text: "how many tasks?", photos: [] }));
    const msg = (await asAlice(() => AssistantMessageModel.findOne({ text: "how many tasks?" }).lean()))!;
    vi.mocked(createMessage)
      .mockResolvedValueOnce({ status: "completed", output_text: "", output: [
        { type: "reasoning", id: "rs", summary: [], encrypted_content: "SECRET-REASONING" },
        { type: "function_call", call_id: "c1", name: "list_my_tasks", arguments: "{}", id: "fc" },
      ] } as never)
      .mockResolvedValueOnce({ status: "completed", output_text: "You have none.", output: [{ type: "message", id: "m", role: "assistant", content: [{ type: "output_text", text: "You have none." }] }] } as never);
    await asAlice(() => runTurn(msg.conversationId, msg._id));
    const dto = await asAlice(() => getConversation(null));
    expect(dto.id).toBe(conversationId);
    expect(dto.messages.at(-1)).toMatchObject({ role: "assistant", text: "You have none.", steps: [{ name: "list_my_tasks", isError: false }] });
    const raw = JSON.stringify(dto);
    for (const leak of ["SECRET-REASONING", "function_call", "reasoning", "arguments"]) expect(raw).not.toContain(leak);
  });

  it("photos must be real uploads in this organization", async () => {
    const key = `orgs/${newId()}/photos/00000000-0000-4000-8000-000000000000.jpg`;
    await expect(asAlice(() => postMessage({ projectId: null, text: "see photo", photos: [{ key, name: "x.jpg" }] }))).rejects.toThrow("Upload a PNG, JPG or WEBP image");
  });
});
