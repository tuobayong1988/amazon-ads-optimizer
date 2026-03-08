/**
 * 预发布项目管理服务
 * 增强版: 支持项目搜索、各模块数据统计、完整CRUD
 */
import { getDb } from '../../db';
import {
  prelaunchProjects,
  prelaunchKeywords,
  prelaunchCompetitors,
  prelaunchPersonas,
  prelaunchCopyVersions,
  prelaunchVisualBriefs,
  prelaunchVideoScripts,
  prelaunchAdFrameworks,
} from '../../../drizzle/schema';
import { eq, desc, and, sql, like, or } from 'drizzle-orm';

export class PrelaunchProjectService {

  /**
   * 获取项目列表（增强版）
   * - 支持状态筛选
   * - 支持关键词搜索（项目名称、ASIN、类目）
   * - 返回每个项目的各模块数据统计
   */
  async listProjects(userId: number, status?: string, page = 1, pageSize = 20, search?: string) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available', data: [], total: 0 };

    try {
      const conditions = [];
      if (status) conditions.push(eq(prelaunchProjects.status, status as any));
      if (search) {
        conditions.push(
          or(
            like(prelaunchProjects.projectName, `%${search}%`),
            like(prelaunchProjects.asin, `%${search}%`),
            like(prelaunchProjects.category, `%${search}%`)
          )!
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const data = await db.select()
        .from(prelaunchProjects)
        .where(whereClause)
        .orderBy(desc(prelaunchProjects.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [countResult] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchProjects)
        .where(whereClause);

      // 为每个项目获取各模块的数据统计
      const enrichedData = await Promise.all(data.map(async (project) => {
        const moduleStats = await this.getProjectModuleStats(db, project.id);
        return {
          ...project,
          // 解析seedKeywords（存储为JSON字符串）
          seedKeywords: this.parseSeedKeywords(project.seedKeywords),
          moduleStats,
        };
      }));

      return { success: true, data: enrichedData, total: countResult?.count ?? 0, page, pageSize };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message, data: [], total: 0 };
    }
  }

  /**
   * 获取单个项目详情（增强版）
   * - 包含各模块数据统计
   * - 解析seedKeywords
   */
  async getProject(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      const [project] = await db.select()
        .from(prelaunchProjects)
        .where(eq(prelaunchProjects.id, projectId))
        .limit(1);

      if (!project) return { success: false, error: 'Project not found' };

      const moduleStats = await this.getProjectModuleStats(db, projectId);

      return {
        success: true,
        data: {
          ...project,
          seedKeywords: this.parseSeedKeywords(project.seedKeywords),
          moduleStats,
        },
      };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 创建预发布项目
   */
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

      const projectId = (result as any).insertId;

      // 返回创建的完整项目数据
      return {
        success: true,
        projectId,
        data: {
          id: projectId,
          projectName: input.projectName,
          accountId: input.accountId,
          asin: input.asin || null,
          marketplace: input.marketplace || 'US',
          category: input.category || null,
          seedKeywords: input.seedKeywords || [],
          status: 'draft',
          createdBy: input.createdBy,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          moduleStats: { M1: 0, M2: 0, M3: 0, M4X: 0, M5: 0, M6: 0, M7: 0 },
        },
      };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 更新项目
   */
  async updateProject(projectId: number, updates: Record<string, unknown>) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      const { projectId: _, ...fields } = updates;
      if (fields.seedKeywords && Array.isArray(fields.seedKeywords)) {
        fields.seedKeywords = JSON.stringify(fields.seedKeywords);
      }
      await db.update(prelaunchProjects).set(fields).where(eq(prelaunchProjects.id, projectId));

      // 返回更新后的完整项目数据
      const updatedProject = await this.getProject(projectId);
      return { success: true, data: updatedProject.success ? updatedProject.data : null };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 删除项目（级联删除所有模块数据）
   */
  async deleteProject(projectId: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      // 级联删除各模块数据
      await Promise.all([
        db.delete(prelaunchKeywords).where(eq(prelaunchKeywords.projectId, projectId)).catch(() => {}),
        db.delete(prelaunchCompetitors).where(eq(prelaunchCompetitors.projectId, projectId)).catch(() => {}),
        db.delete(prelaunchPersonas).where(eq(prelaunchPersonas.projectId, projectId)).catch(() => {}),
        db.delete(prelaunchCopyVersions).where(eq(prelaunchCopyVersions.projectId, projectId)).catch(() => {}),
        db.delete(prelaunchVisualBriefs).where(eq(prelaunchVisualBriefs.projectId, projectId)).catch(() => {}),
        db.delete(prelaunchVideoScripts).where(eq(prelaunchVideoScripts.projectId, projectId)).catch(() => {}),
        db.delete(prelaunchAdFrameworks).where(eq(prelaunchAdFrameworks.projectId, projectId)).catch(() => {}),
      ]);

      // 删除项目本身
      await db.delete(prelaunchProjects).where(eq(prelaunchProjects.id, projectId));
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message };
    }
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 获取项目各模块的数据条数统计
   */
  private async getProjectModuleStats(db: ReturnType<typeof getDb> | null, projectId: number) {
    try {
      const [kwCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchKeywords).where(eq(prelaunchKeywords.projectId, projectId));
      const [compCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchCompetitors).where(eq(prelaunchCompetitors.projectId, projectId));
      const [personaCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchPersonas).where(eq(prelaunchPersonas.projectId, projectId));
      const [copyCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchCopyVersions).where(eq(prelaunchCopyVersions.projectId, projectId));
      const [visualCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchVisualBriefs).where(eq(prelaunchVisualBriefs.projectId, projectId));
      const [videoCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchVideoScripts).where(eq(prelaunchVideoScripts.projectId, projectId));
      const [adCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchAdFrameworks).where(eq(prelaunchAdFrameworks.projectId, projectId));

      return {
        M1: kwCount?.count ?? 0,
        M2: compCount?.count ?? 0,
        M3: personaCount?.count ?? 0,
        M4X: copyCount?.count ?? 0,
        M5: visualCount?.count ?? 0,
        M6: videoCount?.count ?? 0,
        M7: adCount?.count ?? 0,
      };
    } catch {
      return { M1: 0, M2: 0, M3: 0, M4X: 0, M5: 0, M6: 0, M7: 0 };
    }
  }

  /**
   * 安全解析seedKeywords
   */
  private parseSeedKeywords(raw: any): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return []; }
    }
    return [];
  }
}
