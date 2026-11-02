import { describe, expect, it, vi } from "vitest";
import { Types } from "mongoose";
import "./tools.project";
import { createMessage } from "./llm";
import { deleteConversation, getConversation, listConversations, postMessage } from "./assistant.controller";
import { runTurn } from "./turn";
import { AssistantMessageModel, AssistantToolCallModel } from "./models";
import { ProjectModel } from "../projects/project.model";
import { asOrg, newId } from "../../test/ctx";

vi.mock("./llm", () => ({ createMessage: vi.fn() })); // no member records exist, so the queued jobs stop before the LLM; turns run by hand

const org = newId(), alice = newId(), bob = newId();
const asAlice = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: alice });
const asBob = <T>(fn: () => Promise<T>) => asOrg(org, fn, { userId: bob });
const send = (text: string, conversationId: string | null = null, projectId: string | null = null) => postMessage({ conversationId, projectId, text, photos: [] });
let aliceChat: string;

describe("in-app chat API", () => {
  it("a user only ever gets their own conversations", async () => {
    const [p] = await asAlice(() => ProjectModel.create([{ code: "P1", name: "Condo", clientName: "A" }]));
    aliceChat = (await asAlice(() => send("alice secret about tiles", null, String(p._id)))).conversationId;
    await asAlice(() => send("and grout", aliceChat));
    await asBob(() => send("bob here"));
    expect((await asAlice(() => getConversation(new Types.ObjectId(aliceChat)))).messages.map((m) => m.text)).toEqual(["alice secret about tiles", "and grout"]);
    await expect(asBob(() => getConversation(new Types.ObjectId(aliceChat)))).rejects.toThrow("Conversation not found");
    await expect(asBob(() => send("sneaking in", aliceChat))).rejects.toThrow("Conversation not found");
    await expect(asBob(() => deleteConversation(new Types.ObjectId(aliceChat)))).rejects.toThrow("Conversation not found");
    expect((await asBob(() => listConversations())).map((c) => c.title)).toEqual(["bob here"]);
    expect(await asAlice(() => listConversations(undefined, p._id))).toMatchObject([{ title: "alice secret about tiles", projectName: "Condo" }]);
  });

  it("search finds a chat by its title or by anything said in it, and only the user's own", async () => {
    await asAlice(() => send("Budget for Taman Desa"));
    expect((await asAlice(() => listConversations("grout"))).map((c) => c.id)).toEqual([aliceChat]);
    expect((await asAlice(() => listConversations("taman desa"))).map((c) => c.title)).toEqual(["Budget for Taman Desa"]);
    expect(await asBob(() => listConversations("grout"))).toEqual([]);
    expect(await asAlice(() => listConversations(".*"))).toEqual([]); // input is literal, not a pattern
  });

  it("the display DTO contains no reasoning or tool call items", async () => {
    const { conversationId } = await asAlice(() => send("how many tasks?"));
    const msg = (await asAlice(() => AssistantMessageModel.findOne({ text: "how many tasks?" }).lean()))!;
    vi.mocked(createMessage)
      .mockResolvedValueOnce({ status: "completed", output_text: "", output: [
        { type: "reasoning", id: "rs", summary: [], encrypted_content: "SECRET-REASONING" },
        { type: "function_call", call_id: "c1", name: "list_my_tasks", arguments: "{}", id: "fc" },
      ] } as never)
      .mockResolvedValueOnce({ status: "completed", output_text: "You have none.", output: [{ type: "message", id: "m", role: "assistant", content: [{ type: "output_text", text: "You have none." }] }] } as never);
    await asAlice(() => runTurn(msg.conversationId, msg._id));
    const dto = await asAlice(() => getConversation(new Types.ObjectId(conversationId)));
    expect(dto.messages.at(-1)).toMatchObject({ role: "assistant", text: "You have none.", steps: [{ name: "list_my_tasks", isError: false }] });
    const raw = JSON.stringify(dto);
    for (const leak of ["SECRET-REASONING", "function_call", "reasoning", "arguments"]) expect(raw).not.toContain(leak);
  });

  it("deleting a chat removes its messages and tool records", async () => {
    const { conversationId } = await asAlice(() => send("delete me"));
    const id = new Types.ObjectId(conversationId);
    await asAlice(() => AssistantToolCallModel.create([{ conversationId: id, messageId: newId(), toolUseId: "x", toolName: "list_my_tasks", result: "[]" }]));
    await asAlice(() => deleteConversation(id));
    expect(await asAlice(() => AssistantMessageModel.countDocuments({ conversationId: id }))).toBe(0);
    expect(await asAlice(() => AssistantToolCallModel.countDocuments({ conversationId: id }))).toBe(0);
    await expect(asAlice(() => getConversation(id))).rejects.toThrow("Conversation not found");
  });

  it("photos must be real uploads in this organization", async () => {
    const key = `orgs/${newId()}/photos/00000000-0000-4000-8000-000000000000.jpg`;
    await expect(asAlice(() => postMessage({ conversationId: null, projectId: null, text: "see photo", photos: [{ key, name: "x.jpg" }] }))).rejects.toThrow("Upload a PNG, JPG or WEBP image");
  });
});
