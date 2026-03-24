/**
 * M3 用户画像引擎 — 详情页
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { UserCircle, ArrowLeft, RefreshCw, Loader2, Play, Heart, Target, ShoppingBag } from "lucide-react";
import { useLocation } from "wouter";

export default function PrelaunchM3Persona() {
  const [, setLocation] = useLocation();
  const [projectId, setProjectId] = useState<number | null>(null);

  const projectsQuery = trpc.prelaunch.listProjects.useQuery() as unknown;
  // @ts-ignore
  const projects = (() => { const d = projectsQuery.data; return (d && 'data' in (d as unknown) ? (d as Record<string, unknown>).data : d) || []; })();
  if (!projectId && projects.length > 0) setProjectId(projects[0].id);

  const personasQuery = trpc.prelaunch.getPersonas.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const runM3 = trpc.prelaunch.runM3Pipeline.useMutation({
    onSuccess: () => { toast.success("M3用户画像引擎已启动"); personasQuery.refetch(); },
    onError: (err) => toast.error("启动失败: " + err.message),
  });

  // @ts-ignore
  const personasData = (personasQuery.data as unknown)?.data || [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/prelaunch")}>
              <ArrowLeft className="w-4 h-4 mr-1" />返回
            </Button>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-green-500/20 to-green-600/20 border border-green-500/30">
                <UserCircle className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold">M3 用户画像引擎</h1>
                <p className="text-muted-foreground text-xs">数据聚合 → Persona生成 → 交叉验证</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              // @ts-ignore
              value={projectId || ''} onChange={(e) => setProjectId(Number(e.target.value))}>
              <option value="">选择项目</option>
              {projects.map((p: unknown) => <option key={(p as any).id} value={(p as any).id}>{(p as any).projectName}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => personasQuery.refetch()} disabled={personasQuery.isFetching}>
              <RefreshCw className={`w-3 h-3 mr-1 ${personasQuery.isFetching ? 'animate-spin' : ''}`} />刷新
            </Button>
            <Button size="sm" onClick={() => projectId && runM3.mutate({ projectId })}
              disabled={!projectId || runM3.isPending} className="bg-green-600 hover:bg-green-700">
              {runM3.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
              运行M3
            </Button>
          </div>
        </div>

        {personasData.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <UserCircle className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-base font-medium">暂无用户画像数据</p>
              <p className="text-sm mt-2">请先运行M3用户画像引擎，系统将基于M1词库和M2竞品数据自动生成Persona</p>
              <Button size="sm" className="mt-4" onClick={() => projectId && runM3.mutate({ projectId })}
                disabled={!projectId || runM3.isPending}>
                <Play className="w-3 h-3 mr-1" />运行M3引擎
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {personasData.map((persona: unknown) => (
              <Card key={persona.id} className="hover:border-green-500/30 transition-colors overflow-hidden">
                <div className="h-2 bg-gradient-to-r from-green-500 to-emerald-500" />
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    {/* @ts-ignore */}
                    <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                      {/* @ts-ignore */}
                      <UserCircle className="w-7 h-7 text-green-400" />
                    </div>
                    <div>
                      {/* @ts-ignore */}
                      <CardTitle className="text-base">{persona.personaName || `Persona ${persona.id}`}</CardTitle>
                      {/* @ts-ignore */}
                      {/* @ts-ignore */}
                      <p className="text-xs text-muted-foreground">{persona.ageRange || ''} {persona.gender || ''}</p>
                    </div>
                  </div>
                {/* @ts-ignore */}
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* @ts-ignore */}
                  {persona.description && (
                    <p className="text-sm text-muted-foreground">{persona.description}</p>
                  )}

                  {(persona as any).painPoints && (
                    <div>
                      <p className="text-xs font-medium flex items-center gap-1 mb-2">
                        <Heart className="w-3 h-3 text-red-400" />痛点
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {(Array.isArray((persona as any).painPoints) ? (persona as any).painPoints : [(persona as any).painPoints]).map((p: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-xs border-red-500/30 text-red-400">{p}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {(persona as any).motivations && (
                    <div>
                      {/* @ts-ignore */}
                      <p className="text-xs font-medium flex items-center gap-1 mb-2">
                        <Target className="w-3 h-3 text-blue-400" />动机
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {(Array.isArray((persona as any).motivations) ? (persona as any).motivations : [(persona as any).motivations]).map((m: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-xs border-blue-500/30 text-blue-400">{m}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {(persona as any).buyingScenarios && (
                    <div>
                      <p className="text-xs font-medium flex items-center gap-1 mb-2">
                        <ShoppingBag className="w-3 h-3 text-amber-400" />购买场景
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {(Array.isArray((persona as any).buyingScenarios) ? (persona as any).buyingScenarios : [(persona as any).buyingScenarios]).map((s: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-xs border-amber-500/30 text-amber-400">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
