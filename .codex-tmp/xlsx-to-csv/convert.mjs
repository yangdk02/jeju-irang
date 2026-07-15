import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const projectDir = "C:/Users/yangd/projects/jeju-irang";
const dataDir = path.join(projectDir, "data");
const inputNames = ["jeju_irang.xlsx", "bookmarks.xlsx"];

function safeFilePart(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/g, "") || "Sheet";
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === "boolean") {
    text = value ? "TRUE" : "FALSE";
  } else {
    text = String(value);
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const report = [];
for (const inputName of inputNames) {
  const inputPath = path.join(dataDir, inputName);
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
  const sheetInfo = JSON.parse((await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 10000 })).ndjson)
  const sheets = workbook.worksheets.items;
  const base = path.parse(inputName).name;
  const created = [];

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const used = sheet.getUsedRange(true);
    const values = used ? used.values : [];
    const suffix = sheets.length === 1 ? "" : `__${safeFilePart(sheet.name)}`;
    const outputName = `${base}${suffix}.csv`;
    const outputPath = path.join(dataDir, outputName);
    await fs.writeFile(outputPath, "\uFEFF" + toCsv(values), "utf8");

    const preview = await workbook.render({ sheetName: sheet.name, autoCrop: "all", scale: 1, format: "png" });
    const previewPath = path.join(projectDir, ".codex-tmp", "xlsx-to-csv", `${base}__${i + 1}.png`);
    await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

    created.push({ sheet: sheet.name, outputName, rows: values.length, columns: values.reduce((m, r) => Math.max(m, r.length), 0), previewPath });
  }
  report.push({ inputName, sheetInfo, created });
}

console.log(JSON.stringify(report, null, 2));
