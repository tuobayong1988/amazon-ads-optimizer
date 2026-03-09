
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';

// 从环境变量中获取SQS队列URL
const SQS_QUEUE_URLS = {
  'sp-traffic': process.env.AWS_SQS_QUEUE_TRAFFIC_URL,
  'sp-conversion': process.env.AWS_SQS_QUEUE_CONVERSION_URL,
  'sp-budget-usage': process.env.AWS_SQS_QUEUE_BUDGET_URL,
  'sb-traffic': process.env.AWS_SQS_QUEUE_SB_TRAFFIC_URL,
  'sb-conversion': process.env.AWS_SQS_QUEUE_SB_CONVERSION_URL,
  'sb-budget-usage': process.env.AWS_SQS_QUEUE_SB_BUDGET_URL,
  'sd-traffic': process.env.AWS_SQS_QUEUE_SD_TRAFFIC_URL,
  'sd-conversion': process.env.AWS_SQS_QUEUE_SD_CONVERSION_URL,
  'sd-budget-usage': process.env.AWS_SQS_QUEUE_SD_BUDGET_URL,
};

async function checkSqsQueues() {
  const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const results: any[] = [];
  let allQueuesActive = true;

  for (const [name, url] of Object.entries(SQS_QUEUE_URLS)) {
    if (!url) {
      results.push({ name, status: 'skipped', reason: 'URL not configured' });
      allQueuesActive = false;
      continue;
    }

    try {
      const command = new GetQueueAttributesCommand({ 
        QueueUrl: url, 
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'LastModifiedTimestamp'] 
      });
      const response = await sqsClient.send(command);
      const attributes = response.Attributes;
      const messageCount = attributes ? parseInt(attributes.ApproximateNumberOfMessages || '0') : 0;
      const lastModified = attributes ? new Date(parseInt(attributes.LastModifiedTimestamp || '0') * 1000).toISOString() : 'N/A';

      results.push({ name, status: 'ok', messageCount, lastModified });
    } catch (error: unknown) {
      results.push({ name, status: 'error', reason: (error as Error).message });
      allQueuesActive = false;
    }
  }
  return { allQueuesActive, results };
}

async function checkDatabase() {
  const db = await getDb();
  if (!db) {
    return { dbStatus: 'error', reason: 'Database connection failed' };
  }

  // @ts-ignore
  const results: Record<string, any>[] = {};

  // AMS Data Check
  try {
    // @ts-ignore
    const [amsResult] = await db.execute(sql`
      SELECT COUNT(*) as count, MAX(createdAt) as lastReceived 
      FROM ams_performance_data 
      WHERE createdAt >= NOW() - INTERVAL '24 hours'
    `) as unknown;
    // @ts-ignore
    results.amsData = amsResult[0];
  // @ts-ignore
  } catch (e: unknown) { results.amsData = { error: (e as Error).message }; }

  // API Report Jobs Check
  try {
    // @ts-ignore
    const [reportResult] = await db.execute(sql`
      SELECT status, COUNT(*) as count
      FROM report_jobs
      WHERE createdAt >= NOW() - INTERVAL '24 hours'
      GROUP BY status
    `) as unknown;
    // @ts-ignore
    results.reportJobs = reportResult;
  // @ts-ignore
  } catch (e: unknown) { results.reportJobs = { error: (e as Error).message }; }

  // Data Fusion Check
  try {
    // @ts-ignore
    const [fusionResult] = await db.execute(sql`
      SELECT dataSource, COUNT(*) as count, MAX(date) as latestDate
      FROM daily_performance
      WHERE date >= CURRENT_DATE - INTERVAL '3 days'
      GROUP BY dataSource
    `) as unknown;
    // @ts-ignore
    results.dataFusion = fusionResult;
  // @ts-ignore
  } catch (e: unknown) { results.dataFusion = { error: (e as Error).message }; }

  return { dbStatus: 'ok', ...results };
}

export const devRouter = router({
  // @ts-ignore
  // v371: 开发工具仅管理员可访问
  verifySync: adminProcedure
    .query(async () => {
      const sqsResults = await checkSqsQueues();
      const dbResults = await checkDatabase();
      return {
        sqs: sqsResults,
        database: dbResults,
      };
    }),
});
