/**
 * v361: 邮件订阅管理
 * 从db.ts拆分的子模块
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { EmailReportSubscription, EmailSendLog, InsertEmailReportSubscription, InsertEmailSendLog, emailReportSubscriptions, emailSendLogs } from '../../drizzle/schema';
import { getDb } from './connection';

// ==================== Email Report Subscription Functions ====================

export async function createEmailSubscription(data: InsertEmailReportSubscription): Promise<EmailReportSubscription | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(emailReportSubscriptions).values(data);
  const insertId = result[0].insertId;
  const [subscription] = await db.select().from(emailReportSubscriptions).where(eq(emailReportSubscriptions.id, insertId));
  return subscription || null;
}

export async function getEmailSubscriptionsByUser(userId: number): Promise<EmailReportSubscription[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(emailReportSubscriptions)
    .where(eq(emailReportSubscriptions.userId, userId))
    .orderBy(desc(emailReportSubscriptions.createdAt));
}

export async function getEmailSubscriptionById(id: number): Promise<EmailReportSubscription | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [subscription] = await db.select().from(emailReportSubscriptions).where(eq(emailReportSubscriptions.id, id));
  return subscription || null;
}

export async function getActiveEmailSubscriptions(): Promise<EmailReportSubscription[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(emailReportSubscriptions)
    .where(eq(emailReportSubscriptions.isActive, 1));
}

export async function getDueEmailSubscriptions(): Promise<EmailReportSubscription[]> {
  const db = await getDb();
  if (!db) return [];
  
  const now = new Date();
  return db.select().from(emailReportSubscriptions)
    .where(and(
      eq(emailReportSubscriptions.isActive, 1),
      sql`${emailReportSubscriptions.nextSendAt} <= ${now.toISOString()}`
    ));
}

export async function updateEmailSubscription(id: number, data: Partial<InsertEmailReportSubscription>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(emailReportSubscriptions).set(data).where(eq(emailReportSubscriptions.id, id));
  return true;
}

export async function deleteEmailSubscription(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.delete(emailReportSubscriptions).where(eq(emailReportSubscriptions.id, id));
  return true;
}

// ==================== Email Send Log Functions ====================

// ==================== Email Send Log Functions ====================

export async function createEmailSendLog(data: InsertEmailSendLog): Promise<EmailSendLog | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(emailSendLogs).values(data);
  const insertId = result[0].insertId;
  const [log] = await db.select().from(emailSendLogs).where(eq(emailSendLogs.id, insertId));
  return log || null;
}

export async function getEmailSendLogsBySubscription(subscriptionId: number, limit = 20): Promise<EmailSendLog[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(emailSendLogs)
    .where(eq(emailSendLogs.subscriptionId, subscriptionId))
    .orderBy(desc(emailSendLogs.sentAt))
    .limit(limit);
}

export async function getRecentEmailSendLogs(userId: number, limit = 50): Promise<EmailSendLog[]> {
  const db = await getDb();
  if (!db) return [];
  
  // 获取用户的所有订阅ID
  const subscriptions = await db.select({ id: emailReportSubscriptions.id })
    .from(emailReportSubscriptions)
    .where(eq(emailReportSubscriptions.userId, userId));
  
  if (subscriptions.length === 0) return [];
  
  const subscriptionIds = subscriptions.map(s => s.id);
  
  return db.select().from(emailSendLogs)
    .where(sql`${emailSendLogs.subscriptionId} IN (${sql.join(subscriptionIds.map(id => sql`${id}`), sql`, `)})`)
    .orderBy(desc(emailSendLogs.sentAt))
    .limit(limit);
}


// ==================== Search Terms Functions ====================
