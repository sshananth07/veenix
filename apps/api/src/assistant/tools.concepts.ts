import { Types } from "mongoose";
import { z } from "zod";
import { rule } from "../common/errors";
import { DesignConceptModel } from "../concepts/concept.model";
import { startConcept } from "../concepts/concepts.service";
import { defineTool } from "./tools";

const id = z.string().regex(/^[a-f\d]{24}$/i, "Use an id from a tool result");
const oid = (s: string | null) => (s ? new Types.ObjectId(s) : null);

defineTool({
  name: "generate_room_concept",
  description:
    "Make a room concept from a room photo the user attached: a restyled photo and a 3D room to show the client. " +
    "Needs exactly one of a project or a lead; ask which if it isn't clear. For another style of an earlier concept, pass fromConceptId instead of a photo. " +
    "It takes about a minute and appears in the conversation by itself.",
  input: z.strictObject({
    projectId: id.nullable(),
    leadId: id.nullable(),
    brief: z.string().trim().min(1).max(2000),
    photoIndex: z.int().min(0).nullable(), // which attached photo; null for the first
    fromConceptId: id.nullable(),
  }),
  permission: "concept:generate",
  level: "background",
  run: async (input, c) => {
    // The photo comes from this message's attachments or an earlier concept, never from a URL.
    const sourceKey = input.fromConceptId
      ? (await DesignConceptModel.findById(input.fromConceptId).lean())?.sourceKey
      : c.attachments.filter((a) => a.kind === "photo")[input.photoIndex ?? 0]?.key;
    if (!sourceKey) throw rule("Attach a room photo first.");
    const concept = await startConcept({ projectId: oid(input.projectId), leadId: oid(input.leadId), brief: input.brief, sourceKey }, c.conversationId);
    return {
      content: `Started concept ${concept._id} ("${concept.name}"). It will appear in this conversation in about a minute.`,
      display: { type: "concept", conceptId: String(concept._id) },
    };
  },
});
