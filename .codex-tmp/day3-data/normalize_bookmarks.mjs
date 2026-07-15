import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";

const projectDir = "C:/Users/yangd/projects/jeju-irang";
const dataDir = path.join(projectDir, "data");
const inputPath = path.join(dataDir, "bookmarks.csv");
const expected = ["bookmark_id", "nickname", "place_id", "created_at"];
const csvText = (await fs.readFile(inputPath, "utf8")).replace(/^\uFEFF/, "");
const workbook = await Workbook.fromCSV(csvText, { sheetName: "bookmarks" });
const sheet = workbook.worksheets.getItem("bookmarks");
const rows = sheet.getUsedRange(true).values.map((row) => row.map((value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
  return typeof value === "string" ? value.trim() : value;
}));
if (JSON.stringify(rows[0].map(String)) !== JSON.stringify(expected)) throw new Error("Unexpected bookmarks schema");
const ids = new Set();
for (const row of rows.slice(1)) {
  if (!row[0] || !row[1] || !row[2] || !row[3]) throw new Error(`Incomplete bookmark row: ${JSON.stringify(row)}`);
  if (ids.has(String(row[0]))) throw new Error(`Duplicate bookmark_id: ${row[0]}`);
  ids.add(String(row[0]));
}
sheet.getUsedRange().values = rows;

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const output = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
await fs.writeFile(inputPath, output, "utf8");
const preview = await workbook.render({ sheetName: "bookmarks", autoCrop: "all", scale: 1.5, format: "png" });
await fs.writeFile(path.join(projectDir, ".codex-tmp", "day3-data", "bookmarks-preview.png"), new Uint8Array(await preview.arrayBuffer()));
console.log(JSON.stringify({ rows: rows.length - 1, columns: rows[0].length, duplicateIds: 0, incompleteRows: 0 }));
