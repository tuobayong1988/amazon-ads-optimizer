/**
 * 预发布引擎仪表盘服务
 */
import { getDb } from '../../db';
import {
  prelaunchProjects, prelaunchKeywords, prelaunchCompetitors,
  prelaunchPersonas, prelaunchCopyVersions, prelaunchVisualBriefs,
  prelaunchVideoScripts, prelaunchAdFrameworks,
} from '../../../drizzle/schema';
import { eq, sql, desc } from 'drizzle-orm';

export class PrelaunchDashboardService {

  async getDashboard(userId: number, projectId?: number) {
    const db = await getDb();
    if (!db) return { success: false, error: 'Database not available' };

    try {
      // 项目概览
      const projects = await db.select()
        .from(prelaunchProjects)
        .orderBy(desc(prelaunchProjects.createdAt))
        .limit(10);

      if (!projectId && projects.length > 0) {
        projectId = projects[0].id;
      }

      if (!projectId) {
        return {
          success: true,
          data: {
            projects,
            projectCount: projects.length,
            selectedProject: null,
            modules: {},
          },
        };
      }

      // 各模块统计
      const [kwCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchKeywords)
        .where(eq(prelaunchKeywords.projectId, projectId));

      const [compCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchCompetitors)
        .where(eq(prelaunchCompetitors.projectId, projectId));

      const [personaCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchPersonas)
        .where(eq(prelaunchPersonas.projectId, projectId));

      const [copyCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchCopyVersions)
        .where(eq(prelaunchCopyVersions.projectId, projectId));

      const [visualCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchVisualBriefs)
        .where(eq(prelaunchVisualBriefs.projectId, projectId));

      const [videoCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchVideoScripts)
        .where(eq(prelaunchVideoScripts.projectId, projectId));

      const [adCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(prelaunchAdFrameworks)
        .where(eq(prelaunchAdFrameworks.projectId, projectId));

      const selectedProject = projects.find(p => p.id === projectId) || null;

      return {
        success: true,
        data: {
          projects,
          projectCount: projects.length,
          selectedProject,
          modules: {
            M1: { name: '搜索词库', count: kwCount?.count ?? 0, icon: 'Search' },
            M2: { name: '竞品库', count: compCount?.count ?? 0, icon: 'Users' },
            M3: { name: '用户画像', count: personaCount?.count ?? 0, icon: 'UserCircle' },
            M4X: { name: '文案引擎', count: copyCount?.count ?? 0, icon: 'FileText' },
            M5: { name: '视觉框架', count: visualCount?.count ?? 0, icon: 'Image' },
            M6: { name: '视频创意', count: videoCount?.count ?? 0, icon: 'Video' },
            M7: { name: '广告框架', count: adCount?.count ?? 0, icon: 'Megaphone' },
          },
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
