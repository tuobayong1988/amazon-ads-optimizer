/**
 * 亚马逊智能预发布引擎 — 主仪表盘
 * 核心修复: 完整的项目管理系统（存储、展示、编辑、删除）
 * P1优化: 模块卡片可点击跳转、状态指示、数据流可视化、新建项目分步向导
 */
import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Rocket, Search, Users, UserCircle, FileText, Image, Video, Megaphone,
  Play, Loader2, CheckCircle, XCircle, Clock, ArrowRight, Plus,
  BarChart3, Zap, Eye, RefreshCw, ChevronRight, AlertCircle,
  Settings, Download, Upload, Trash2, ArrowRightCircle,
  Edit3, MoreVertical, FolderOpen, Globe, Tag, Calendar,
  Archive, Filter, X, Copy, ExternalLink
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocation } from "wouter";

// ==================== 模块卡片配置 ====================
const MODULE_CONFIG = [
  {
    key: 'M1', name: '搜索词库引擎', icon: Search,
    description: '关键词采集 → 四维分类 → 语义聚类 → COSMO因果链',
    color: 'from-blue-500/20 to-blue-600/20 border-blue-500/30',
    iconColor: 'text-blue-400',
    hoverBorder: 'hover:border-blue-400/60',
    route: '/prelaunch/m1-keywords',
  },
  {
    key: 'M2', name: '竞品库引擎', icon: Users,
    description: '竞品识别 → TRS评分 → 评论分析 → 场景矩阵',
    color: 'from-purple-500/20 to-purple-600/20 border-purple-500/30',
    iconColor: 'text-purple-400',
    hoverBorder: 'hover:border-purple-400/60',
    route: '/prelaunch/m2-competitors',
  },
  {
    key: 'M3', name: '用户画像引擎', icon: UserCircle,
    description: '数据聚合 → Persona生成 → 交叉验证',
    color: 'from-green-500/20 to-green-600/20 border-green-500/30',
    iconColor: 'text-green-400',
    hoverBorder: 'hover:border-green-400/60',
    route: '/prelaunch/m3-persona',
  },
  {
    key: 'M4X', name: '文案进化引擎', icon: FileText,
    description: 'Title/Bullet/Description → 半监督进化 → A/B归因',
    color: 'from-amber-500/20 to-amber-600/20 border-amber-500/30',
    iconColor: 'text-amber-400',
    hoverBorder: 'hover:border-amber-400/60',
    route: '/prelaunch/m4x-copy',
  },
  {
    key: 'M5', name: '视觉框架引擎', icon: Image,
    description: '竞品视觉审计 → 7图位战略 → Creative Brief',
    color: 'from-pink-500/20 to-pink-600/20 border-pink-500/30',
    iconColor: 'text-pink-400',
    hoverBorder: 'hover:border-pink-400/60',
    route: '/prelaunch/m5-visual',
  },
  {
    key: 'M6', name: '视频素材引擎', icon: Video,
    description: 'PAS脚本 → 分镜表 → AIGC分镜图 → Banner创意',
    color: 'from-red-500/20 to-red-600/20 border-red-500/30',
    iconColor: 'text-red-400',
    hoverBorder: 'hover:border-red-400/60',
    route: '/prelaunch/m6-video',
  },
  {
    key: 'M7', name: '广告框架引擎', icon: Megaphone,
    description: 'SP/SB全类型广告 → JSON编译 → API一键部署',
    color: 'from-indigo-500/20 to-indigo-600/20 border-indigo-500/30',
    iconColor: 'text-indigo-400',
    hoverBorder: 'hover:border-indigo-400/60',
    route: '/prelaunch/m7-ads',
  },
];

// ==================== 站点标签映射 ====================
const MARKETPLACE_LABELS: Record<string, { label: string; flag: string }> = {
  US: { label: 'Amazon.com', flag: '🇺🇸' },
  UK: { label: 'Amazon.co.uk', flag: '🇬🇧' },
  DE: { label: 'Amazon.de', flag: '🇩🇪' },
  JP: { label: 'Amazon.co.jp', flag: '🇯🇵' },
  CA: { label: 'Amazon.ca', flag: '🇨🇦' },
  FR: { label: 'Amazon.fr', flag: '🇫🇷' },
  IT: { label: 'Amazon.it', flag: '🇮🇹' },
  ES: { label: 'Amazon.es', flag: '🇪🇸' },
  AU: { label: 'Amazon.com.au', flag: '🇦🇺' },
};

