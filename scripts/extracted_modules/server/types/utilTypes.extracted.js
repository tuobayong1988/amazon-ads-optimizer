// Extracted from production dist/index.js
// Original module: server/types/utilTypes.ts
// Lines: 29

function getAffectedRows(result) {
  if (!result || !Array.isArray(result)) return 0;
  const header = result[0];
  if (header && typeof header === "object" && "affectedRows" in header) {
    return Number(header.affectedRows) || 0;
  }
  return 0;
}
function extractRows2(result) {
  if (!result || !Array.isArray(result)) return [];
  const rows = result[0];
  if (Array.isArray(rows)) return rows;
  return [];
}
function extractCount(result, field = "cnt") {
  const rows = extractRows2(result);
  if (rows.length === 0) return 0;
  const row = rows[0];
  return Number(row[field] || row["count"] || row["COUNT(*)"] || 0);
}
var init_utilTypes = __esm({
  "server/types/utilTypes.ts"() {
    "use strict";
    __name(getAffectedRows, "getAffectedRows");
    __name(extractRows2, "extractRows");
    __name(extractCount, "extractCount");
  }
});

