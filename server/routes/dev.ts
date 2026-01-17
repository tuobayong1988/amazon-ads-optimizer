
import { publicProcedure, router } from "../_core/trpc";
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
    } catch (error: any) {
      results.push({ name, status: 'error', reason: error.message });
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

  const results: any = {};

  // AMS Data Check
  try {
    const [amsResult] = await db.execute(sql`
      SELECT COUNT(*) as count, MAX(createdAt) as lastReceived 
      FROM ams_performance_data 
      WHERE createdAt >= NOW() - INTERVAL '24 hours'
    `) as any;
    results.amsData = amsResult[0];
  } catch (e: any) { results.amsData = { error: e.message }; }

  // API Report Jobs Check
  try {
    const [reportResult] = await db.execute(sql`
      SELECT status, COUNT(*) as count
      FROM report_jobs
      WHERE createdAt >= NOW() - INTERVAL '24 hours'
      GROUP BY status
    `) as any;
    results.reportJobs = reportResult;
  } catch (e: any) { results.reportJobs = { error: e.message }; }

  // Data Fusion Check
  try {
    const [fusionResult] = await db.execute(sql`
      SELECT dataSource, COUNT(*) as count, MAX(date) as latestDate
      FROM daily_performance
      WHERE date >= CURRENT_DATE - INTERVAL '3 days'
      GROUP BY dataSource
    `) as any;
    results.dataFusion = fusionResult;
  } catch (e: any) { results.dataFusion = { error: e.message }; }

  return { dbStatus: 'ok', ...results };
}

export const devRouter = router({
  verifySync: publicProcedure
    .query(async () => {
      const sqsResults = await checkSqsQueues();
      const dbResults = await checkDatabase();
      return {
        sqs: sqsResults,
        database: dbResults,
      };
    }),
});