// ==================== 状态配置 ====================
const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  draft: { label: '草稿', color: 'text-gray-400', bgColor: 'bg-gray-500/20 border-gray-500/30' },
  running: { label: '运行中', color: 'text-blue-400', bgColor: 'bg-blue-500/20 border-blue-500/30' },
  completed: { label: '已完成', color: 'text-green-400', bgColor: 'bg-green-500/20 border-green-500/30' },
  archived: { label: '已归档', color: 'text-amber-400', bgColor: 'bg-amber-500/20 border-amber-500/30' },
};

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
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border ${config.bgColor} ${config.color}`}>
      <StatusIcon status={status} />
      {config.label}
    </span>
  );
}

// ==================== 模块状态标签 ====================
function ModuleStatusTag({ count, pipelineModuleStatus }: { count: number; pipelineModuleStatus?: string }) {
  if (pipelineModuleStatus === 'running') {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-xs text-blue-400">数据采集中</span>
      </div>
    );
  }
  if (pipelineModuleStatus === 'completed' && count > 0) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-green-400" />
        <span className="text-xs text-green-400">分析完成</span>
      </div>
    );
  }
  if (pipelineModuleStatus === 'failed') {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-red-400" />
        <span className="text-xs text-red-400">执行失败</span>
      </div>
    );
  }
  if (count > 0) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-green-400" />
        <span className="text-xs text-green-400">有数据</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2 h-2 rounded-full bg-gray-500" />
      <span className="text-xs text-gray-500">未启动</span>
    </div>
  );
}

// ==================== 模块进度条（迷你版） ====================
function ModuleProgressBar({ moduleStats }: { moduleStats?: Record<string, number> }) {
  if (!moduleStats) return null;
  const modules = ['M1', 'M2', 'M3', 'M4X', 'M5', 'M6', 'M7'];
  const total = modules.length;
  const completed = modules.filter(m => (moduleStats[m] || 0) > 0).length;

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {modules.map((m) => (
          <div
            key={m}
            className={`w-3 h-1.5 rounded-full ${(moduleStats[m] || 0) > 0 ? 'bg-green-400' : 'bg-muted/50'}`}
            title={`${m}: ${moduleStats[m] || 0} 条`}
          />
        ))}
      </div>
      <span className="text-[10px] text-muted-foreground">{completed}/{total}</span>
    </div>
  );
}

// ==================== 数据流可视化组件 ====================
function PipelineFlowVisualization({ pipelineStatus, modules, onModuleClick }: {
  pipelineStatus: any;
  modules: Record<string, any>;
  onModuleClick: (route: string) => void;
}) {
  const psData = pipelineStatus as any;

  return (
    <div className="w-full overflow-x-auto pb-4">
      <div className="flex items-center gap-0 min-w-[900px] px-4 py-6">
        {MODULE_CONFIG.map((mod, idx) => {
          const moduleStatus = psData?.data?.modules?.[mod.key]?.status || 'pending';
          const isActive = psData?.data?.currentModule === mod.key;
          const count = modules?.[mod.key]?.count ?? 0;

          const bgColor = moduleStatus === 'completed' ? 'bg-green-500/10 border-green-500/40' :
            moduleStatus === 'running' ? 'bg-blue-500/10 border-blue-500/40 ring-2 ring-blue-500/20' :
            moduleStatus === 'failed' ? 'bg-red-500/10 border-red-500/40' :
            'bg-muted/30 border-border/50';

          return (
            <div key={mod.key} className="flex items-center">
              <div
                className={`relative flex flex-col items-center p-3 rounded-xl border cursor-pointer transition-all hover:scale-105 ${bgColor}`}
                style={{ minWidth: '100px' }}
                onClick={() => onModuleClick(mod.route)}
              >
                <mod.icon className={`w-5 h-5 ${isActive ? mod.iconColor : moduleStatus === 'completed' ? 'text-green-400' : 'text-muted-foreground'}`} />
                <span className="text-xs font-bold mt-1.5">{mod.key}</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">{mod.name.replace('引擎', '')}</span>
                <Badge variant="secondary" className="text-[10px] mt-1.5 px-1.5 py-0">{count}</Badge>
                {isActive && (
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-ping" />
                )}
              </div>
              {idx < MODULE_CONFIG.length - 1 && (
                <div className="flex items-center mx-1">
                  <div className={`w-6 h-0.5 ${moduleStatus === 'completed' ? 'bg-green-500/60' : 'bg-border/60'}`} />
                  <ArrowRightCircle className={`w-4 h-4 flex-shrink-0 ${moduleStatus === 'completed' ? 'text-green-500/60' : 'text-border/60'}`} />
                  <div className={`w-6 h-0.5 ${moduleStatus === 'completed' ? 'bg-green-500/60' : 'bg-border/60'}`} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== 项目卡片组件 ====================
function ProjectCard({ project, isSelected, onSelect, onEdit, onDelete }: {
  project: any;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const marketplace = MARKETPLACE_LABELS[project.marketplace] || { label: project.marketplace, flag: '' };
  const statusConfig = STATUS_CONFIG[project.status] || STATUS_CONFIG.draft;
  const seedKeywords = Array.isArray(project.seedKeywords)
    ? project.seedKeywords
    : (typeof project.seedKeywords === 'string' ? (() => { try { return JSON.parse(project.seedKeywords); } catch { return []; } })() : []);
  const moduleStats = project.moduleStats || {};
  const totalModuleData = Object.values(moduleStats).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md group ${
        isSelected
          ? 'border-blue-500/60 bg-blue-500/5 ring-1 ring-blue-500/30'
          : 'border-border/50 hover:border-border'
      }`}
      onClick={onSelect}
    >
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <FolderOpen className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-blue-400' : 'text-muted-foreground'}`} />
              <CardTitle className="text-sm font-semibold truncate">{project.projectName}</CardTitle>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <StatusBadge status={project.status} />
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Globe className="w-3 h-3" />
                {marketplace.flag} {project.marketplace}
              </span>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}>
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                <Edit3 className="w-3.5 h-3.5 mr-2" />编辑项目
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelect(); }}>
                <Eye className="w-3.5 h-3.5 mr-2" />查看详情
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-400" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
                <Trash2 className="w-3.5 h-3.5 mr-2" />删除项目
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2.5">
        {/* ASIN & 类目 */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {project.asin && (
            <span className="flex items-center gap-1">
              <Tag className="w-3 h-3" />
              {project.asin}
            </span>
          )}
          {project.category && (
            <span className="truncate">{project.category}</span>
          )}
        </div>

        {/* 种子关键词 */}
        {seedKeywords.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {seedKeywords.slice(0, 3).map((kw: string, i: number) => (
              <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                {kw}
              </Badge>
            ))}
            {seedKeywords.length > 3 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
                +{seedKeywords.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* 模块进度 & 数据统计 */}
        <div className="flex items-center justify-between pt-1 border-t border-border/30">
          <ModuleProgressBar moduleStats={moduleStats} />
          <span className="text-[10px] text-muted-foreground">{totalModuleData} 条数据</span>
        </div>

        {/* 创建时间 */}
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Calendar className="w-3 h-3" />
          {project.createdAt ? new Date(project.createdAt).toLocaleDateString('zh-CN') : '-'}
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== 项目详情/编辑弹窗 ====================
function ProjectDetailDialog({ project, open, onClose, onSaved }: {
  project: any;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(project?.projectName || '');
  const [editAsin, setEditAsin] = useState(project?.asin || '');
  const [editCategory, setEditCategory] = useState(project?.category || '');
  const [editMarketplace, setEditMarketplace] = useState(project?.marketplace || 'US');
  const [editKeywords, setEditKeywords] = useState('');
  const [editStatus, setEditStatus] = useState(project?.status || 'draft');

  const updateProject = trpc.prelaunch.updateProject.useMutation({
    onSuccess: () => {
      toast.success("项目已更新");
      setIsEditing(false);
      onSaved();
    },
    onError: (err: any) => toast.error("更新失败: " + err.message),
  });

  // 当project变化时重置编辑状态
  const resetEditState = () => {
    if (project) {
      setEditName(project.projectName || '');
      setEditAsin(project.asin || '');
      setEditCategory(project.category || '');
      setEditMarketplace(project.marketplace || 'US');
      const kws = Array.isArray(project.seedKeywords)
        ? project.seedKeywords
        : (typeof project.seedKeywords === 'string' ? (() => { try { return JSON.parse(project.seedKeywords); } catch { return []; } })() : []);
      setEditKeywords(kws.join('\n'));
      setEditStatus(project.status || 'draft');
    }
  };

  const handleSave = () => {
    if (!editName.trim()) { toast.error("项目名称不能为空"); return; }
    updateProject.mutate({
      projectId: project.id,
      projectName: editName.trim(),
      asin: editAsin.trim() || undefined,
      category: editCategory.trim() || undefined,
      marketplace: editMarketplace,
      seedKeywords: editKeywords.split(/[,，\n]/).map((s: string) => s.trim()).filter(Boolean),
      status: editStatus as any,
    });
  };

  if (!project) return null;

  const seedKeywords = Array.isArray(project.seedKeywords)
    ? project.seedKeywords
    : (typeof project.seedKeywords === 'string' ? (() => { try { return JSON.parse(project.seedKeywords); } catch { return []; } })() : []);
  const marketplace = MARKETPLACE_LABELS[project.marketplace] || { label: project.marketplace, flag: '' };
  const moduleStats = project.moduleStats || {};

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setIsEditing(false); onClose(); } }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-blue-400" />
              {isEditing ? '编辑项目' : '项目详情'}
            </DialogTitle>
            {!isEditing && (
              <Button variant="outline" size="sm" onClick={() => { resetEditState(); setIsEditing(true); }}>
                <Edit3 className="w-3.5 h-3.5 mr-1.5" />编辑
              </Button>
            )}
          </div>
          <DialogDescription>
            {isEditing ? '修改项目信息后点击保存' : `项目 ID: ${project.id}`}
          </DialogDescription>
        </DialogHeader>

        {isEditing ? (
          /* ========== 编辑模式 ========== */
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>项目名称 <span className="text-red-400">*</span></Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="项目名称" />
              </div>
              <div className="space-y-2">
                <Label>目标站点</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={editMarketplace} onChange={(e) => setEditMarketplace(e.target.value)}>
                  {Object.entries(MARKETPLACE_LABELS).map(([code, info]) => (
                    <option key={code} value={code}>{info.flag} {info.label} ({code})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>ASIN</Label>
                <Input value={editAsin} onChange={(e) => setEditAsin(e.target.value)} placeholder="例如：B0FNVPZ2BS" />
              </div>
              <div className="space-y-2">
                <Label>产品类目</Label>
                <Input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} placeholder="例如：Sports & Outdoors" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>项目状态</Label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                <option value="draft">草稿</option>
                <option value="running">运行中</option>
                <option value="completed">已完成</option>
                <option value="archived">已归档</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>种子关键词（每行一个，或用逗号分隔）</Label>
              <textarea
                className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={editKeywords}
                onChange={(e) => setEditKeywords(e.target.value)}
                placeholder="每行输入一个关键词"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditing(false)}>取消</Button>
              <Button onClick={handleSave} disabled={updateProject.isPending}>
                {updateProject.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                保存修改
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* ========== 查看模式 ========== */
          <div className="space-y-5 mt-2">
            {/* 基本信息 */}
            <div className="bg-muted/20 rounded-lg p-4">
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Settings className="w-4 h-4 text-muted-foreground" />
                基本信息
              </h4>
              <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
                <div>
                  <span className="text-muted-foreground">项目名称</span>
                  <p className="font-medium mt-0.5">{project.projectName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">状态</span>
                  <div className="mt-0.5"><StatusBadge status={project.status} /></div>
                </div>
                <div>
                  <span className="text-muted-foreground">目标站点</span>
                  <p className="font-medium mt-0.5">{marketplace.flag} {marketplace.label}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">ASIN</span>
                  <p className="font-medium mt-0.5">{project.asin || <span className="text-muted-foreground italic">未设置</span>}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">产品类目</span>
                  <p className="font-medium mt-0.5">{project.category || <span className="text-muted-foreground italic">未设置</span>}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">创建时间</span>
                  <p className="font-medium mt-0.5">{project.createdAt ? new Date(project.createdAt).toLocaleString('zh-CN') : '-'}</p>
                </div>
              </div>
            </div>

            {/* 种子关键词 */}
            <div className="bg-muted/20 rounded-lg p-4">
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Search className="w-4 h-4 text-muted-foreground" />
                种子关键词
                <Badge variant="secondary" className="text-xs">{seedKeywords.length} 个</Badge>
              </h4>
              {seedKeywords.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {seedKeywords.map((kw: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs font-normal">{kw}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">暂无种子关键词</p>
              )}
            </div>

            {/* 模块数据统计 */}
            <div className="bg-muted/20 rounded-lg p-4">
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-muted-foreground" />
                模块数据统计
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {MODULE_CONFIG.map((mod) => {
                  const count = moduleStats[mod.key] || 0;
                  return (
                    <div key={mod.key} className={`flex items-center gap-2 p-2 rounded-lg border ${count > 0 ? 'border-green-500/20 bg-green-500/5' : 'border-border/30'}`}>
                      <mod.icon className={`w-4 h-4 ${count > 0 ? mod.iconColor : 'text-muted-foreground'}`} />
                      <div>
                        <p className="text-xs font-medium">{mod.key}</p>
                        <p className={`text-xs ${count > 0 ? 'text-green-400' : 'text-muted-foreground'}`}>{count} 条</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ==================== 新建项目分步向导 ====================
function CreateProjectWizard({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (projectId: number) => void;
}) {
  const [step, setStep] = useState(1);
  const [projectName, setProjectName] = useState("");
  const [asin, setAsin] = useState("");
  const [category, setCategory] = useState("");
  const [marketplace, setMarketplace] = useState("US");
  const [seedKeywords, setSeedKeywords] = useState("");
  const [selectedModules, setSelectedModules] = useState<string[]>(['M1', 'M2', 'M3', 'M4X', 'M5', 'M6', 'M7']);

  const createProject = trpc.prelaunch.createProject.useMutation({
    onSuccess: (data: any) => {
      toast.success(`项目 "${projectName}" 创建成功`);
      onCreated(data.projectId || data.id);
    },
    onError: (err: any) => toast.error("创建失败: " + err.message),
  });

  const toggleModule = (key: string) => {
    setSelectedModules(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSubmit = () => {
    if (!projectName.trim()) { toast.error("请输入项目名称"); return; }
    createProject.mutate({
      projectName: projectName.trim(),
      asin: asin.trim() || undefined,
      category: category.trim() || undefined,
      marketplace,
      seedKeywords: seedKeywords.split(/[,，\n]/).map(s => s.trim()).filter(Boolean),
    });
  };

  return (
    <Card className="border-blue-500/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="w-4 h-4 text-blue-400" />
            创建预发布项目
          </CardTitle>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={`flex items-center gap-1 ${s <= step ? 'text-blue-400' : 'text-muted-foreground'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${
                  s === step ? 'bg-blue-500/20 border-blue-500' :
                  s < step ? 'bg-green-500/20 border-green-500 text-green-400' :
                  'border-border'
                }`}>
                  {s < step ? <CheckCircle className="w-3 h-3" /> : s}
                </div>
                {s < 4 && <div className={`w-4 h-0.5 ${s < step ? 'bg-green-500/60' : 'bg-border'}`} />}
              </div>
            ))}
          </div>
        </div>
        <CardDescription className="text-xs">
          {step === 1 && "Step 1/4: 输入产品基本信息"}
          {step === 2 && "Step 2/4: 选择要执行的模块"}
          {step === 3 && "Step 3/4: 配置种子关键词和参数"}
          {step === 4 && "Step 4/4: 确认信息并启动"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>项目名称 <span className="text-red-400">*</span></Label>
                <Input placeholder="例如：Stainless Steel Water Bottle 32oz" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>目标站点</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" value={marketplace} onChange={(e) => setMarketplace(e.target.value)}>
                  {Object.entries(MARKETPLACE_LABELS).map(([code, info]) => (
                    <option key={code} value={code}>{info.flag} {info.label} ({code})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>ASIN（可选）</Label>
                <Input placeholder="例如：B0FNVPZ2BS" value={asin} onChange={(e) => setAsin(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>产品类目（可选）</Label>
                <Input placeholder="例如：Sports & Outdoors" value={category} onChange={(e) => setCategory(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">选择需要执行的模块（建议全选以获得最佳效果）</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {MODULE_CONFIG.map((mod) => (
                <div
                  key={mod.key}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedModules.includes(mod.key)
                      ? `bg-gradient-to-br ${mod.color}`
                      : 'border-border/50 hover:border-border'
                  }`}
                  onClick={() => toggleModule(mod.key)}
                >
                  <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                    selectedModules.includes(mod.key) ? 'bg-blue-500 border-blue-500' : 'border-border'
                  }`}>
                    {selectedModules.includes(mod.key) && <CheckCircle className="w-3 h-3 text-white" />}
                  </div>
                  <mod.icon className={`w-4 h-4 ${selectedModules.includes(mod.key) ? mod.iconColor : 'text-muted-foreground'}`} />
                  <div>
                    <p className="text-sm font-medium">{mod.key}: {mod.name}</p>
                    <p className="text-xs text-muted-foreground">{mod.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>种子关键词（每行一个，或用逗号分隔）<span className="text-red-400">*</span></Label>
              <textarea
                className="flex min-h-[150px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={"stainless steel water bottle\ninsulated water bottle 32oz\nwater bottle for gym\nleak proof water bottle"}
                value={seedKeywords}
                onChange={(e) => setSeedKeywords(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">建议输入3-10个核心种子关键词，系统将自动扩展至完整词库</p>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="bg-muted/20 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">项目名称:</span> <span className="font-medium">{projectName}</span></div>
                <div><span className="text-muted-foreground">目标站点:</span> <span className="font-medium">{MARKETPLACE_LABELS[marketplace]?.flag} {marketplace}</span></div>
                {asin && <div><span className="text-muted-foreground">ASIN:</span> <span className="font-medium">{asin}</span></div>}
                {category && <div><span className="text-muted-foreground">类目:</span> <span className="font-medium">{category}</span></div>}
              </div>
              <Separator />
              <div>
                <p className="text-xs text-muted-foreground mb-2">执行模块:</p>
                <div className="flex flex-wrap gap-1">
                  {selectedModules.map((key) => {
                    const mod = MODULE_CONFIG.find(m => m.key === key);
                    return mod ? (
                      <Badge key={key} variant="secondary" className="text-xs">{mod.key}: {mod.name}</Badge>
                    ) : null;
                  })}
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-xs text-muted-foreground mb-1">种子关键词:</p>
                <div className="flex flex-wrap gap-1">
                  {seedKeywords.split(/[,，\n]/).map(s => s.trim()).filter(Boolean).map((kw, i) => (
                    <Badge key={i} variant="outline" className="text-xs">{kw}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <Separator />
        <div className="flex justify-between">
          <Button variant="outline" onClick={step === 1 ? onClose : () => setStep(s => s - 1)}>
            {step === 1 ? '取消' : '上一步'}
          </Button>
          {step < 4 ? (
            <Button onClick={() => {
              if (step === 1 && !projectName.trim()) { toast.error("请输入项目名称"); return; }
              if (step === 2 && selectedModules.length === 0) { toast.error("请至少选择一个模块"); return; }
              setStep(s => s + 1);
            }}>
              下一步 <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={createProject.isPending}
              className="bg-gradient-to-r from-blue-600 to-purple-600">
              {createProject.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
              创建并启动
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== 主组件 ====================
export default function PrelaunchDashboard() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState<string>("all");
  const [detailProject, setDetailProject] = useState<any>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [deleteProject, setDeleteProject] = useState<any>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // tRPC查询
  const dashboardQuery = trpc.prelaunch.getDashboard.useQuery(
    { projectId: selectedProjectId || undefined },
    { refetchInterval: 5000 }
  );
  const projectsQuery = trpc.prelaunch.listProjects.useQuery({
    status: projectStatusFilter !== 'all' ? projectStatusFilter as any : undefined,
    search: projectSearch || undefined,
    page: 1,
    pageSize: 50,
  });
  const pipelineStatusQuery = trpc.prelaunch.getPipelineStatus.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId, refetchInterval: 2000 }
  );

  const runPipeline = trpc.prelaunch.runFullPipeline.useMutation({
    onSuccess: () => {
      toast.success("流水线已启动！正在依次执行M1→M7...");
      pipelineStatusQuery.refetch();
    },
    onError: (err: any) => toast.error("启动失败: " + err.message),
  });

  const deleteProjectMutation = trpc.prelaunch.deleteProject.useMutation({
    onSuccess: () => {
      toast.success("项目已删除");
      if (selectedProjectId === deleteProject?.id) {
        setSelectedProjectId(null);
      }
      setShowDeleteConfirm(false);
      setDeleteProject(null);
      projectsQuery.refetch();
      dashboardQuery.refetch();
    },
    onError: (err: any) => toast.error("删除失败: " + err.message),
  });

  const dashboard = dashboardQuery.data;
  const projectsData = projectsQuery.data;
  const projects = (projectsData && 'data' in projectsData ? (projectsData as any).data : projectsData) || [];
  const pipelineStatus = pipelineStatusQuery.data;
  const modules = (dashboard as any)?.data?.modules || {};

  // 统计数据
  const projectStats = useMemo(() => {
    const all = Array.isArray(projects) ? projects : [];
    return {
      total: all.length,
      draft: all.filter((p: any) => p.status === 'draft').length,
      running: all.filter((p: any) => p.status === 'running').length,
      completed: all.filter((p: any) => p.status === 'completed').length,
      archived: all.filter((p: any) => p.status === 'archived').length,
    };
  }, [projects]);

  const handleRunPipeline = () => {
    if (!selectedProjectId) { toast.error("请先选择或创建项目"); return; }
    runPipeline.mutate({
      projectId: selectedProjectId,
      seedKeywords: [],
      marketplace: 'US',
    });
  };

  const handleDeleteProject = () => {
    if (deleteProject) {
      deleteProjectMutation.mutate({ projectId: deleteProject.id });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/30">
              <Rocket className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">智能预发布引擎</h1>
              <p className="text-muted-foreground text-sm">AI Agentic Flywheel — M1→M7 全流程自动化</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { dashboardQuery.refetch(); projectsQuery.refetch(); }}
              disabled={dashboardQuery.isFetching || projectsQuery.isFetching}>
              <RefreshCw className={`w-4 h-4 mr-1 ${(dashboardQuery.isFetching || projectsQuery.isFetching) ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button size="sm" onClick={() => setShowCreateWizard(true)} className="bg-gradient-to-r from-blue-600 to-purple-600">
              <Plus className="w-4 h-4 mr-1" />
              新建项目
            </Button>
          </div>
        </div>

        {/* 新建项目向导 */}
        {showCreateWizard && (
          <CreateProjectWizard
            onClose={() => setShowCreateWizard(false)}
            onCreated={(id) => {
              setSelectedProjectId(id);
              setShowCreateWizard(false);
              projectsQuery.refetch();
              dashboardQuery.refetch();
            }}
          />
        )}

        {/* ==================== 项目管理区域（核心修复） ==================== */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                项目管理
                <Badge variant="secondary" className="text-xs">{projectStats.total} 个项目</Badge>
              </CardTitle>
            </div>
            {/* 搜索和筛选工具栏 */}
            <div className="flex items-center gap-3 mt-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索项目名称、ASIN、类目..."
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  className="pl-9 h-8 text-sm"
                />
                {projectSearch && (
                  <Button variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                    onClick={() => setProjectSearch("")}>
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-1">
                {[
                  { key: 'all', label: '全部', count: projectStats.total },
                  { key: 'draft', label: '草稿', count: projectStats.draft },
                  { key: 'running', label: '运行中', count: projectStats.running },
                  { key: 'completed', label: '已完成', count: projectStats.completed },
                  { key: 'archived', label: '已归档', count: projectStats.archived },
                ].map((f) => (
                  <Button
                    key={f.key}
                    variant={projectStatusFilter === f.key ? "default" : "ghost"}
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => setProjectStatusFilter(f.key)}
                  >
                    {f.label}
                    {f.count > 0 && <span className="ml-1 opacity-60">({f.count})</span>}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {projectsQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">加载项目列表...</span>
              </div>
            ) : Array.isArray(projects) && projects.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {projects.map((p: any) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    isSelected={selectedProjectId === p.id}
                    onSelect={() => {
                      setSelectedProjectId(p.id);
                      setDetailProject(p);
                      setShowDetailDialog(true);
                    }}
                    onEdit={() => {
                      setDetailProject(p);
                      setShowDetailDialog(true);
                    }}
                    onDelete={() => {
                      setDeleteProject(p);
                      setShowDeleteConfirm(true);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <FolderOpen className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-30" />
                <p className="text-sm text-muted-foreground mb-1">
                  {projectSearch ? `未找到匹配 "${projectSearch}" 的项目` : '暂无项目'}
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  {projectSearch ? '尝试修改搜索条件' : '点击右上角"新建项目"开始创建您的第一个预发布项目'}
                </p>
                {!projectSearch && (
                  <Button size="sm" onClick={() => setShowCreateWizard(true)}
                    className="bg-gradient-to-r from-blue-600 to-purple-600">
                    <Plus className="w-4 h-4 mr-1" />新建项目
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 当前选中项目的快速信息栏 */}
        {selectedProjectId && (() => {
          const selectedProject = Array.isArray(projects) ? projects.find((p: any) => p.id === selectedProjectId) : null;
          if (!selectedProject) return null;
          return (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <FolderOpen className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="text-sm font-medium">当前项目:</span>
              <span className="text-sm">{selectedProject.projectName}</span>
              <StatusBadge status={selectedProject.status} />
              {selectedProject.asin && (
                <Badge variant="outline" className="text-xs">{selectedProject.asin}</Badge>
              )}
              <div className="flex-1" />
              <Button variant="ghost" size="sm" className="h-7 text-xs"
                onClick={() => { setDetailProject(selectedProject); setShowDetailDialog(true); }}>
                <Eye className="w-3 h-3 mr-1" />详情
              </Button>
            </div>
          );
        })()}

        {/* Tabs: 模块总览 / 流水线 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-2 w-full max-w-sm">
            <TabsTrigger value="overview">模块总览</TabsTrigger>
            <TabsTrigger value="pipeline">流水线</TabsTrigger>
          </TabsList>

          {/* Tab 1: 模块总览 */}
          <TabsContent value="overview" className="space-y-4">
            {!selectedProjectId ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <AlertCircle className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">请先在上方选择一个项目，或创建新项目</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {MODULE_CONFIG.map((mod) => {
                  const moduleData = modules[mod.key];
                  const count = moduleData?.count ?? 0;
                  const psData = pipelineStatus as any;
                  const pipelineModuleStatus = psData?.data?.modules?.[mod.key]?.status;

                  return (
                    <Card
                      key={mod.key}
                      className={`bg-gradient-to-br ${mod.color} cursor-pointer hover:scale-[1.02] ${mod.hoverBorder} transition-all group`}
                      onClick={() => setLocation(mod.route)}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <mod.icon className={`w-5 h-5 ${mod.iconColor}`} />
                            <CardTitle className="text-sm font-medium">{mod.key}</CardTitle>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <CardDescription className="text-xs mt-1">{mod.name}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-xs text-muted-foreground mb-3">{mod.description}</p>
                        <div className="flex items-center justify-between">
                          <ModuleStatusTag count={count} pipelineModuleStatus={pipelineModuleStatus} />
                          <Badge variant="secondary" className="text-xs tabular-nums">{count} 条</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Tab 2: 流水线 */}
          <TabsContent value="pipeline" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">数据流水线</CardTitle>
                    <CardDescription className="text-xs">点击模块节点可跳转到详情页</CardDescription>
                  </div>
                  <Button
                    onClick={handleRunPipeline}
                    disabled={!selectedProjectId || runPipeline.isPending}
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  >
                    {runPipeline.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
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
                  <>
                    <PipelineFlowVisualization
                      pipelineStatus={pipelineStatus}
                      modules={modules}
                      onModuleClick={(route) => setLocation(route)}
                    />
                    {(pipelineStatus as any)?.data && (
                      <div className="mt-2 px-4">
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
                  </>
                )}
              </CardContent>
            </Card>

            {/* 模块详细状态列表 */}
            {selectedProjectId && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">模块执行状态</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {MODULE_CONFIG.map((mod) => {
                      const psData = pipelineStatus as any;
                      const moduleStatus = psData?.data?.modules?.[mod.key];
                      const status = moduleStatus?.status || 'pending';
                      const isActive = psData?.data?.currentModule === mod.key;
                      return (
                        <div
                          key={mod.key}
                          className={`flex items-center gap-4 p-3 rounded-lg border transition-colors cursor-pointer hover:bg-muted/20 ${
                            isActive ? 'border-blue-500/50 bg-blue-500/10' : 'border-border/50'
                          }`}
                          onClick={() => setLocation(mod.route)}
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
                          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 广告框架预览 */}
            {selectedProjectId && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Megaphone className="w-4 h-4 text-indigo-400" />
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
        </Tabs>
      </div>

      {/* ==================== 项目详情/编辑弹窗 ==================== */}
      <ProjectDetailDialog
        project={detailProject}
        open={showDetailDialog}
        onClose={() => { setShowDetailDialog(false); setDetailProject(null); }}
        onSaved={() => {
          projectsQuery.refetch();
          dashboardQuery.refetch();
        }}
      />

      {/* ==================== 删除确认弹窗 ==================== */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除项目</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除项目 <strong>"{deleteProject?.projectName}"</strong> 吗？此操作将同时删除该项目下所有模块的数据（关键词、竞品、用户画像、文案、视觉框架、视频脚本、广告框架），且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setShowDeleteConfirm(false); setDeleteProject(null); }}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProject}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteProjectMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
              <Button variant="outline" size="sm"
                onClick={() => deployMutation.mutate({ frameworkId: fw.id, profileId: '', dryRun: true })}
                disabled={deployMutation.isPending}>
                <Eye className="w-3 h-3 mr-1" />验证
              </Button>
              <Button size="sm"
                onClick={() => toast.info("即将部署到Amazon Ads API，请确认...")}
                disabled={fw.status === 'deployed'}
                className="bg-gradient-to-r from-indigo-600 to-blue-600">
                <Upload className="w-3 h-3 mr-1" />部署
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
