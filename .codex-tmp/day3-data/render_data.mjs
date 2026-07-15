import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";

const projectDir = "C:/Users/yangd/projects/jeju-irang";
const dataDir = path.join(projectDir, "data");
const qaDir = path.join(projectDir, ".codex-tmp", "day3-data");
for (const [filename, sheetName, scale] of [["jeju_irang.csv", "places", 1], ["bookmarks.csv", "bookmarks", 1.5]]) {
  const csv = (await fs.readFile(path.join(dataDir, filename), "utf8")).replace(/^\uFEFF/, "");
  const workbook = await Workbook.fromCSV(csv, { sheetName });
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale, format: "png" });
  await fs.writeFile(path.join(qaDir, `${sheetName}-final.png`), new Uint8Array(await preview.arrayBuffer()));
  const used = workbook.worksheets.getItem(sheetName).getUsedRange(true).values;
  console.log(`${filename}: ${used.length - 1} rows x ${used[0].length} columns`);
}
