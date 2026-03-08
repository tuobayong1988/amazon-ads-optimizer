/**
 * v361: 通知管理
 * 从db.ts拆分的子模块
 */

import { desc, eq } from 'drizzle-orm';
import { getDb } from './connection';
import { notificationHistory, notificationSettings } from '../../drizzle/schema';

// ==================== Notification Functions ====================

export async function getNotificationSettingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId))
    .limit(1);
  
  return result[0] || null;
}

export async function updateNotificationSettingsByUserId(userId: number, data: {
  emailEnabled?: boolean;
  inAppEnabled?: boolean;
  acosThreshold?: number;
  ctrDropThreshold?: number;
  conversionDropThreshold?: number;
  spendSpikeThreshold?: number;
  frequency?: 'immediate' | 'hourly' | 'daily' | 'weekly';
  quietHoursStart?: number;
  quietHoursEnd?: number;
}) {
  const db = await getDb();
  if (!db) return;
  
  const existing = await getNotificationSettingsByUserId(userId);
  
  if (existing) {
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (data.emailEnabled !== undefined) updateData.emailEnabled = data.emailEnabled;
    if (data.inAppEnabled !== undefined) updateData.inAppEnabled = data.inAppEnabled;
    if (data.acosThreshold !== undefined) updateData.acosThreshold = String(data.acosThreshold);
    if (data.ctrDropThreshold !== undefined) updateData.ctrDropThreshold = String(data.ctrDropThreshold);
    if (data.conversionDropThreshold !== undefined) updateData.conversionDropThreshold = String(data.conversionDropThreshold);
    if (data.spendSpikeThreshold !== undefined) updateData.spendSpikeThreshold = String(data.spendSpikeThreshold);
    if (data.frequency !== undefined) updateData.frequency = data.frequency;
    if (data.quietHoursStart !== undefined) updateData.quietHoursStart = data.quietHoursStart;
    if (data.quietHoursEnd !== undefined) updateData.quietHoursEnd = data.quietHoursEnd;
    
    await db.update(notificationSettings)
      .set(updateData)
      .where(eq(notificationSettings.id, existing.id));
  } else {
    await db.insert(notificationSettings).values({
      userId,
      emailEnabled: data.emailEnabled ? 1 : 0,
      inAppEnabled: data.inAppEnabled ? 1 : 0,
      acosThreshold: data.acosThreshold !== undefined ? String(data.acosThreshold) : '50.00',
      ctrDropThreshold: data.ctrDropThreshold !== undefined ? String(data.ctrDropThreshold) : '30.00',
      conversionDropThreshold: data.conversionDropThreshold !== undefined ? String(data.conversionDropThreshold) : '30.00',
      spendSpikeThreshold: data.spendSpikeThreshold !== undefined ? String(data.spendSpikeThreshold) : '50.00',
      frequency: data.frequency ?? 'daily',
      quietHoursStart: data.quietHoursStart ?? 22,
      quietHoursEnd: data.quietHoursEnd ?? 8,
    });
  }
}

export async function getNotificationHistoryByUserId(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select()
    .from(notificationHistory)
    .where(eq(notificationHistory.userId, userId))
    .orderBy(desc(notificationHistory.createdAt))
    .limit(limit);
  
  return result;
}

export async function createNotificationRecord(data: {
  userId: number;
  accountId?: number;
  type: 'alert' | 'report' | 'system';
  severity?: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  channel?: 'email' | 'in_app' | 'both';
  relatedEntityType?: string;
  relatedEntityId?: number;
}) {
  const db = await getDb();
  if (!db) return;
  
  await db.insert(notificationHistory).values({
    userId: data.userId,
    accountId: data.accountId || null,
    type: data.type,
    severity: data.severity ?? 'info',
    title: data.title,
    message: data.message,
    channel: data.channel ?? 'in_app',
    status: 'pending',
    relatedEntityType: data.relatedEntityType || null,
    relatedEntityId: data.relatedEntityId || null,
  });
}

export async function markNotificationAsRead(notificationId: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(notificationHistory)
    .set({ status: 'read', readAt: new Date().toISOString() })
    .where(eq(notificationHistory.id, notificationId));
}

// ==================== Scheduler Functions ====================
