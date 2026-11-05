import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Types } from "mongoose";
import "./tools.project";
import { createMessage } from "./llm";
import { runTurn, startTurn } from "./turn";
import { AssistantConversationModel, AssistantMessageModel, AssistantToolCallModel } from "./models";
import { executeTool } from "./tools";
import { DAILY_SPEND_CAP_MICROS, MAX_LOOP_TURNS } from "./limits";
import { runDue } from "../jobs/jobs";
import { JobModel } from "../jobs/job.model";
import { redis } from "../common/redis";
import { ProjectModel } from "../projects/project.model";
import { SiteUpdateModel } from "../updates/site-update.model";
import { asOrg, newId } from "../../test/ctx";

vi.mock("./llm", () => ({ createMessage: vi.fn() }));
const llm = vi.mocked(createMessage);

const org = newId(), user = newId();
let project: Types.ObjectId;
const as = <T>(fn: () => Promise<T>, o = org) => asOrg(o, fn, { userId: user });

const usage = { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 110 };
const say = (text: string) => ({ type: "message", id: "msg", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] });
const call = (name: string, args: object, id = randomUUID()) => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args), id: `fc_${id}`, status: "completed" });
const resp = (output: object[], over: object = {}) =>
  ({ id: "r", status: "completed", output, output_text: output.flatMap((o) => ("content" in o ? (o.content as { text: string }[]).map((c) => c.text) : [])).join(""), usage, ...over }) as never;
const update = (text = "tiling done") => call("add_project_update", { projectId: String(project), kind: "progress", text, attachPhotos: false });

async function newTurn(o = org, text = "hello", channel = "app") {
  return as(async () => {
    const [conv] = await AssistantConversationModel.create([{ userId: user, channel, projectId: newId() }]);
    const [m] = await AssistantMessageModel.create([{ conversationId: conv._id, role: "user", text }]);
    await AssistantMessageModel.updateOne({ _id: m._id }, { $set: { turnOf: m._id } });
    return { conv: conv._id, msg: m._id };
  }, o);
}
const turnMessages = (t: { conv: Types.ObjectId; msg: Types.ObjectId }) => as(() => AssistantMessageModel.find({ conversationId: t.conv, turnOf: t.msg }).sort({ _id: 1 }).lean());

beforeEach(() => llm.mockReset());

