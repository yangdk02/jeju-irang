import fs from "node:fs/promises";
import path from "node:path";
import { Workbook } from "@oai/artifact-tool";

const projectDir = "C:/Users/yangd/projects/jeju-irang";
const dataDir = path.join(projectDir, "data");
const qaDir = path.join(projectDir, ".codex-tmp", "day3-data");
const placeColumns = [
  "place_id", "place_name", "category_level_2", "city_name", "legal_dong_name", "region_group",
  "road_address", "latitude", "longitude", "phone", "website_url", "closed_days", "opening_hours",
  "free_parking", "paid_parking", "has_admission_fee", "admission_fee", "admission_fee_detail",
  "has_age_limit", "minimum_age", "nursing_room", "stroller_rental", "reservation_url", "space_type",
  "resident_discount", "diaper_changing_table", "photo_url", "description", "review_summary",
];
const bookmarkColumns = ["bookmark_id", "nickname", "place_id", "created_at"];
const booleanColumns = new Set([
  "free_parking", "paid_parking", "has_admission_fee", "has_age_limit", "nursing_room",
  "stroller_rental", "resident_discount", "diaper_changing_table",
]);

function cleanValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
  return typeof value === "string" ? value.trim() : value;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "예"].includes(normalized) ? "TRUE" : "FALSE";
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

async function loadCsv(filename, sheetName) {
  const text = await fs.readFile(path.join(dataDir, filename), "utf8");
  return Workbook.fromCSV(text.replace(/^\uFEFF/, ""), { sheetName });
}

const placesWb = await loadCsv("jeju_irang.csv", "places");
const placesSheet = placesWb.worksheets.getItem("places");
const placeRows = placesSheet.getUsedRange(true).values.map((row) => row.map(cleanValue));
const sourcePlaceColumns = placeRows[0].map(String);
if (JSON.stringify(sourcePlaceColumns) !== JSON.stringify(placeColumns)) {
  throw new Error(`Unexpected places schema: ${sourcePlaceColumns.join(",")}`);
}
const reviewIndex = sourcePlaceColumns.indexOf("review_summary");
for (let row = 1; row < placeRows.length; row++) {
  for (let col = 0; col < sourcePlaceColumns.length; col++) {
    if (booleanColumns.has(sourcePlaceColumns[col])) placeRows[row][col] = normalizeBoolean(placeRows[row][col]);
  }
  if (String(placeRows[row][reviewIndex] ?? "").trim() === "") {
    placeRows[row][reviewIndex] = "등록된 후기 요약 없음";
  }
}
placesSheet.getUsedRange().values = placeRows;

const bookmarksWb = await loadCsv("bookmarks.csv", "bookmarks");
const bookmarksSheet = bookmarksWb.worksheets.getItem("bookmarks");
const bookmarkRows = bookmarksSheet.getUsedRange(true).values.map((row) => row.map(cleanValue));
const sourceBookmarkColumns = bookmarkRows[0].map(String);
if (JSON.stringify(sourceBookmarkColumns) !== JSON.stringify(bookmarkColumns)) {
  throw new Error(`Unexpected bookmarks schema: ${sourceBookmarkColumns.join(",")}`);
}
bookmarksSheet.getUsedRange().values = bookmarkRows;

const placeIds = new Set(placeRows.slice(1).map((row) => String(row[0])));
const orphanBookmarks = bookmarkRows.slice(1).filter((row) => !placeIds.has(String(row[2])));
if (orphanBookmarks.length) throw new Error(`Orphan bookmark rows: ${orphanBookmarks.length}`);

async function atomicWrite(filename, content) {
  const target = path.join(dataDir, filename);
  const temporary = path.join(dataDir, `.${filename}.tmp`);
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, target);
}

await atomicWrite("jeju_irang.csv", toCsv(placeRows));
await atomicWrite("bookmarks.csv", toCsv(bookmarkRows));

const placePreview = await placesWb.render({ sheetName: "places", autoCrop: "all", scale: 1, format: "png" });
const bookmarkPreview = await bookmarksWb.render({ sheetName: "bookmarks", autoCrop: "all", scale: 1.5, format: "png" });
await fs.writeFile(path.join(qaDir, "places-preview.png"), new Uint8Array(await placePreview.arrayBuffer()));
await fs.writeFile(path.join(qaDir, "bookmarks-preview.png"), new Uint8Array(await bookmarkPreview.arrayBuffer()));

console.log(JSON.stringify({
  places: { rows: placeRows.length - 1, columns: placeRows[0].length, filledReviewSummaries: placeRows.slice(1).filter((row) => row[reviewIndex] === "등록된 후기 요약 없음").length },
  bookmarks: { rows: bookmarkRows.length - 1, columns: bookmarkRows[0].length, orphanBookmarks: 0 },
}, null, 2));
