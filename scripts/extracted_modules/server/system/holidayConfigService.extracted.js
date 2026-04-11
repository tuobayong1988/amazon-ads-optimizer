// Extracted from production dist/index.js
// Original module: server/system/holidayConfigService.ts
// Lines: 235

async function ensureHolidayTable() {
  if (tableEnsured2) return;
  try {
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`CREATE TABLE IF NOT EXISTS holiday_configurations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      marketplace VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      startDate DATE NOT NULL,
      endDate DATE NOT NULL,
      bidMultiplier DECIMAL(5,2) NOT NULL DEFAULT 1.00,
      budgetMultiplier DECIMAL(5,2) NOT NULL DEFAULT 1.00,
      priority VARCHAR(20) NOT NULL DEFAULT 'medium',
      isActive TINYINT NOT NULL DEFAULT 1,
      isSystemDefault TINYINT NOT NULL DEFAULT 0,
      preHolidayDays INT NOT NULL DEFAULT 7,
      notes TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_holiday_config_userId (userId),
      INDEX idx_holiday_config_marketplace (marketplace),
      INDEX idx_holiday_config_startDate (startDate),
      INDEX idx_holiday_config_endDate (endDate)
    )`);
    tableEnsured2 = true;
    console.log("[HolidayConfig] holiday_configurations \u8868\u5DF2\u5C31\u7EEA");
  } catch (err) {
    console.error("[HolidayConfig] \u521B\u5EFA\u8868\u5931\u8D25:", err.message);
  }
}
async function createHolidayConfig(data) {
  await ensureHolidayTable();
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  const [result] = await db.insert(holidayConfigurations).values({
    ...data,
    createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
  });
  return result.insertId;
}
async function initializeSystemHolidays(userId, marketplace) {
  await ensureHolidayTable();
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  const holidays = MARKETPLACE_HOLIDAYS[marketplace] || MARKETPLACE_HOLIDAYS["US"];
  const records = holidays.map((holiday) => {
    let startDate;
    let endDate;
    if (holiday.date.includes("~")) {
      [startDate, endDate] = holiday.date.split("~");
    } else {
      startDate = holiday.date;
      endDate = holiday.date;
    }
    return {
      userId,
      marketplace,
      name: holiday.name,
      startDate,
      endDate,
      bidMultiplier: holiday.bidMultiplier.toString(),
      budgetMultiplier: holiday.budgetMultiplier.toString(),
      priority: holiday.priority,
      isActive: 1,
      isSystemDefault: 1,
      preHolidayDays: 7,
      createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " "),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
    };
  });
  if (records.length === 0) return 0;
  await db.insert(holidayConfigurations).values(records);
  return records.length;
}
async function getHolidayConfigs(userId, marketplace) {
  await ensureHolidayTable();
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db.select().from(holidayConfigurations).where(
    and(
      eq(holidayConfigurations.userId, userId),
      marketplace ? eq(holidayConfigurations.marketplace, marketplace) : void 0
    )
  ).orderBy(holidayConfigurations.startDate);
}
async function getHolidayConfigForDate(userId, marketplace, date6) {
  await ensureHolidayTable();
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  const dateStr = date6.toISOString().split("T")[0];
  const [result] = await db.select().from(holidayConfigurations).where(
    and(
      eq(holidayConfigurations.userId, userId),
      eq(holidayConfigurations.marketplace, marketplace),
      eq(holidayConfigurations.isActive, 1),
      lte(holidayConfigurations.startDate, dateStr),
      gte(holidayConfigurations.endDate, dateStr)
    )
  ).orderBy(desc(sql`CASE 
      WHEN ${holidayConfigurations.priority} = 'high' THEN 3 
      WHEN ${holidayConfigurations.priority} = 'medium' THEN 2 
      ELSE 1 
    END`)).limit(1);
  return result || null;
}
async function updateHolidayConfig(id, data) {
  await ensureHolidayTable();
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  await db.update(holidayConfigurations).set({
    ...data,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
  }).where(eq(holidayConfigurations.id, id));
  return true;
}
async function deleteHolidayConfig(id) {
  await ensureHolidayTable();
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  await db.delete(holidayConfigurations).where(eq(holidayConfigurations.id, id));
  return true;
}
async function toggleHolidayConfig(id, isActive) {
  await ensureHolidayTable();
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  await db.update(holidayConfigurations).set({
    isActive: isActive ? 1 : 0,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace("T", " ")
  }).where(eq(holidayConfigurations.id, id));
  return true;
}
async function getUpcomingHolidays(userId, marketplace, days = 30) {
  await ensureHolidayTable();
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const futureDate = /* @__PURE__ */ new Date();
  futureDate.setDate(futureDate.getDate() + days);
  const futureDateStr = futureDate.toISOString().split("T")[0];
  return db.select().from(holidayConfigurations).where(
    and(
      eq(holidayConfigurations.userId, userId),
      marketplace ? eq(holidayConfigurations.marketplace, marketplace) : void 0,
      eq(holidayConfigurations.isActive, 1),
      gte(holidayConfigurations.startDate, today),
      lte(holidayConfigurations.startDate, futureDateStr)
    )
  ).orderBy(holidayConfigurations.startDate);
}
async function getPreHolidayConfig(userId, marketplace, date6) {
  await ensureHolidayTable();
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  const dateStr = date6.toISOString().split("T")[0];
  const dateMs = date6.getTime();
  const holidays = await db.select().from(holidayConfigurations).where(
    and(
      eq(holidayConfigurations.userId, userId),
      eq(holidayConfigurations.marketplace, marketplace),
      eq(holidayConfigurations.isActive, 1),
      eq(holidayConfigurations.priority, "high"),
      gte(holidayConfigurations.startDate, dateStr)
    )
  ).orderBy(holidayConfigurations.startDate);
  for (const holiday of holidays) {
    const holidayStartDate = new Date(holiday.startDate);
    const daysUntil = Math.floor((holidayStartDate.getTime() - dateMs) / (1e3 * 60 * 60 * 24));
    if (daysUntil > 0 && daysUntil <= holiday.preHolidayDays) {
      const progress = 1 - daysUntil / holiday.preHolidayDays;
      const baseBidMultiplier = parseFloat(holiday.bidMultiplier);
      const baseBudgetMultiplier = parseFloat(holiday.budgetMultiplier);
      const bidMultiplier = 1 + (baseBidMultiplier - 1) * progress * 0.5;
      const budgetMultiplier = 1 + (baseBudgetMultiplier - 1) * progress * 0.5;
      return {
        holiday,
        daysUntil,
        bidMultiplier: Math.round(bidMultiplier * 100) / 100,
        budgetMultiplier: Math.round(budgetMultiplier * 100) / 100
      };
    }
  }
  return null;
}
async function getDateAdjustmentMultipliersFromDb(userId, marketplace, date6) {
  const holidayConfig = await getHolidayConfigForDate(userId, marketplace, date6);
  if (holidayConfig) {
    return {
      bidMultiplier: parseFloat(holidayConfig.bidMultiplier),
      budgetMultiplier: parseFloat(holidayConfig.budgetMultiplier),
      reason: `${holidayConfig.name} (${holidayConfig.priority} priority)`,
      holidayName: holidayConfig.name
    };
  }
  const preHoliday = await getPreHolidayConfig(userId, marketplace, date6);
  if (preHoliday) {
    return {
      bidMultiplier: preHoliday.bidMultiplier,
      budgetMultiplier: preHoliday.budgetMultiplier,
      reason: `Pre-${preHoliday.holiday.name} warm-up period (${preHoliday.daysUntil} days until)`,
      holidayName: preHoliday.holiday.name
    };
  }
  return { bidMultiplier: 1, budgetMultiplier: 1, reason: "Normal day", holidayName: null };
}
function getSupportedMarketplaces() {
  return Object.keys(MARKETPLACE_HOLIDAYS);
}
var tableEnsured2;
var init_holidayConfigService = __esm({
  "server/system/holidayConfigService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_algorithmUtils();
    tableEnsured2 = false;
    __name(ensureHolidayTable, "ensureHolidayTable");
    __name(createHolidayConfig, "createHolidayConfig");
    __name(initializeSystemHolidays, "initializeSystemHolidays");
    __name(getHolidayConfigs, "getHolidayConfigs");
    __name(getHolidayConfigForDate, "getHolidayConfigForDate");
    __name(updateHolidayConfig, "updateHolidayConfig");
    __name(deleteHolidayConfig, "deleteHolidayConfig");
    __name(toggleHolidayConfig, "toggleHolidayConfig");
    __name(getUpcomingHolidays, "getUpcomingHolidays");
    __name(getPreHolidayConfig, "getPreHolidayConfig");
    __name(getDateAdjustmentMultipliersFromDb, "getDateAdjustmentMultipliersFromDb");
    __name(getSupportedMarketplaces, "getSupportedMarketplaces");
  }
});

