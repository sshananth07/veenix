import mongoose from "mongoose";
import "../src/models";
import { connectDb } from "../src/common/db";
import { SEARCH_INDEX_DEFINITION } from "../src/search/search";

async function main() {
  await connectDb();
  for (const name of mongoose.modelNames()) {
    await mongoose.model(name).syncIndexes();
    console.log(`indexes ok: ${name}`);
  }
  const coll = mongoose.connection.collection("search_entries");
  const existing = await coll.listSearchIndexes("search_entries").toArray();
  if (existing.length === 0) await coll.createSearchIndex({ name: "search_entries", definition: SEARCH_INDEX_DEFINITION });
  else await coll.updateSearchIndex("search_entries", SEARCH_INDEX_DEFINITION);
  console.log("search index ok");
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
