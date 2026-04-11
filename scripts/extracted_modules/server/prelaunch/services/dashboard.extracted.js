// Extracted from production dist/index.js
// Original module: server/prelaunch/services/dashboard.ts
// Lines: 67

var dashboard_exports = {};
__export(dashboard_exports, {
  PrelaunchDashboardService: () => PrelaunchDashboardService
});
var PrelaunchDashboardService;
var init_dashboard = __esm({
  "server/prelaunch/services/dashboard.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    PrelaunchDashboardService = class {
      static {
        __name(this, "PrelaunchDashboardService");
      }
      async getDashboard(userId, projectId) {
        const db = await getDb();
        if (!db) return { success: false, error: "Database not available" };
        try {
          const projects = await db.select().from(prelaunchProjects).orderBy(desc(prelaunchProjects.createdAt)).limit(10);
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
                modules: {}
              }
            };
          }
          const [kwCount] = await db.select({ count: sql`COUNT(*)` }).from(prelaunchKeywords).where(eq(prelaunchKeywords.projectId, projectId));
          const [compCount] = await db.select({ count: sql`COUNT(*)` }).from(prelaunchCompetitors).where(eq(prelaunchCompetitors.projectId, projectId));
          const [personaCount] = await db.select({ count: sql`COUNT(*)` }).from(prelaunchPersonas).where(eq(prelaunchPersonas.projectId, projectId));
          const [copyCount] = await db.select({ count: sql`COUNT(*)` }).from(prelaunchCopyVersions).where(eq(prelaunchCopyVersions.projectId, projectId));
          const [visualCount] = await db.select({ count: sql`COUNT(*)` }).from(prelaunchVisualBriefs).where(eq(prelaunchVisualBriefs.projectId, projectId));
          const [videoCount] = await db.select({ count: sql`COUNT(*)` }).from(prelaunchVideoScripts).where(eq(prelaunchVideoScripts.projectId, projectId));
          const [adCount] = await db.select({ count: sql`COUNT(*)` }).from(prelaunchAdFrameworks).where(eq(prelaunchAdFrameworks.projectId, projectId));
          const selectedProject = projects.find((p) => p.id === projectId) || null;
          return {
            success: true,
            data: {
              projects,
              projectCount: projects.length,
              selectedProject,
              modules: {
                M1: { name: "\u641C\u7D22\u8BCD\u5E93", count: kwCount?.count ?? 0, icon: "Search" },
                M2: { name: "\u7ADE\u54C1\u5E93", count: compCount?.count ?? 0, icon: "Users" },
                M3: { name: "\u7528\u6237\u753B\u50CF", count: personaCount?.count ?? 0, icon: "UserCircle" },
                M4X: { name: "\u6587\u6848\u5F15\u64CE", count: copyCount?.count ?? 0, icon: "FileText" },
                M5: { name: "\u89C6\u89C9\u6846\u67B6", count: visualCount?.count ?? 0, icon: "Image" },
                M6: { name: "\u89C6\u9891\u521B\u610F", count: videoCount?.count ?? 0, icon: "Video" },
                M7: { name: "\u5E7F\u544A\u6846\u67B6", count: adCount?.count ?? 0, icon: "Megaphone" }
              }
            }
          };
        } catch (error48) {
          return { success: false, error: error48.message };
        }
      }
    };
  }
});