describe("assistant turn", () => {
  it("loops until the model answers and saves every response before running its tools", async () => {
    [project] = (await as(() => ProjectModel.create([{ code: "P1", name: "Taman Desa", clientName: "A" }]))).map((p) => p._id);
    const t = await newTurn();
    llm.mockImplementationOnce(async () => {
      expect((await turnMessages(t)).map((m) => m.role)).toEqual(["user", "context"]);
      return resp([update()]);
    });
    llm.mockImplementationOnce(async (params) => {
      expect(JSON.stringify(params.input)).toContain("function_call_output");
      return resp([say("Done, update added.")]);
    });
    await as(() => runTurn(t.conv, t.msg));
    expect((await turnMessages(t)).map((m) => m.role)).toEqual(["user", "context", "assistant", "tool", "assistant"]);
    expect(await as(() => SiteUpdateModel.countDocuments({ projectId: project }))).toBe(1);
    expect(llm.mock.calls[0][0]).toMatchObject({ store: false, tool_choice: "auto", include: ["reasoning.encrypted_content"] });
  });

  it("tells the model to ask for card fields first on WhatsApp only", async () => {
    const context = async (channel: string) => {
      const t = await newTurn(org, "add a BOM line", channel);
      llm.mockResolvedValueOnce(resp([say("Which price?")]));
      await as(() => runTurn(t.conv, t.msg));
      return (await turnMessages(t)).find((m) => m.role === "context")!.text;
    };
    expect(await context("whatsapp")).toContain("ask for any price or payment terms");
    expect(await context("app")).not.toContain("WhatsApp");
  });

  it("returns all tool results in one message, marking failures", async () => {
    const t = await newTurn();
    llm.mockResolvedValueOnce(resp([update("a"), call("set_project_stage", { projectId: String(project), stage: "NOPE", cancelReason: null })])).mockResolvedValueOnce(resp([say("ok")]));
    await as(() => runTurn(t.conv, t.msg));
    const tool = (await turnMessages(t)).find((m) => m.role === "tool")!;
    expect(tool.items).toHaveLength(2);
    expect((tool.items[1] as { output: string }).output).toMatch(/^Error: /);
  });

  it("stops at the loop limit with a plain message", async () => {
    const t = await newTurn();
    llm.mockImplementation(async () => resp([call("list_my_tasks", {})]));
    await as(() => runTurn(t.conv, t.msg));
    expect(llm).toHaveBeenCalledTimes(MAX_LOOP_TURNS);
    expect((await turnMessages(t)).at(-1)!.text).toContain("too many steps");
  });

  it("stops at 10 tool calls in one message", async () => {
    const t = await newTurn();
    llm.mockImplementation(async () => resp(Array.from({ length: 6 }, () => call("list_my_tasks", {}))));
    await as(() => runTurn(t.conv, t.msg));
    expect(llm).toHaveBeenCalledTimes(2);
    expect(await as(() => AssistantToolCallModel.countDocuments({ messageId: t.msg }))).toBe(6);
    expect((await turnMessages(t)).at(-1)!.text).toContain("too many steps");
  });

  it("stops before the LLM for a removed member", async () => {
    const conv = await as(async () => (await AssistantConversationModel.create([{ userId: user, channel: "app", projectId: newId() }]))[0]._id);
    await as(() => startTurn({ conversationId: conv, text: "hi", attachments: [] })); // no membership exists for this user
    await runDue();
    expect(await JobModel.findOne({ type: "assistant.turn" }).lean()).toMatchObject({ status: "done" });
    expect(llm).not.toHaveBeenCalled();
  });

  it("stops at the daily spend cap", async () => {
    const capped = newId();
    const t = await newTurn(capped);
    await redis.set(`llm:spend:${capped}:${new Date().toISOString().slice(0, 10)}`, DAILY_SPEND_CAP_MICROS);
    await as(() => runTurn(t.conv, t.msg), capped);
    expect(llm).not.toHaveBeenCalled();
    expect((await as(() => AssistantMessageModel.find({ conversationId: t.conv }).sort({ _id: 1 }).lean(), capped)).at(-1)!.text).toContain("today's limit");
  });

  it("runs no tools when the response was refused or cut off", async () => {
    for (const over of [{ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }]) {
      const t = await newTurn();
      llm.mockResolvedValueOnce(resp([update("half")], over));
      await as(() => runTurn(t.conv, t.msg));
      expect((await turnMessages(t)).at(-1)!.text).toContain("couldn't finish");
    }
    const t = await newTurn();
    llm.mockResolvedValueOnce(resp([{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "No." }] }, update("refused")]));
    await as(() => runTurn(t.conv, t.msg));
    expect(await as(() => SiteUpdateModel.countDocuments({ text: { $in: ["half", "refused"] } }))).toBe(0);
  });

  it("resumes after a crash without repeating tools", async () => {
    const t = await newTurn();
    const first = update("once");
    await as(async () => {
      await AssistantMessageModel.create([{ conversationId: t.conv, role: "context", text: "ctx", turnOf: t.msg }]);
      await AssistantMessageModel.create([{ conversationId: t.conv, role: "assistant", items: [first], stop: "completed", turnOf: t.msg }]);
      // The tool ran and was recorded, then the job died before saving the tool message.
      await executeTool({ conversationId: t.conv, messageId: t.msg, attachments: [] }, { id: first.call_id, name: first.name, input: JSON.parse(first.arguments) });
    });
    llm.mockResolvedValueOnce(resp([say("Added.")]));
    await as(() => runTurn(t.conv, t.msg));
    expect(await as(() => SiteUpdateModel.countDocuments({ text: "once" }))).toBe(1);
    expect(llm).toHaveBeenCalledTimes(1);
  });
});
