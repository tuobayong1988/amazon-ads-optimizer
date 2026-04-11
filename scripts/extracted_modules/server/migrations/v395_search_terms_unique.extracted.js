// Extracted from production dist/index.js
// Original module: server/migrations/v395_search_terms_unique.ts
// Lines: 88

var v395_search_terms_unique_exports = {};
__export(v395_search_terms_unique_exports, {
  runV395SearchTermsUnique: () => runV395SearchTermsUnique
});
async function runV395SearchTermsUnique(db) {
  log126.info("[v395] \u5F00\u59CBsearch_terms\u552F\u4E00\u7EA6\u675F\u8FC1\u79FB...");
  try {
    const checkSql = `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'search_terms' AND INDEX_NAME = 'uk_search_term'`;
    const checkResult = await db.execute(sql.raw(checkSql));
    const constraintExists = checkResult?.[0]?.[0]?.cnt > 0 || checkResult?.[0]?.cnt > 0;
    if (constraintExists) {
      log126.info("[v395] \u552F\u4E00\u7EA6\u675F uk_search_term \u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7\u8FC1\u79FB");
      return;
    }
    const countResult = await db.execute(sql.raw(
      "SELECT COUNT(*) as total FROM search_terms"
    ));
    const totalBefore = countResult?.[0]?.[0]?.total || countResult?.[0]?.total || 0;
    log126.info(`[v395] \u5F53\u524Dsearch_terms\u603B\u8BB0\u5F55\u6570: ${totalBefore}`);
    log126.info("[v395] \u5F00\u59CB\u6E05\u7406\u91CD\u590D\u641C\u7D22\u8BCD\u6570\u636E...");
    const deleteResult = await db.execute(sql.raw(
      `DELETE t1 FROM search_terms t1
       INNER JOIN (
         SELECT MAX(id) as keep_id, accountId, campaignId, internal_ad_group_id, searchTerm, reportStartDate
         FROM search_terms
         GROUP BY accountId, campaignId, internal_ad_group_id, searchTerm, reportStartDate
       ) t2 ON t1.accountId = t2.accountId 
         AND t1.campaignId = t2.campaignId 
         AND t1.internal_ad_group_id = t2.internal_ad_group_id 
         AND t1.searchTerm = t2.searchTerm 
         AND (t1.reportStartDate = t2.reportStartDate OR (t1.reportStartDate IS NULL AND t2.reportStartDate IS NULL))
       WHERE t1.id < t2.keep_id`
    ));
    const deletedCount = deleteResult?.[0]?.affectedRows || deleteResult?.affectedRows || 0;
    log126.info(`[v395] \u6E05\u7406\u5B8C\u6210\uFF0C\u5220\u9664\u4E86 ${deletedCount} \u6761\u91CD\u590D\u8BB0\u5F55`);
    await db.execute(sql.raw(
      `UPDATE search_terms SET reportStartDate = DATE(createdAt) WHERE reportStartDate IS NULL`
    ));
    log126.info("[v395] \u5DF2\u5C06NULL\u7684reportStartDate\u56DE\u586B\u4E3AcreatedAt\u65E5\u671F");
    try {
      await db.execute(sql.raw(
        `ALTER TABLE search_terms ADD UNIQUE INDEX uk_search_term (accountId, campaignId, internal_ad_group_id, searchTerm(191), reportStartDate)`
      ));
      log126.info("[v395] \u552F\u4E00\u7EA6\u675F uk_search_term \u521B\u5EFA\u6210\u529F");
    } catch (error48) {
      const errMsg = error48.message || "";
      if (errMsg.includes("Duplicate key name") || error48.code === "ER_DUP_KEYNAME") {
        log126.info("[v395] \u552F\u4E00\u7EA6\u675F uk_search_term \u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7");
      } else if (errMsg.includes("Duplicate entry")) {
        log126.warn("[v395] \u4ECD\u6709\u91CD\u590D\u6570\u636E\uFF0C\u6267\u884C\u66F4\u6FC0\u8FDB\u7684\u6E05\u7406...");
        await db.execute(sql.raw(
          `DELETE t1 FROM search_terms t1
           INNER JOIN search_terms t2
           WHERE t1.id < t2.id
             AND t1.accountId = t2.accountId
             AND t1.campaignId = t2.campaignId
             AND t1.internal_ad_group_id = t2.internal_ad_group_id
             AND LEFT(t1.searchTerm, 191) = LEFT(t2.searchTerm, 191)
             AND t1.reportStartDate = t2.reportStartDate`
        ));
        await db.execute(sql.raw(
          `ALTER TABLE search_terms ADD UNIQUE INDEX uk_search_term (accountId, campaignId, internal_ad_group_id, searchTerm(191), reportStartDate)`
        ));
        log126.info("[v395] \u4E8C\u6B21\u6E05\u7406\u540E\u552F\u4E00\u7EA6\u675F\u521B\u5EFA\u6210\u529F");
      } else {
        throw error48;
      }
    }
    const countAfter = await db.execute(sql.raw(
      "SELECT COUNT(*) as total FROM search_terms"
    ));
    const totalAfter = countAfter?.[0]?.[0]?.total || countAfter?.[0]?.total || 0;
    log126.info(`[v395] \u8FC1\u79FB\u5B8C\u6210: \u6E05\u7406\u524D=${totalBefore}, \u6E05\u7406\u540E=${totalAfter}, \u51CF\u5C11=${Number(totalBefore) - Number(totalAfter)}\u6761`);
  } catch (error48) {
    log126.warn(`[v395] search_terms\u552F\u4E00\u7EA6\u675F\u8FC1\u79FB\u5931\u8D25 (\u53EF\u80FD\u5DF2\u5E94\u7528): ${error48.message}`);
  }
}
var log126;
var init_v395_search_terms_unique = __esm({
  "server/migrations/v395_search_terms_unique.ts"() {
    "use strict";
    init_drizzle_orm();
    init_logger();
    log126 = createModuleLogger("Migration-v395-search-terms-unique");
    __name(runV395SearchTermsUnique, "runV395SearchTermsUnique");
  }
});

