import { Schema, model } from "mongoose";
import { orgIdField, tenantPlugin } from "../common/fields";

const searchEntrySchema = new Schema(
  {
    orgId: orgIdField,
    kind: { type: String, required: true },
    refId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, required: true },
    subtitle: { type: String, default: "" },
    keywords: { type: String, default: "" },
  },
  { collection: "search_entries", timestamps: true },
);
searchEntrySchema.index({ orgId: 1, kind: 1, refId: 1 }, { unique: true });
// Org scoping only: the search query applies the project scope itself, so vendors stay findable.
searchEntrySchema.plugin(tenantPlugin);
export const SearchEntryModel = model("SearchEntry", searchEntrySchema);
