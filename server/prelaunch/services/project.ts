/**
 * 预发布项目管理服务
 */
import { getDb } from '../../db';
import { prelaunchProjects } from '../../../drizzle/schema';
import { eq, desc, and, sql } from 'drizzle-orm';

export class PrelaunchProjectService {

  async listProjects(userId: number, status?: string, page = 1, pageSize = 20) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available', data: [], total: 0 };

    try {
      const conditions = [];
      if (status) conditions.push(eq(prelaunchProjects.status, status as any));

      const data = await db.select()
        .from(prelaunchProjects)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(prelaunchProjects.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [countResult] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchProjects)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return { success: true, data, total: countResult?.count ?? 0, page, pageSize };
    } catch (error: any) {
      return { success: false, error: error.message, data: [], total: 0 };
    }
  }

  async getProject(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      const [project] = await db.select()
        .from(prelaunchProjects)
        .where(eq(prelaunchProjects.id, projectId))
        .limit(1);

      if (!project) return { success: false, error: 'Project not found' };
      return { success: true, data: project };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async createProject(input: {
    projectName: string;
    accountId: number;
    createdBy: number;
    asin?: string;
    marketplace?: string;
    category?: string;
    seedKeywords?: string[];
  }) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      const [result] = await db.insert(prelaunchProjects).values({
        projectName: input.projectName,
        accountId: input.accountId,
        asin: input.asin,
        marketplace: input.marketplace || 'US',
        category: input.category,
        seedKeywords: input.seedKeywords ? JSON.stringify(input.seedKeywords) : null,
        createdBy: input.createdBy,
        status: 'draft',
      });

      return { success: true, projectId: (result as any).insertId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async updateProject(projectId: number, updates: Record<string, any>) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      const { projectId: _, ...fields } = updates;
      if (fields.seedKeywords) fields.seedKeywords = JSON.stringify(fields.seedKeywords);
      await db.update(prelaunchProjects).set(fields).where(eq(prelaunchProjects.id, projectId));
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async deleteProject(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      await db.delete(prelaunchProjects).where(eq(prelaunchProjects.id, projectId));
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
