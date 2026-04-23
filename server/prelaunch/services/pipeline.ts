/**
 * 预发布引擎流水线编排器
 * M1→M1B→M2→M3→M4X→M5→M6→M7 全流程自动化
 * 
 * v2.0 更新：在 M1 和 M2 之间新增 M1B 属性分析步骤。
 * M1B 分析搜索行为中的属性维度（颜色、尺码、款式、数量），
 * 判断用户是否有清晰的属性需求意识，为 M2 竞品过滤提供依据。
 */
import { getDb } from '../../db';
import { prelaunchProjects } from '../../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { createModuleLogger } from '../../utils/logger';
const log = createModuleLogger('Pipeline');

interface PipelineInput {
  projectId: number;
  seedKeywords: string[];
  marketplace: string;
  skipModules?: string[];
}

interface PipelineStatus {
  projectId: number;
  currentModule: string;
  progress: number;
  modules: Record<string, { status: string; startedAt?: string; completedAt?: string; error?: string }>;
}

// 内存中的流水线状态追踪
const pipelineStatuses = new Map<number, PipelineStatus>();

export class PrelaunchPipelineOrchestrator {

  async runFullPipeline(input: PipelineInput) {
    const { projectId, seedKeywords, marketplace, skipModules = [] } = input;

    const status: PipelineStatus = {
      projectId,
      currentModule: 'M1',
      progress: 0,
      modules: {
        M1: { status: 'pending' },
        M1B: { status: 'pending' },
        M2: { status: 'pending' },
        M3: { status: 'pending' },
        M4X: { status: 'pending' },
        M5: { status: 'pending' },
        M6: { status: 'pending' },
        M7: { status: 'pending' },
      },
    };
    pipelineStatuses.set(projectId, status);

    // 异步执行流水线（不阻塞请求）
    this.executePipeline(input, status).catch((err: any) => {
      status.currentModule = 'ERROR';
      log.warn('Pipeline execution error:', err);
    });

    return {
      success: true,
      message: 'Pipeline started. Use getPipelineStatus to monitor progress.',
      projectId,
    };
  }

  async getStatus(projectId: number) {
    const status = pipelineStatuses.get(projectId);
    if (!status) {
      return { success: false, error: 'No pipeline running for this project' };
    }
    return { success: true, data: status };
  }

  private async executePipeline(input: PipelineInput, status: PipelineStatus) {
    const { projectId, seedKeywords, marketplace, skipModules = [] } = input;
    const db = await getDb();

    const modules = [
      {
        name: 'M1',
        run: async () => {
          const { M1KeywordService } = await import('./m1-keywords');
          return new M1KeywordService().runPipeline(projectId, seedKeywords, marketplace);
        },
      },
      {
        name: 'M1B',
        run: async () => {
          const { M1BAttributeAnalysisService } = await import('./m1b-attribute-analysis');
          return new M1BAttributeAnalysisService().runPipeline(projectId);
        },
      },
      {
        name: 'M2',
        run: async () => {
          const { M2CompetitorService } = await import('./m2-competitors');
          return new M2CompetitorService().runPipeline(projectId, undefined, true);
        },
      },
      {
        name: 'M3',
        run: async () => {
          const { M3PersonaService } = await import('./m3-persona');
          return new M3PersonaService().runPipeline(projectId);
        },
      },
      {
        name: 'M4X',
        run: async () => {
          const { M4XCopyService } = await import('./m4x-copy');
          return new M4XCopyService().generateInitialCopy(projectId);
        },
      },
      {
        name: 'M5',
        run: async () => {
          const { M5VisualService } = await import('./m5-visual');
          return new M5VisualService().runPipeline(projectId);
        },
      },
      {
        name: 'M6',
        run: async () => {
          const { M6VideoService } = await import('./m6-video');
          return new M6VideoService().runPipeline(projectId);
        },
      },
      {
        name: 'M7',
        run: async () => {
          const { M7AdFrameworkService } = await import('./m7-ad-framework');
          return new M7AdFrameworkService().compileFrameworks({
            projectId,
            frameworkTypes: ['SP_KW_MANUAL', 'SP_PT_MANUAL', 'SP_AUTO', 'SBV_KW', 'SBV_PT'],
            defaultBid: 0.75,
            dailyBudget: 30,
          });
        },
      },
    ];

    let completedCount = 0;

    for (const mod of modules) {
      if (skipModules.includes(mod.name)) {
        status.modules[mod.name] = { status: 'skipped' };
        completedCount++;
        status.progress = Math.round((completedCount / modules.length) * 100);
        continue;
      }

      try {
        status.currentModule = mod.name;
        status.modules[mod.name] = { status: 'running', startedAt: new Date().toISOString() };

        const result = await mod.run();

        status.modules[mod.name] = {
          status: result.success ? 'completed' : 'failed',
          startedAt: status.modules[mod.name].startedAt,
          completedAt: new Date().toISOString(),
          // @ts-expect-error Dynamic type assertion
          error: result.success ? undefined : (result as Record<string, unknown>).error,
        };
      } catch (error: unknown) {
        status.modules[mod.name] = {
          status: 'failed',
          startedAt: status.modules[mod.name].startedAt,
          completedAt: new Date().toISOString(),
          error: (error as Error).message,
        };
      }

      completedCount++;
      status.progress = Math.round((completedCount / modules.length) * 100);
    }

    status.currentModule = 'COMPLETED';
    status.progress = 100;

    // 更新项目状态
    if (db) {
      await db.update(prelaunchProjects)
        .set({ status: 'completed' })
        .where(eq(prelaunchProjects.id, projectId));
    }
  }
}
