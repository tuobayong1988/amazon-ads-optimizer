// Extracted from production dist/index.js
// Original module: server/db/emailSubscriptions.ts
// Lines: 85

async function createEmailSubscription(data) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(emailReportSubscriptions).values(data);
  const insertId = result[0].insertId;
  const [subscription] = await db.select().from(emailReportSubscriptions).where(eq(emailReportSubscriptions.id, insertId));
  return subscription || null;
}
async function getEmailSubscriptionsByUser(userId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(emailReportSubscriptions).where(eq(emailReportSubscriptions.userId, userId)).orderBy(desc(emailReportSubscriptions.createdAt));
}
async function getEmailSubscriptionById(id) {
  const db = await getDb();
  if (!db) return null;
  const [subscription] = await db.select().from(emailReportSubscriptions).where(eq(emailReportSubscriptions.id, id));
  return subscription || null;
}
async function getActiveEmailSubscriptions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(emailReportSubscriptions).where(eq(emailReportSubscriptions.isActive, 1));
}
async function getDueEmailSubscriptions() {
  const db = await getDb();
  if (!db) return [];
  const now = /* @__PURE__ */ new Date();
  return db.select().from(emailReportSubscriptions).where(and(
    eq(emailReportSubscriptions.isActive, 1),
    sql`${emailReportSubscriptions.nextSendAt} <= ${now.toISOString()}`
  ));
}
async function updateEmailSubscription(id, data) {
  const db = await getDb();
  if (!db) return false;
  await db.update(emailReportSubscriptions).set(data).where(eq(emailReportSubscriptions.id, id));
  return true;
}
async function deleteEmailSubscription(id) {
  const db = await getDb();
  if (!db) return false;
  await db.delete(emailReportSubscriptions).where(eq(emailReportSubscriptions.id, id));
  return true;
}
async function createEmailSendLog(data) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(emailSendLogs).values(data);
  const insertId = result[0].insertId;
  const [log216] = await db.select().from(emailSendLogs).where(eq(emailSendLogs.id, insertId));
  return log216 || null;
}
async function getEmailSendLogsBySubscription(subscriptionId, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(emailSendLogs).where(eq(emailSendLogs.subscriptionId, subscriptionId)).orderBy(desc(emailSendLogs.sentAt)).limit(limit);
}
async function getRecentEmailSendLogs(userId, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const subscriptions = await db.select({ id: emailReportSubscriptions.id }).from(emailReportSubscriptions).where(eq(emailReportSubscriptions.userId, userId));
  if (subscriptions.length === 0) return [];
  const subscriptionIds = subscriptions.map((s) => s.id);
  return db.select().from(emailSendLogs).where(sql`${emailSendLogs.subscriptionId} IN (${sql.join(subscriptionIds.map((id) => sql`${id}`), sql`, `)})`).orderBy(desc(emailSendLogs.sentAt)).limit(limit);
}
var init_emailSubscriptions = __esm({
  "server/db/emailSubscriptions.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    __name(createEmailSubscription, "createEmailSubscription");
    __name(getEmailSubscriptionsByUser, "getEmailSubscriptionsByUser");
    __name(getEmailSubscriptionById, "getEmailSubscriptionById");
    __name(getActiveEmailSubscriptions, "getActiveEmailSubscriptions");
    __name(getDueEmailSubscriptions, "getDueEmailSubscriptions");
    __name(updateEmailSubscription, "updateEmailSubscription");
    __name(deleteEmailSubscription, "deleteEmailSubscription");
    __name(createEmailSendLog, "createEmailSendLog");
    __name(getEmailSendLogsBySubscription, "getEmailSendLogsBySubscription");
    __name(getRecentEmailSendLogs, "getRecentEmailSendLogs");
  }
});

