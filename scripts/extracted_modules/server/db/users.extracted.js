// Extracted from production dist/index.js
// Original module: server/db/users.ts
// Lines: 82

async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    log8.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = /* @__PURE__ */ __name((field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    }, "assignNullable");
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = (/* @__PURE__ */ new Date()).toISOString();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = (/* @__PURE__ */ new Date()).toISOString();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
  } catch (error48) {
    log8.warn("[Database] Failed to upsert user:", error48);
    throw error48;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    log8.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getUserById(userId) {
  const db = await getDb();
  if (!db) {
    log8.warn("[Database] Cannot get user by id: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
var log8;
var init_users = __esm({
  "server/db/users.ts"() {
    "use strict";
    init_drizzle_orm();
    init_schema2();
    init_connection();
    init_logger();
    init_env();
    log8 = createModuleLogger("DB:users");
    __name(upsertUser, "upsertUser");
    __name(getUserByOpenId, "getUserByOpenId");
    __name(getUserById, "getUserById");
  }
});

