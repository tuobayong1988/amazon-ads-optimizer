// Extracted from production dist/index.js
// Original module: server/_core/systemRouter.ts
// Lines: 333

var systemRouter;
var init_systemRouter = __esm({
  "server/_core/systemRouter.ts"() {
    "use strict";
    init_zod();
    init_notification();
    init_trpc();
    init_drizzle_orm();
    init_db2();
    systemRouter = router({
      // v350: 连接池监控API
      dbPoolStats: adminProcedure.query(async () => {
        const stats4 = getPoolStats();
        return {
          ...stats4,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
      }),
      // v350: 手动触发数据清理
      cleanupOldData: adminProcedure.input(external_exports.object({
        retentionDays: external_exports.number().min(7).max(90).default(30)
      })).mutation(async ({ input }) => {
        const conn = await getDirectConnection(12e4);
        const results = [];
        try {
          const [r1] = await conn.execute(
            `DELETE FROM sync_conflicts WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
            [input.retentionDays]
            // @ts-ignore
          );
          results.push(`sync_conflicts: \u5220\u9664${r1.affectedRows}\u6761`);
          const [r2] = await conn.execute(
            `DELETE FROM sync_change_records WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
            // @ts-ignore
            [input.retentionDays]
          );
          results.push(`sync_change_records: \u5220\u9664${r2.affectedRows}\u6761`);
          const [r3] = await conn.execute(
            // @ts-ignore
            `DELETE FROM system_logs WHERE timestamp < DATE_SUB(NOW(), INTERVAL ? DAY)`,
            [input.retentionDays]
          );
          results.push(`system_logs: \u5220\u9664${r3.affectedRows}\u6761`);
          const [r4] = await conn.execute(
            `DELETE FROM optimization_tasks WHERE status IN ('synced', 'permanently_failed') AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
            [input.retentionDays]
          );
          results.push(`optimization_tasks: \u5220\u9664${r4.affectedRows}\u6761`);
          return { success: true, results };
        } finally {
          conn.release();
        }
      }),
      health: publicProcedure.input(
        external_exports.object({
          timestamp: external_exports.number().min(0, "timestamp cannot be negative")
        })
      ).query(() => ({
        ok: true
      })),
      notifyOwner: adminProcedure.input(
        // @ts-ignore
        external_exports.object({
          title: external_exports.string().min(1, "title is required"),
          content: external_exports.string().min(1, "content is required")
        })
      ).mutation(async ({ input }) => {
        const delivered = await notifyOwner(input);
        return {
          success: delivered
        };
      }),
      // 数据库迁移端点 - 仅管理员可用
      // @ts-ignore
      runMigration: adminProcedure.input(
        external_exports.object({
          migrationName: external_exports.string().min(1)
        })
      ).mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const results = [];
        if (input.migrationName === "0020_add_bidding_logs_columns") {
          try {
            await db.execute(sql`ALTER TABLE bidding_logs ADD COLUMN execution_status enum('pending','success','failed','skipped') DEFAULT 'pending'`);
            results.push("Added execution_status column");
          } catch (e) {
            if (e.message?.includes("Duplicate column")) {
              results.push("execution_status column already exists");
            } else {
              results.push(`Error adding execution_status: ${e.message}`);
            }
          }
          try {
            await db.execute(sql`ALTER TABLE bidding_logs ADD COLUMN api_response_id varchar(128) DEFAULT NULL`);
            results.push("Added api_response_id column");
          } catch (e) {
            if (e.message?.includes("Duplicate column")) {
              results.push("api_response_id column already exists");
            } else {
              results.push(`Error adding api_response_id: ${e.message}`);
            }
          }
          try {
            await db.execute(sql`ALTER TABLE bidding_logs ADD COLUMN error_message text DEFAULT NULL`);
            results.push("Added error_message column");
          } catch (e) {
            if (e.message?.includes("Duplicate column")) {
              results.push("error_message column already exists");
            } else {
              results.push(`Error adding error_message: ${e.message}`);
            }
          }
        } else {
          throw new Error(`Unknown migration: ${input.migrationName}`);
        }
        return { success: true, results };
      }),
      // 诊断端点 - 查询缺少Amazon keywordId的关键词
      diagnoseKeywords: adminProcedure.input(external_exports.object({ accountId: external_exports.number() })).query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const result = await db.execute(sql`
        SELECT 
          COUNT(*) as total_keywords,
          SUM(CASE WHEN keyword_id IS NULL OR keyword_id = '' THEN 1 ELSE 0 END) as missing_keyword_id,
          SUM(CASE WHEN keyword_id IS NOT NULL AND keyword_id != '' THEN 1 ELSE 0 END) as has_keyword_id
        FROM keywords 
        WHERE account_id = ${input.accountId}
      `);
        const biddingResult = await db.execute(sql`
        SELECT 
          execution_status,
          COUNT(*) as count
        FROM bidding_logs 
        WHERE account_id = ${input.accountId}
        GROUP BY execution_status
        ORDER BY count DESC
      `);
        return { keywords: result[0], biddingLogs: biddingResult };
      })
    });
  }
});

// shared/timezone.ts
var timezone_exports = {};
__export(timezone_exports, {
  MARKETPLACE_TIMEZONES: () => MARKETPLACE_TIMEZONES3,
  calculateDateRangeByMarketplace: () => calculateDateRangeByMarketplace,
  formatMarketplaceLocalTime: () => formatMarketplaceLocalTime,
  getMarketplaceCurrentHour: () => getMarketplaceCurrentHour,
  getMarketplaceLocalDate: () => getMarketplaceLocalDate,
  getMarketplaceLocalTime: () => getMarketplaceLocalTime,
  getMarketplaceTimezoneInfo: () => getMarketplaceTimezoneInfo
});
function getMarketplaceLocalDate(marketplace) {
  const config2 = MARKETPLACE_TIMEZONES3[marketplace] || MARKETPLACE_TIMEZONES3["US"];
  const now = /* @__PURE__ */ new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: config2.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(now);
}
function getMarketplaceLocalTime(marketplace) {
  const config2 = MARKETPLACE_TIMEZONES3[marketplace] || MARKETPLACE_TIMEZONES3["US"];
  const now = /* @__PURE__ */ new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config2.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(now);
  const dateObj = {};
  parts.forEach((part) => {
    dateObj[part.type] = part.value;
  });
  return new Date(
    parseInt(dateObj.year),
    parseInt(dateObj.month) - 1,
    parseInt(dateObj.day),
    parseInt(dateObj.hour),
    parseInt(dateObj.minute),
    parseInt(dateObj.second)
  );
}
function calculateDateRangeByMarketplace(marketplace, timeRange) {
  const localDate = getMarketplaceLocalDate(marketplace);
  const [year3, month, day2] = localDate.split("-").map(Number);
  const today = new Date(year3, month - 1, day2);
  let startDate;
  let endDate;
  switch (timeRange) {
    case "today":
      startDate = today;
      endDate = today;
      break;
    case "yesterday":
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 1);
      endDate = startDate;
      break;
    case "7days":
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 6);
      endDate = today;
      break;
    case "14days":
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 13);
      endDate = today;
      break;
    case "30days":
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 29);
      endDate = today;
      break;
    case "60days":
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 59);
      endDate = today;
      break;
    case "90days":
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 89);
      endDate = today;
      break;
    default:
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 6);
      endDate = today;
  }
  const formatDate2 = /* @__PURE__ */ __name((d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, "formatDate");
  return {
    startDate: formatDate2(startDate),
    endDate: formatDate2(endDate)
  };
}
function getMarketplaceTimezoneInfo(marketplace) {
  return MARKETPLACE_TIMEZONES3[marketplace] || MARKETPLACE_TIMEZONES3["US"];
}
function formatMarketplaceLocalTime(marketplace, format = "datetime") {
  const config2 = MARKETPLACE_TIMEZONES3[marketplace] || MARKETPLACE_TIMEZONES3["US"];
  const now = /* @__PURE__ */ new Date();
  const options = {
    timeZone: config2.timezone
  };
  switch (format) {
    case "date":
      options.year = "numeric";
      options.month = "2-digit";
      options.day = "2-digit";
      break;
    case "time":
      options.hour = "2-digit";
      options.minute = "2-digit";
      options.hour12 = false;
      break;
    case "datetime":
      options.year = "numeric";
      options.month = "2-digit";
      options.day = "2-digit";
      options.hour = "2-digit";
      options.minute = "2-digit";
      options.hour12 = false;
      break;
  }
  return new Intl.DateTimeFormat("zh-CN", options).format(now);
}
function getMarketplaceCurrentHour(marketplace) {
  const config2 = MARKETPLACE_TIMEZONES3[marketplace] || MARKETPLACE_TIMEZONES3["US"];
  const now = /* @__PURE__ */ new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: config2.timezone,
    hour: "2-digit",
    hour12: false
  });
  const hourStr = formatter.format(now);
  return parseInt(hourStr);
}
var MARKETPLACE_TIMEZONES3;
var init_timezone2 = __esm({
  "shared/timezone.ts"() {
    "use strict";
    MARKETPLACE_TIMEZONES3 = {
      // 北美
      "US": { timezone: "America/Los_Angeles", name: "\u7F8E\u56FD", offset: -8 },
      // PST/PDT
      "CA": { timezone: "America/Vancouver", name: "\u52A0\u62FF\u5927", offset: -8 },
      // PST/PDT
      "MX": { timezone: "America/Mexico_City", name: "\u58A8\u897F\u54E5", offset: -6 },
      // CST
      // 欧洲
      "UK": { timezone: "Europe/London", name: "\u82F1\u56FD", offset: 0 },
      "DE": { timezone: "Europe/Berlin", name: "\u5FB7\u56FD", offset: 1 },
      "FR": { timezone: "Europe/Paris", name: "\u6CD5\u56FD", offset: 1 },
      "IT": { timezone: "Europe/Rome", name: "\u610F\u5927\u5229", offset: 1 },
      "ES": { timezone: "Europe/Madrid", name: "\u897F\u73ED\u7259", offset: 1 },
      "NL": { timezone: "Europe/Amsterdam", name: "\u8377\u5170", offset: 1 },
      "SE": { timezone: "Europe/Stockholm", name: "\u745E\u5178", offset: 1 },
      "PL": { timezone: "Europe/Warsaw", name: "\u6CE2\u5170", offset: 1 },
      "BE": { timezone: "Europe/Brussels", name: "\u6BD4\u5229\u65F6", offset: 1 },
      // 亚太
      "JP": { timezone: "Asia/Tokyo", name: "\u65E5\u672C", offset: 9 },
      "AU": { timezone: "Australia/Sydney", name: "\u6FB3\u5927\u5229\u4E9A", offset: 11 },
      "SG": { timezone: "Asia/Singapore", name: "\u65B0\u52A0\u5761", offset: 8 },
      "IN": { timezone: "Asia/Kolkata", name: "\u5370\u5EA6", offset: 5.5 },
      "AE": { timezone: "Asia/Dubai", name: "\u963F\u8054\u914B", offset: 4 },
      "SA": { timezone: "Asia/Riyadh", name: "\u6C99\u7279\u963F\u62C9\u4F2F", offset: 3 },
      // 南美
      "BR": { timezone: "America/Sao_Paulo", name: "\u5DF4\u897F", offset: -3 }
    };
    __name(getMarketplaceLocalDate, "getMarketplaceLocalDate");
    __name(getMarketplaceLocalTime, "getMarketplaceLocalTime");
    __name(calculateDateRangeByMarketplace, "calculateDateRangeByMarketplace");
    __name(getMarketplaceTimezoneInfo, "getMarketplaceTimezoneInfo");
    __name(formatMarketplaceLocalTime, "formatMarketplaceLocalTime");
    __name(getMarketplaceCurrentHour, "getMarketplaceCurrentHour");
  }
});

