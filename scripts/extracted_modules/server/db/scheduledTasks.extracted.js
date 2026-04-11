// Extracted from production dist/index.js
// Original module: server/db/scheduledTasks.ts
// Lines: 100

async function getScheduledTasksByUserId(userId) {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select().from(scheduledTasks).where(eq(scheduledTasks.userId, userId)).orderBy(scheduledTasks.createdAt);
  return result;
}
async function getScheduledTaskById(id) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).limit(1);
  return result[0] || null;
}
async function createScheduledTask(data) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.insert(scheduledTasks).values({
    userId: data.userId,
    accountId: data.accountId || null,
    taskType: data.taskType,
    name: data.name,
    description: data.description || null,
    schedule: data.schedule ?? "daily",
    runTime: data.runTime ?? "06:00",
    dayOfWeek: data.dayOfWeek || null,
    dayOfMonth: data.dayOfMonth || null,
    enabled: data.enabled ? 1 : 0,
    autoApply: data.autoApply ? 1 : 0,
    requireApproval: data.requireApproval !== false ? 1 : 0,
    parameters: data.parameters ? JSON.stringify(data.parameters) : null
  });
  return result[0]?.insertId || 0;
}
async function updateScheduledTask(id, data) {
  const db = await getDb();
  if (!db) return;
  const updateData = { updatedAt: /* @__PURE__ */ new Date() };
  if (data.name !== void 0) updateData.name = data.name;
  if (data.description !== void 0) updateData.description = data.description;
  if (data.schedule !== void 0) updateData.schedule = data.schedule;
  if (data.runTime !== void 0) updateData.runTime = data.runTime;
  if (data.dayOfWeek !== void 0) updateData.dayOfWeek = data.dayOfWeek;
  if (data.dayOfMonth !== void 0) updateData.dayOfMonth = data.dayOfMonth;
  if (data.enabled !== void 0) updateData.enabled = data.enabled;
  if (data.autoApply !== void 0) updateData.autoApply = data.autoApply;
  if (data.requireApproval !== void 0) updateData.requireApproval = data.requireApproval;
  if (data.parameters !== void 0) updateData.parameters = JSON.stringify(data.parameters);
  await db.update(scheduledTasks).set(updateData).where(eq(scheduledTasks.id, id));
}
async function deleteScheduledTask(id) {
  const db = await getDb();
  if (!db) return;
  await db.delete(scheduledTasks).where(eq(scheduledTasks.id, id));
}
async function recordTaskExecution(data) {
  const db = await getDb();
  if (!db) return;
  await db.insert(taskExecutionLog).values({
    taskId: data.taskId,
    userId: data.userId,
    accountId: data.accountId || null,
    taskType: data.taskType,
    status: data.status,
    startedAt: typeof data.startedAt === "string" ? data.startedAt : data.startedAt.toISOString(),
    completedAt: data.completedAt ? typeof data.completedAt === "string" ? data.completedAt : data.completedAt.toISOString() : null,
    duration: data.duration || null,
    itemsProcessed: data.itemsProcessed ?? 0,
    suggestionsGenerated: data.suggestionsGenerated ?? 0,
    suggestionsApplied: data.suggestionsApplied ?? 0,
    errorMessage: data.errorMessage || null,
    resultSummary: data.resultSummary ? JSON.stringify(data.resultSummary) : null
  });
  const mappedStatus = data.status === "cancelled" ? "failed" : data.status;
  await db.update(scheduledTasks).set({
    lastRunAt: typeof data.startedAt === "string" ? data.startedAt : new Date(data.startedAt).toISOString(),
    lastRunStatus: mappedStatus,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }).where(eq(scheduledTasks.id, data.taskId));
}
async function getTaskExecutionHistory(taskId, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select().from(taskExecutionLog).where(eq(taskExecutionLog.taskId, taskId)).orderBy(desc(taskExecutionLog.startedAt)).limit(limit);
  return result;
}
var init_scheduledTasks = __esm({
  "server/db/scheduledTasks.ts"() {
    "use strict";
    init_drizzle_orm();
    init_connection();
    init_schema2();
    __name(getScheduledTasksByUserId, "getScheduledTasksByUserId");
    __name(getScheduledTaskById, "getScheduledTaskById");
    __name(createScheduledTask, "createScheduledTask");
    __name(updateScheduledTask, "updateScheduledTask");
    __name(deleteScheduledTask, "deleteScheduledTask");
    __name(recordTaskExecution, "recordTaskExecution");
    __name(getTaskExecutionHistory, "getTaskExecutionHistory");
  }
});

