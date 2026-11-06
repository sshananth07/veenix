import { Types } from "mongoose";
import { z } from "zod";
import { rule } from "../common/errors";
import { DesignConceptModel } from "../concepts/concept.model";
import { startConcept } from "../concepts/concepts.service";
import { AssistantMessageModel } from "./models";
import { defineTool, type ToolContext } from "./tools";

const id = z.string().regex(/^[a-f\d]{24}$/i, "Use an id from a tool result");
const oid = (s: string | null) => (s ? new Types.ObjectId(s) : null);
const MAX_PHOTOS = 3;

/** This message's photos, or else the latest earlier message's in the same chat. Never a URL. */
async function photoKeys(c: ToolContext) {
  const here = c.attachments.filter((a) => a.kind === "photo").map((a) => a.key);
  if (here.length) return here;
  const earlier = await AssistantMessageModel.findOne({ conversationId: c.conversationId, role: "user", "attachments.kind": "photo" }).sort({ _id: -1 }).select("attachments").lean();
  return (earlier?.attachments ?? []).filter((a) => a.kind === "photo").map((a) => a.key);
}

defineTool({
  name: "generate_room_concept",
  description:
    "Make a room concept from room photos the user sent: a restyled photo and a 3D room to show the client. " +
    "Put finishes, materials, colours, plants and lighting in style. Put room size, which wall the door or window is on, and where furniture goes in layout; " +
    "never put positions in style, or the restyled photo changes its camera. " +
    "Needs exactly one of a project or a lead; ask which if it isn't clear. For another style of an earlier concept, pass fromConceptId instead of photos. " +
    "It takes about a minute and appears in the conversation by itself.",
  input: z.strictObject({
    projectId: id.nullable(),
    leadId: id.nullable(),
    style: z.string().trim().min(1).max(1000),
    layout: z.string().trim().max(1000).nullable(),
    photoIndexes: z.array(z.int().min(0)).max(MAX_PHOTOS).nullable(), // which photos, first is the before image; null for all
    fromConceptId: id.nullable(),
  }),
  permission: "concept:generate",
  level: "background",
  run: async (input, c) => {
    let keys: string[];
    let layout = input.layout || null;
    if (input.fromConceptId) {
      const from = await DesignConceptModel.findById(input.fromConceptId).lean();
      keys = from ? [from.sourceKey, ...from.extraKeys] : [];
      layout ??= from?.layout ?? null;
    } else {
      const all = await photoKeys(c);
      keys = (input.photoIndexes?.length ? input.photoIndexes.map((i) => all[i]).filter(Boolean) : all).slice(0, MAX_PHOTOS);
    }
    if (!keys.length) throw rule("Attach a room photo first.");
    const concept = await startConcept({ projectId: oid(input.projectId), leadId: oid(input.leadId), brief: input.style, layout, sourceKey: keys[0], extraKeys: keys.slice(1) }, c.conversationId);
    return {
      content: `Started concept ${concept._id} ("${concept.name}"). It will appear in this conversation in about a minute.`,
      display: { type: "concept", conceptId: String(concept._id) },
    };
  },
});
