/**
 * M6 视频素材引擎 — 详情页
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Video, ArrowLeft, RefreshCw, Loader2, Play, Image as ImageIcon, Film } from "lucide-react";
import { useLocation } from "wouter";

export default function PrelaunchM6Video() {
  const [, setLocation] = useLocation();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("scripts");

  const projectsQuery = trpc.prelaunch.listProjects.useQuery() as unknown;
  const projects = (() => { const d = projectsQuery.data; return (d && 'data' in (d as unknown) ? (d as Record<string, unknown>).data : d) || []; })();
  if (!projectId && projects.length > 0) setProjectId(projects[0].id);

  const scriptsQuery = trpc.prelaunch.getVideoScripts.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const bannersQuery = trpc.prelaunch.getBannerCreatives.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && activeTab === 'banners' }
  );

  const runM6 = trpc.prelaunch.runM6Pipeline.useMutation({
    onSuccess: () => { toast.success("M6视频素材引擎已启动"); scriptsQuery.refetch(); },
    onError: (err) => toast.error("启动失败: " + err.message),
  });

  const scriptsData = (scriptsQuery.data as unknown)?.data || [];
  const bannersData = (bannersQuery.data as unknown)?.data || [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/prelaunch")}>
              <ArrowLeft className="w-4 h-4 mr-1" />返回
            </Button>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-red-500/20 to-red-600/20 border border-red-500/30">
                <Video className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold">M6 视频素材引擎</h1>
                <p className="text-muted-foreground text-xs">PAS脚本 → 分镜表 → AIGC分镜图 → Banner创意</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value={projectId || ''} onChange={(e) => setProjectId(Number(e.target.value))}>
              <option value="">选择项目</option>
              {projects.map((p: unknown) => <option key={p.id} value={p.id}>{p.projectName}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => scriptsQuery.refetch()} disabled={scriptsQuery.isFetching}>
              <RefreshCw className={`w-3 h-3 mr-1 ${scriptsQuery.isFetching ? 'animate-spin' : ''}`} />刷新
            </Button>
            <Button size="sm" onClick={() => projectId && runM6.mutate({ projectId })}
              disabled={!projectId || runM6.isPending} className="bg-red-600 hover:bg-red-700">
              {runM6.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
              运行M6
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="scripts">视频脚本</TabsTrigger>
            <TabsTrigger value="banners">Banner创意</TabsTrigger>
          </TabsList>

          <TabsContent value="scripts" className="space-y-4">
            {scriptsData.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center text-muted-foreground">
                  <Film className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p className="text-base font-medium">暂无视频脚本</p>
                  <p className="text-sm mt-2">请先运行M6视频素材引擎</p>
                  <Button size="sm" className="mt-4" onClick={() => projectId && runM6.mutate({ projectId })}
                    disabled={!projectId || runM6.isPending}>
                    <Play className="w-3 h-3 mr-1" />运行M6引擎
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {scriptsData.map((script: unknown) => (
                  <Card key={script.id} className="hover:border-red-500/20 transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{script.scriptName || `脚本 #${script.id}`}</CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{script.scriptType || 'PAS'}</Badge>
                          <Badge variant="secondary" className="text-xs">{script.duration || '15s'}</Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm whitespace-pre-wrap text-muted-foreground">{script.content || script.scriptContent || '-'}</p>
                      {script.storyboardFrames && (
                        <div className="mt-4 pt-3 border-t">
                          <p className="text-xs font-medium mb-2">分镜表 ({(script.storyboardFrames as unknown[])?.length || 0} 帧)</p>
                          <div className="grid grid-cols-4 gap-2">
                            {((script.storyboardFrames as unknown[]) || []).slice(0, 8).map((frame: unknown, i: number) => (
                              <div key={i} className="aspect-video bg-muted/20 rounded border border-border/30 flex items-center justify-center">
                                {frame.imageUrl ? (
                                  <img src={frame.imageUrl} alt={`Frame ${i + 1}`} className="w-full h-full object-cover rounded" />
                                ) : (
                                  <span className="text-xs text-muted-foreground">F{i + 1}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="banners" className="space-y-4">
            {bannersData.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">暂无Banner创意</p>
                  <p className="text-xs mt-1">运行M6引擎后将自动生成Banner创意</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {bannersData.map((banner: unknown) => (
                  <Card key={banner.id} className="overflow-hidden hover:border-red-500/30 transition-colors">
                    {banner.imageUrl ? (
                      <div className="aspect-[16/9] bg-muted/30 overflow-hidden">
                        <img src={banner.imageUrl} alt={banner.bannerName} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="aspect-[16/9] bg-muted/10 flex items-center justify-center">
                        <ImageIcon className="w-8 h-8 text-muted-foreground/30" />
                      </div>
                    )}
                    <CardContent className="p-3">
                      <p className="text-sm font-medium">{banner.bannerName || `Banner #${banner.id}`}</p>
                      <p className="text-xs text-muted-foreground mt-1">{banner.dimensions || ''} {banner.format || ''}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
