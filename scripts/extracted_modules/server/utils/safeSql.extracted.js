// Extracted from production dist/index.js
// Original module: server/utils/safeSql.ts
// Lines: 22

function safeInClause(ids) {
  const safeIds = ids.map(Number).filter((n) => !isNaN(n) && isFinite(n));
  if (safeIds.length === 0) {
    return sql`-1`;
  }
  return sql.join(safeIds.map((id) => sql`${id}`), sql`, `);
}
function safeStringInClause(values) {
  if (values.length === 0) {
    return sql`''`;
  }
  return sql.join(values.map((v) => sql`${v}`), sql`, `);
}
var init_safeSql = __esm({
  "server/utils/safeSql.ts"() {
    "use strict";
    init_drizzle_orm();
    __name(safeInClause, "safeInClause");
    __name(safeStringInClause, "safeStringInClause");
  }
});

