import fs from "node:fs";
import path from "node:path";
import { createDatabase } from "../src/db.js";
import { ensureBootstrapData } from "../src/services/bootstrap.js";
import { processSourceDocument } from "../src/services/extractor.js";
import { importSourceDocument } from "../src/services/repositories.js";

const db = createDatabase();
ensureBootstrapData(db);

const sampleDir = path.resolve("sample_mock_data");
const files = fs.readdirSync(sampleDir).filter((file) => file.endsWith(".txt"));

for (const file of files) {
  const rawContent = fs.readFileSync(path.join(sampleDir, file), "utf8");
  const source = importSourceDocument(db, {
    sourceType: file.includes("channel") ? "teams_channel" : "teams_group_chat",
    origin: file,
    rawContent,
    importBatch: "sample-seed",
    sourceTimestamp: "2026-07-24"
  });
  const items = processSourceDocument(db, source.id);
  console.log(`Imported ${file}: ${items.length} review items created`);
}
