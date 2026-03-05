/**
 * 亚马逊智能预发布引擎 v4.0 — 主仪表盘
 * 仅admin角色可见
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Rocket, Search, Users, UserCircle, FileText, Image, Video, Megaphone,
  Play, Loader2, CheckCircle, XCircle, Clock, ArrowRight, Plus,
  BarChart3, Zap, Eye, RefreshCw, ChevronRight, AlertCircle,
  Settings, Download, Upload, Trash2
} from "lucide-react";

// ==================== 模块卡片配置 ====================
const MODULE_CONFIG = [
  {
    key: 'M1', name: '搜索词库引擎', icon: Search,
    description: '关键词采集 → 四维分类 → 语义聚类 → COSMO因果链',
    color: 'from-blue-500/20 to-blue-600/20 border-blue-500/30',
    iconColor: 'text-blue-400',
  },
  {
    key: 'M2', name: '竞品库引擎', icon: Users,
    description: '竞品识别 → TRS评分 → 评论分析 → 场景矩阵',
    color: 'from-purple-500/20 to-purple-600/20 border-purple-500/30',
    iconColor: 'text-purple-400',
  },
  {
    key: 'M3', name: '用户画像引擎', icon: UserCircle,
    description: '数据聚合 → Persona生成 → 交叉验证',
    color: 'from-green-500/20 to-green-600/20 border-green-500/30',
    iconColor: 'text-green-400',
  },
  {
    key: 'M4X', name: '文案进化引擎', icon: FileText,
    description: 'Title/Bullet/Description → 半监督进化 → A/B归因',
    color: 'from-amber-500/20 to-amber-600/20 border-amber-500/30',
    iconColor: 'text-amber-400',
  },
  {
    key: 'M5', name: '视觉框架引擎', icon: Image,
    description: '竞品视觉审计 → 7图位战略 → Creative Brief',
    color: 'from-pink-500/20 to-pink-600/20 border-pink-500/30',
    iconColor: 'text-pink-400',
  },
  {
    key: 'M6', name: '视频素材引擎', icon: Video,
    description: 'PAS脚本 → 分镜表 → AIGC分镜图 → Banner创意',
    color: 'from-red-500/20 to-red-600/20 border-red-500/30',
    iconColor: 'text-red-400',
  },
  {
    key: 'M7', name: '广告框架引擎', icon: Megaphone,
    description: 'SP/SB全类型广告 → JSON编译 → API一键部署',
    color: 'from-cyan-500/20 to-cyan-600/20 border-cyan-500/30',
    iconColor: 'text-cyan-400',
  },
];

// ==================== 状态图标映射 ====================
function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed': return <CheckCircle className="w-4 h-4 text-green-400" />;
    case 'running': return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
    case 'failed': return <XCircle className="w-4 h-4 text-red-400" />;
    case 'skipped': return <ArrowRight className="w-4 h-4 text-gray-500" />;
    default: return <Clock className="w-4 h-4 text-gray-500" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    completed: 'bg-green-500/20 text-green-400 border-green-500/30',
    running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    failed: 'bg-red-500/20 text-red-400 border-red-500/30',
    pending: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    skipped: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
  };
  const labels: Record<string, string> = {
    completed: '已完成', running: '运行中', failed: '失败',
    pending: '待运行', skipped: '已跳过',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border ${variants[status] || variants.pending}`}>
      <StatusIcon status={status} />
      {labels[status] || '未知'}
    </span>
  );
}

// ==================== 主组件 ====================
export default function PrelaunchDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [newProjectName, setNewProjectName] = useState("");
  const [seedKeywords, setSeedKeywords] = useState("");
  const [marketplace, setMarketplace] = useState("US");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  // tRPC查询 — 使用实际路由名称
  const dashboardQuery = trpc.prelaunch.getDashboard.useQuery(
    { projectId: selectedProjectId || undefined },
    { refetchInterval: 5000 }
  );
  const projectsQuery = trpc.prelaunch.listProjects.useQuery();
  const pipelineStatusQuery = trpc.prelaunch.getPipelineStatus.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId, refetchInterval: 2000 }
  );

  // tRPC mutations — 使用实际路由名称 runFullPipeline
  const createProject = trpc.prelaunch.createProject.useMutation({
    onSuccess: (data: any) => {
      toast.success(`项目 "${newProjectName}" 创建成功`);
      setSelectedProjectId(data.projectId);
      setNewProjectName("");
      setSeedKeywords("");
      projectsQuery.refetch();
      dashboardQuery.refetch();
    },
    onError: (err: any) => toast.error("创建失败: " + err.message),
  });

  const runPipeline = trpc.prelaunch.runFullPipeline.useMutation({
    onSuccess: () => {
      toast.success("流水线已启动！正在依次执行M1→M7...");
      pipelineStatusQuery.refetch();
    },
    onError: (err: any) => toast.error("启动失败: " + err.message),
  });

  const dashboard = dashboardQuery.data;
  const projectsData = projectsQuery.data;
  const projects = (projectsData && 'data' in projectsData ? (projectsData as any).data : projectsData) || [];
  const pipelineStatus = pipelineStatusQuery.data;

  const handleCreateProject = () => {
    if (!newProjectName.trim()) { toast.error("请输入项目名称"); return; }
    if (!seedKeywords.trim()) { toast.error("请输入种子关键词"); return; }
    createProject.mutate({
      projectName: newProjectName.trim(),
      seedKeywords: seedKeywords.split(/[,，\n]/).map((s: string) => s.trim()).filter(Boolean),
      marketplace,
    });
  };

  const handleRunPipeline = () => {
    if (!selectedProjectId) { toast.error("请先选择或创建项目"); return; }
    runPipeline.mutate({
      projectId: selectedProjectId,
      seedKeywords: seedKeywords.split(/[,，\n]/).map((s: string) => s.trim()).filter(Boolean),
      marketplace,
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/30">
                <Rocket className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold">智能预发布引擎</h1>
                <p className="text-muted-foreground text-sm">v4.0 — AI Agentic Flywheel</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => dashboardQuery.refetch()}
              disabled={dashboardQuery.isFetching}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${dashboardQuery.isFetching ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </div>

        {/* 项目选择器 */}
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              项目管理
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 mb-4">
              {Array.isArray(projects) && projects.map((p: any) => (
                <Button
                  key={p.id}
                  variant={selectedProjectId === p.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedProjectId(p.id)}
                >
                  {p.projectName}
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {p.status}
                  </Badge>
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab("new-project")}
                className="border border-dashed"
              >
                <Plus className="w-4 h-4 mr-1" />
                新建项目
              </Button>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-3 w-full max-w-md">
            <TabsTrigger value="overview">模块总览</TabsTrigger>
            <TabsTrigger value="pipeline">流水线</TabsTrigger>
            <TabsTrigger value="new-project">新建项目</TabsTrigger>
          </TabsList>

          {/* Tab 1: 模块总览 */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {MODULE_CONFIG.map((mod) => {
                const dashData = dashboard as any;
                const moduleData = dashData?.data?.modules?.[mod.key];
                const count = moduleData?.count ?? 0;
                return (
                  <Card
                    key={mod.key}
                    className={`bg-gradient-to-br ${mod.color} cursor-pointer hover:scale-[1.02] transition-transform`}
                    onClick={() => {
                      if (selectedProjectId) {
                        toast.info(`${mod.name} — 共 ${count} 条数据`);
                      }
                    }}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <mod.icon className={`w-5 h-5 ${mod.iconColor}`} />
                          <CardTitle className="text-sm font-medium">{mod.key}</CardTitle>
                        </div>
                        <Badge variant="secondary" className="text-xs">{count}</Badge>
                      </div>
                      <CardDescription className="text-xs mt-1">{mod.name}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground">{mod.description}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* Tab 2: 流水线 */}
          <TabsContent value="pipeline" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">M1→M7 全流程流水线</CardTitle>
                    <CardDescription>一键启动从词库到广告框架的完整预发布流程</CardDescription>
                  </div>
                  <Button
                    onClick={handleRunPipeline}
                    disabled={!selectedProjectId || runPipeline.isPending}
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  >
                    {runPipeline.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-2" />
                    )}
                    启动流水线
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!selectedProjectId ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>请先选择或创建一个项目</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {MODULE_CONFIG.map((mod, idx) => {
                      const psData = pipelineStatus as any;
                      const moduleStatus = psData?.data?.modules?.[mod.key];
                      const status = moduleStatus?.status || 'pending';
                      const isActive = psData?.data?.currentModule === mod.key;
                      return (
                        <div
                          key={mod.key}
                          className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${
                            isActive ? 'border-blue-500/50 bg-blue-500/10' : 'border-border/50'
                          }`}
                        >
                          <div className={`p-2 rounded-lg ${isActive ? 'bg-blue-500/20' : 'bg-muted/50'}`}>
                            <mod.icon className={`w-4 h-4 ${isActive ? mod.iconColor : 'text-muted-foreground'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{mod.key}: {mod.name}</span>
                              <StatusBadge status={status} />
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{mod.description}</p>
                          </div>
                          {idx < MODULE_CONFIG.length - 1 && (
                            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          )}
                        </div>
                      );
                    })}

                    {/* 进度条 */}
                    {(pipelineStatus as any)?.data && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-sm mb-2">
                          <span className="text-muted-foreground">总进度</span>
                          <span className="font-medium">{(pipelineStatus as any).data.progress}%</span>
                        </div>
                        <div className="w-full bg-muted/50 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-500"
                            style={{ width: `${(pipelineStatus as any).data.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 广告框架预览 */}
            {selectedProjectId && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Megaphone className="w-4 h-4 text-cyan-400" />
                    M7 广告框架预览
                  </CardTitle>
                  <CardDescription>编译完成的广告活动结构，支持一键部署到Amazon</CardDescription>
                </CardHeader>
                <CardContent>
                  <AdFrameworkPreview projectId={selectedProjectId} />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tab 3: 新建项目 */}
          <TabsContent value="new-project" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">创建预发布项目</CardTitle>
                <CardDescription>输入产品信息和种子关键词，系统将自动运行M1→M7全流程</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>项目名称</Label>
                    <Input
                      placeholder="例如：Stainless Steel Water Bottle 32oz"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>目标站点</Label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={marketplace}
                      onChange={(e) => setMarketplace(e.target.value)}
                    >
                      <option value="US">Amazon.com (US)</option>
                      <option value="UK">Amazon.co.uk (UK)</option>
                      <option value="DE">Amazon.de (DE)</option>
                      <option value="JP">Amazon.co.jp (JP)</option>
                      <option value="CA">Amazon.ca (CA)</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>种子关键词（每行一个，或用逗号分隔）</Label>
                  <textarea
                    className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder={"stainless steel water bottle\ninsulated water bottle 32oz\nwater bottle for gym\nleak proof water bottle"}
                    value={seedKeywords}
                    onChange={(e) => setSeedKeywords(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    建议输入3-10个核心种子关键词，系统将自动扩展至完整词库
                  </p>
                </div>
                <Separator />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setActiveTab("overview")}>
                    取消
                  </Button>
                  <Button
                    onClick={handleCreateProject}
                    disabled={createProject.isPending}
                    className="bg-gradient-to-r from-blue-600 to-purple-600"
                  >
                    {createProject.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Rocket className="w-4 h-4 mr-2" />
                    )}
                    创建并启动
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// ==================== 广告框架预览子组件 ====================
function AdFrameworkPreview({ projectId }: { projectId: number }) {
  const frameworksQuery = trpc.prelaunch.getAdFrameworks.useQuery({ projectId });
  const deployMutation = trpc.prelaunch.deployAdFramework.useMutation({
    onSuccess: (data: any) => {
      if (data.dryRun) {
        toast.success(`验证通过！预计 ${data.validation?.estimatedApiCalls} 次API调用`);
      } else {
        toast.success("广告框架已部署到Amazon！");
      }
    },
    onError: (err: any) => toast.error("部署失败: " + err.message),
  });

  const frameworks = (frameworksQuery.data as any)?.data || [];

  if (frameworks.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">运行流水线后将在此显示广告框架</p>
      </div>
    );
  }

  const AD_TYPE_LABELS: Record<string, { label: string; color: string }> = {
    SP_KW_MANUAL: { label: 'SP搜索词手动', color: 'bg-blue-500/20 text-blue-400' },
    SP_PT_MANUAL: { label: 'SP产品定位', color: 'bg-purple-500/20 text-purple-400' },
    SP_AUTO: { label: 'SP自动广告', color: 'bg-green-500/20 text-green-400' },
    SBV_KW: { label: 'SB视频搜索词', color: 'bg-amber-500/20 text-amber-400' },
    SBV_PT: { label: 'SB视频产品定位', color: 'bg-red-500/20 text-red-400' },
  };

  return (
    <div className="space-y-3">
      {frameworks.map((fw: any) => {
        const typeInfo = AD_TYPE_LABELS[fw.frameworkType] || { label: fw.frameworkType, color: 'bg-gray-500/20' };
        return (
          <div key={fw.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:border-border transition-colors">
            <div className="flex items-center gap-3">
              <Badge className={typeInfo.color}>{typeInfo.label}</Badge>
              <div>
                <p className="text-sm font-medium">{fw.frameworkName}</p>
                <p className="text-xs text-muted-foreground">
                  {fw.totalCampaigns} 个广告活动 · {fw.totalAdGroups} 个广告组 · {(fw.totalKeywords || 0) + (fw.totalTargets || 0)} 个投放目标
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{fw.status}</Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => deployMutation.mutate({
                  frameworkId: fw.id,
                  profileId: '',
                  dryRun: true,
                })}
                disabled={deployMutation.isPending}
              >
                <Eye className="w-3 h-3 mr-1" />
                验证
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  toast.info("即将部署到Amazon Ads API，请确认...");
                }}
                disabled={fw.status === 'deployed'}
                className="bg-gradient-to-r from-cyan-600 to-blue-600"
              >
                <Upload className="w-3 h-3 mr-1" />
                部署
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
