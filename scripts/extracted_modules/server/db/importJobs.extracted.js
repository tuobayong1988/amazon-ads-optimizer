// Extracted from production dist/index.js
// Original module: server/db/importJobs.ts
// Lines: 28

async function createImportJob(job) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(importJobs).values(job);
  return result[0].insertId;
}
async function getImportJobsByUserId(userId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(importJobs).where(eq(importJobs.userId, userId)).orderBy(desc(importJobs.createdAt));
}
async function updateImportJob(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(importJobs).set(data).where(eq(importJobs.id, id));
}
var init_importJobs = __esm({
  "server/db/importJobs.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    __name(createImportJob, "createImportJob");
    __name(getImportJobsByUserId, "getImportJobsByUserId");
    __name(updateImportJob, "updateImportJob");
  }
});

