/**
 * M5 视觉框架引擎 — 详情页
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Image, ArrowLeft, RefreshCw, Loader2, Play, Eye } from "lucide-react";
import { useLocation } from "wouter";

export default function PrelaunchM5Visual() {
  const [, setLocation] = useLocation();
  const [projectId, setProjectId] = useState<number | null>(null);

  const projectsQuery = trpc.prelaunch.listProjects.useQuery();
  const projects = (() => { const d = projectsQuery.data; return (d && 'data' in (d as any) ? (d as any).data : d) || []; })();
  if (!projectId && projects.length > 0) setProjectId(projects[0].id);

  const briefsQuery = trpc.prelaunch.getVisualBriefs.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const runM5 = trpc.prelaunch.runM5Pipeline.useMutation({
    onSuccess: () => { toast.success("M5视觉框架引擎已启动"); briefsQuery.refetch(); },
    onError: (err) => toast.error("启动失败: " + err.message),
  });

  const briefsData = (briefsQuery.data as any)?.data || [];

  const positionLabels: Record<string, string> = {
    main: '主图', lifestyle_1: '场景图1', lifestyle_2: '场景图2',
    infographic_1: '信息图1', infographic_2: '信息图2',
    comparison: '对比图', packaging: '包装图',
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/prelaunch")}>
              <ArrowLeft className="w-4 h-4 mr-1" />返回
            </Button>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-pink-500/20 to-pink-600/20 border border-pink-500/30">
                <Image className="w-5 h-5 text-pink-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold">M5 视觉框架引擎</h1>
                <p className="text-muted-foreground text-xs">竞品视觉审计 → 7图位战略 → Creative Brief</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value={projectId || ''} onChange={(e) => setProjectId(Number(e.target.value))}>
              <option value="">选择项目</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.projectName}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => briefsQuery.refetch()} disabled={briefsQuery.isFetching}>
              <RefreshCw className={`w-3 h-3 mr-1 ${briefsQuery.isFetching ? 'animate-spin' : ''}`} />刷新
            </Button>
            <Button size="sm" onClick={() => projectId && runM5.mutate({ projectId })}
              disabled={!projectId || runM5.isPending} className="bg-pink-600 hover:bg-pink-700">
              {runM5.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
              运行M5
            </Button>
          </div>
        </div>

        {briefsData.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Image className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-base font-medium">暂无视觉框架数据</p>
              <p className="text-sm mt-2">请先运行M5视觉框架引擎，系统将自动生成7图位Creative Brief</p>
              <Button size="sm" className="mt-4" onClick={() => projectId && runM5.mutate({ projectId })}
                disabled={!projectId || runM5.isPending}>
                <Play className="w-3 h-3 mr-1" />运行M5引擎
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {briefsData.map((brief: any) => (
              <Card key={brief.id} className="hover:border-pink-500/30 transition-colors overflow-hidden">
                {brief.imageUrl ? (
                  <div className="aspect-square bg-muted/30 flex items-center justify-center overflow-hidden">
                    <img src={brief.imageUrl} alt={brief.position} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="aspect-square bg-muted/10 flex items-center justify-center border-b">
                    <div className="text-center">
                      <Image className="w-10 h-10 mx-auto text-muted-foreground/30" />
                      <p className="text-xs text-muted-foreground mt-2">待生成</p>
                    </div>
                  </div>
                )}
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="outline" className="text-xs">
                      {positionLabels[brief.position] || brief.position || `图位 ${brief.slotIndex || ''}`}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">{brief.status || 'draft'}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-3">{brief.briefContent || brief.description || '-'}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
