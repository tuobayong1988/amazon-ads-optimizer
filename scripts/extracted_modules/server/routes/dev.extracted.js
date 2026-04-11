// Extracted from production dist/index.js
// Original module: server/routes/dev.ts
// Lines: 102

async function checkSqsQueues() {
  const sqsClient = new import_client_sqs2.SQSClient({ region: process.env.AWS_REGION || "us-east-1" });
  const results = [];
  let allQueuesActive = true;
  for (const [name2, url3] of Object.entries(SQS_QUEUE_URLS)) {
    if (!url3) {
      results.push({ name: name2, status: "skipped", reason: "URL not configured" });
      allQueuesActive = false;
      continue;
    }
    try {
      const command = new import_client_sqs2.GetQueueAttributesCommand({
        QueueUrl: url3,
        AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible", "LastModifiedTimestamp"]
      });
      const response = await sqsClient.send(command);
      const attributes = response.Attributes;
      const messageCount = attributes ? parseInt(attributes.ApproximateNumberOfMessages || "0") : 0;
      const lastModified = attributes ? new Date(parseInt(attributes.LastModifiedTimestamp || "0") * 1e3).toISOString() : "N/A";
      results.push({ name: name2, status: "ok", messageCount, lastModified });
    } catch (error48) {
      results.push({ name: name2, status: "error", reason: error48.message });
      allQueuesActive = false;
    }
  }
  return { allQueuesActive, results };
}
async function checkDatabase() {
  const db = await getDb();
  if (!db) {
    return { dbStatus: "error", reason: "Database connection failed" };
  }
  const results = {};
  try {
    const [amsResult] = await db.execute(sql`
      SELECT COUNT(*) as count, MAX(createdAt) as lastReceived 
      FROM ams_performance_data 
      WHERE createdAt >= NOW() - INTERVAL '24 hours'
    `);
    results.amsData = amsResult[0];
  } catch (e) {
    results.amsData = { error: e.message };
  }
  try {
    const [reportResult] = await db.execute(sql`
      SELECT status, COUNT(*) as count
      FROM report_jobs
      WHERE createdAt >= NOW() - INTERVAL '24 hours'
      GROUP BY status
    `);
    results.reportJobs = reportResult;
  } catch (e) {
    results.reportJobs = { error: e.message };
  }
  try {
    const [fusionResult] = await db.execute(sql`
      SELECT dataSource, COUNT(*) as count, MAX(date) as latestDate
      FROM daily_performance
      WHERE date >= CURRENT_DATE - INTERVAL '3 days'
      GROUP BY dataSource
    `);
    results.dataFusion = fusionResult;
  } catch (e) {
    results.dataFusion = { error: e.message };
  }
  return { dbStatus: "ok", ...results };
}
var import_client_sqs2, SQS_QUEUE_URLS, devRouter;
var init_dev = __esm({
  "server/routes/dev.ts"() {
    "use strict";
    init_trpc();
    import_client_sqs2 = require("@aws-sdk/client-sqs");
    init_db2();
    init_drizzle_orm();
    SQS_QUEUE_URLS = {
      "sp-traffic": process.env.AWS_SQS_QUEUE_TRAFFIC_URL,
      "sp-conversion": process.env.AWS_SQS_QUEUE_CONVERSION_URL,
      "sp-budget-usage": process.env.AWS_SQS_QUEUE_BUDGET_URL,
      "sb-traffic": process.env.AWS_SQS_QUEUE_SB_TRAFFIC_URL,
      "sb-conversion": process.env.AWS_SQS_QUEUE_SB_CONVERSION_URL,
      "sb-budget-usage": process.env.AWS_SQS_QUEUE_SB_BUDGET_URL,
      "sd-traffic": process.env.AWS_SQS_QUEUE_SD_TRAFFIC_URL,
      "sd-conversion": process.env.AWS_SQS_QUEUE_SD_CONVERSION_URL,
      "sd-budget-usage": process.env.AWS_SQS_QUEUE_SD_BUDGET_URL
    };
    __name(checkSqsQueues, "checkSqsQueues");
    __name(checkDatabase, "checkDatabase");
    devRouter = router({
      // v371: 开发工具仅管理员可访问
      verifySync: adminProcedure.query(async () => {
        const sqsResults = await checkSqsQueues();
        const dbResults = await checkDatabase();
        return {
          sqs: sqsResults,
          database: dbResults
        };
      })
    });
  }
});

