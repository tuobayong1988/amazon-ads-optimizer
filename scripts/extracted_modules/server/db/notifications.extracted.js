// Extracted from production dist/index.js
// Original module: server/db/notifications.ts
// Lines: 78

async function getNotificationSettingsByUserId(userId) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(notificationSettings).where(eq(notificationSettings.userId, userId)).limit(1);
  return result[0] || null;
}
async function updateNotificationSettingsByUserId(userId, data) {
  const db = await getDb();
  if (!db) return;
  const existing = await getNotificationSettingsByUserId(userId);
  if (existing) {
    const updateData = { updatedAt: /* @__PURE__ */ new Date() };
    if (data.emailEnabled !== void 0) updateData.emailEnabled = data.emailEnabled;
    if (data.inAppEnabled !== void 0) updateData.inAppEnabled = data.inAppEnabled;
    if (data.acosThreshold !== void 0) updateData.acosThreshold = String(data.acosThreshold);
    if (data.ctrDropThreshold !== void 0) updateData.ctrDropThreshold = String(data.ctrDropThreshold);
    if (data.conversionDropThreshold !== void 0) updateData.conversionDropThreshold = String(data.conversionDropThreshold);
    if (data.spendSpikeThreshold !== void 0) updateData.spendSpikeThreshold = String(data.spendSpikeThreshold);
    if (data.frequency !== void 0) updateData.frequency = data.frequency;
    if (data.quietHoursStart !== void 0) updateData.quietHoursStart = data.quietHoursStart;
    if (data.quietHoursEnd !== void 0) updateData.quietHoursEnd = data.quietHoursEnd;
    await db.update(notificationSettings).set(updateData).where(eq(notificationSettings.id, existing.id));
  } else {
    await db.insert(notificationSettings).values({
      userId,
      emailEnabled: data.emailEnabled ? 1 : 0,
      inAppEnabled: data.inAppEnabled ? 1 : 0,
      acosThreshold: data.acosThreshold !== void 0 ? String(data.acosThreshold) : "50.00",
      ctrDropThreshold: data.ctrDropThreshold !== void 0 ? String(data.ctrDropThreshold) : "30.00",
      conversionDropThreshold: data.conversionDropThreshold !== void 0 ? String(data.conversionDropThreshold) : "30.00",
      spendSpikeThreshold: data.spendSpikeThreshold !== void 0 ? String(data.spendSpikeThreshold) : "50.00",
      frequency: data.frequency ?? "daily",
      quietHoursStart: data.quietHoursStart ?? 22,
      quietHoursEnd: data.quietHoursEnd ?? 8
    });
  }
}
async function getNotificationHistoryByUserId(userId, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select().from(notificationHistory).where(eq(notificationHistory.userId, userId)).orderBy(desc(notificationHistory.createdAt)).limit(limit);
  return result;
}
async function createNotificationRecord(data) {
  const db = await getDb();
  if (!db) return;
  await db.insert(notificationHistory).values({
    userId: data.userId,
    accountId: data.accountId || null,
    type: data.type,
    severity: data.severity ?? "info",
    title: data.title,
    message: data.message,
    channel: data.channel ?? "in_app",
    status: "pending",
    relatedEntityType: data.relatedEntityType || null,
    relatedEntityId: data.relatedEntityId || null
  });
}
async function markNotificationAsRead(notificationId) {
  const db = await getDb();
  if (!db) return;
  await db.update(notificationHistory).set({ status: "read", readAt: (/* @__PURE__ */ new Date()).toISOString() }).where(eq(notificationHistory.id, notificationId));
}
var init_notifications = __esm({
  "server/db/notifications.ts"() {
    "use strict";
    init_drizzle_orm();
    init_connection();
    init_schema2();
    __name(getNotificationSettingsByUserId, "getNotificationSettingsByUserId");
    __name(updateNotificationSettingsByUserId, "updateNotificationSettingsByUserId");
    __name(getNotificationHistoryByUserId, "getNotificationHistoryByUserId");
    __name(createNotificationRecord, "createNotificationRecord");
    __name(markNotificationAsRead, "markNotificationAsRead");
  }
});

