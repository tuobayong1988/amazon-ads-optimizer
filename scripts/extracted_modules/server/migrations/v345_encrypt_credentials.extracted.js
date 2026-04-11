// Extracted from production dist/index.js
// Original module: server/migrations/v345_encrypt_credentials.ts
// Lines: 111

var v345_encrypt_credentials_exports = {};
__export(v345_encrypt_credentials_exports, {
  migrateEncryptCredentials: () => migrateEncryptCredentials
});
async function migrateEncryptCredentials() {
  const result = {
    success: false,
    totalRecords: 0,
    encrypted: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };
  log121.info("[v345-migration] \u5F00\u59CB\u51ED\u8BC1\u52A0\u5BC6\u8FC1\u79FB...");
  if (!isCryptoAvailable()) {
    const msg = "ENCRYPTION_KEY \u73AF\u5883\u53D8\u91CF\u672A\u914D\u7F6E\uFF0C\u8DF3\u8FC7\u51ED\u8BC1\u52A0\u5BC6\u8FC1\u79FB";
    console.warn(`[v345-migration] ${msg}`);
    result.errors.push(msg);
    return result;
  }
  const test2 = selfTest();
  if (!test2.success) {
    const msg = `\u52A0\u5BC6\u670D\u52A1\u81EA\u68C0\u5931\u8D25: ${test2.error}`;
    console.error(`[v345-migration] ${msg}`);
    result.errors.push(msg);
    return result;
  }
  log121.info("[v345-migration] \u52A0\u5BC6\u670D\u52A1\u81EA\u68C0\u901A\u8FC7");
  const db = await getDb();
  if (!db) {
    result.errors.push("\u6570\u636E\u5E93\u8FDE\u63A5\u4E0D\u53EF\u7528");
    return result;
  }
  try {
    log121.info("[v345-migration] \u6B65\u9AA41: \u68C0\u67E5\u5E76\u6269\u5C55 clientSecret \u5217...");
    try {
      await db.execute(sql`
        ALTER TABLE amazon_api_credentials 
        MODIFY COLUMN clientSecret TEXT NOT NULL
      `);
      log121.info("[v345-migration] clientSecret \u5217\u5DF2\u6269\u5C55\u4E3A TEXT");
    } catch (alterError) {
      log121.info(`[v345-migration] ALTER TABLE \u7ED3\u679C: ${alterError.message}`);
    }
    log121.info("[v345-migration] \u6B65\u9AA42: \u8BFB\u53D6\u6240\u6709\u51ED\u8BC1\u8BB0\u5F55...");
    const rows = await db.execute(sql`
      SELECT id, accountId, clientSecret, refreshToken 
      FROM amazon_api_credentials
    `);
    const records = rows[0] || rows;
    result.totalRecords = records.length;
    log121.info(`[v345-migration] \u5171 ${records.length} \u6761\u51ED\u8BC1\u8BB0\u5F55`);
    for (const record2 of records) {
      try {
        const needEncryptSecret = record2.clientSecret && !isEncrypted(record2.clientSecret);
        const needEncryptToken = record2.refreshToken && !isEncrypted(record2.refreshToken);
        if (!needEncryptSecret && !needEncryptToken) {
          result.skipped++;
          log121.info(`[v345-migration] \u8D26\u6237 ${record2.accountId}: \u5DF2\u52A0\u5BC6\uFF0C\u8DF3\u8FC7`);
          continue;
        }
        const updates = [];
        if (needEncryptSecret) {
          const encryptedSecret = encrypt(record2.clientSecret);
          await db.execute(sql`
 UPDATE amazon_api_credentials 
 SET clientSecret = ${encryptedSecret}
 WHERE id = ${record2.id}
 `);
          updates.push("clientSecret");
        }
        if (needEncryptToken) {
          const encryptedToken = encrypt(record2.refreshToken);
          await db.execute(sql`
 UPDATE amazon_api_credentials 
 SET refreshToken = ${encryptedToken}
 WHERE id = ${record2.id}
 `);
          updates.push("refreshToken");
        }
        result.encrypted++;
        log121.info(`[v345-migration] \u8D26\u6237 ${record2.accountId}: \u5DF2\u52A0\u5BC6 [${updates.join(", ")}]`);
      } catch (recordError) {
        result.failed++;
        const msg = `\u8D26\u6237 ${record2.accountId} \u52A0\u5BC6\u5931\u8D25: ${recordError.message}`;
        result.errors.push(msg);
        console.error(`[v345-migration] ${msg}`);
      }
    }
    result.success = result.failed === 0;
    log121.info(`[v345-migration] \u8FC1\u79FB\u5B8C\u6210: \u603B\u8BA1=${result.totalRecords}, \u52A0\u5BC6=${result.encrypted}, \u8DF3\u8FC7=${result.skipped}, \u5931\u8D25=${result.failed}`);
    return result;
  } catch (error48) {
    result.errors.push(`\u8FC1\u79FB\u5F02\u5E38: ${error48.message}`);
    console.error(`[v345-migration] \u8FC1\u79FB\u5F02\u5E38:`, error48);
    return result;
  }
}
var log121;
var init_v345_encrypt_credentials = __esm({
  "server/migrations/v345_encrypt_credentials.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_drizzle_orm();
    init_cryptoService();
    log121 = createModuleLogger("Migration:v345enc");
    __name(migrateEncryptCredentials, "migrateEncryptCredentials");
  }
});

