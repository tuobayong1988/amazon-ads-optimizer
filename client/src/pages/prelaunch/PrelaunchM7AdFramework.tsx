/**
 * M7 广告框架引擎 — 详情页
 * 广告框架预览、JSON编译结果、一键部署
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Megaphone, ArrowLeft, RefreshCw, Loader2, Play, Rocket,
  Code, Eye, CheckCircle2, XCircle, Clock, FileJson
} from "lucide-react";
import { useLocation } from "wouter";

export default function PrelaunchM7AdFramework() {
  const [, setLocation] = useLocation();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("frameworks");
  const [selectedFramework, setSelectedFramework] = useState<number | null>(null);

  const projectsQuery = trpc.prelaunch.listProjects.useQuery() as unknown;
  const projects = (() => { const d = projectsQuery.data; return (d && 'data' in (d as unknown) ? (d as Record<string, unknown>).data : d) || []; })();
  if (!projectId && projects.length > 0) setProjectId(projects[0].id);

  const frameworksQuery = trpc.prelaunch.getAdFrameworks.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const previewQuery = trpc.prelaunch.previewAdPayload.useQuery(
    { frameworkId: selectedFramework! },
    { enabled: !!selectedFramework && activeTab === 'preview' }
  );

  const deployLogsQuery = trpc.prelaunch.getDeployLogs.useQuery(
    { frameworkId: selectedFramework! },
    { enabled: !!selectedFramework && activeTab === 'logs' }
  );

  const compileMutation = trpc.prelaunch.compileAdFramework.useMutation({
    onSuccess: () => { toast.success("广告框架编译完成"); frameworksQuery.refetch(); },
    onError: (err) => toast.error("编译失败: " + err.message),
  });

  const deployMutation = trpc.prelaunch.deployAdFramework.useMutation({
    onSuccess: () => { toast.success("部署请求已提交"); deployLogsQuery.refetch(); },
    onError: (err) => toast.error("部署失败: " + err.message),
  });

  const frameworksData = (frameworksQuery.data as unknown)?.data || [];
  const previewData = (previewQuery.data as unknown)?.data;
  const logsData = (deployLogsQuery.data as unknown)?.data || [];

  const statusIcons: Record<string, unknown> = {
    compiled: <CheckCircle2 className="w-3 h-3 text-green-400" />,
    draft: <Clock className="w-3 h-3 text-gray-400" />,
    deployed: <Rocket className="w-3 h-3 text-blue-400" />,
    failed: <XCircle className="w-3 h-3 text-red-400" />,
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
              <div className="p-2 rounded-lg bg-gradient-to-br from-indigo-500/20 to-indigo-600/20 border border-indigo-500/30">
                <Megaphone className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold">M7 广告框架引擎</h1>
                <p className="text-muted-foreground text-xs">SP/SB/SD框架 → JSON编译 → 预览 → 一键部署</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value={projectId || ''} onChange={(e) => setProjectId(Number(e.target.value))}>
              <option value="">选择项目</option>
              {projects.map((p: unknown) => <option key={p.id} value={p.id}>{p.projectName}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => frameworksQuery.refetch()} disabled={frameworksQuery.isFetching}>
              <RefreshCw className={`w-3 h-3 mr-1 ${frameworksQuery.isFetching ? 'animate-spin' : ''}`} />刷新
            </Button>
          </div>
        </div>

        {frameworksData.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Megaphone className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-base font-medium">暂无广告框架</p>
              <p className="text-sm mt-2">请先完成M1-M6流水线，系统将自动生成广告投放框架</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 左侧：框架列表 */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">广告框架列表</h3>
              {frameworksData.map((fw: unknown) => (
                <Card
                  key={fw.id}
                  className={`cursor-pointer transition-colors ${selectedFramework === fw.id ? 'border-indigo-500/50 bg-indigo-500/5' : 'hover:border-indigo-500/20'}`}
                  onClick={() => setSelectedFramework(fw.id)}
                >
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {statusIcons[fw.status] || statusIcons.draft}
                        <span className="text-sm font-medium">{fw.frameworkName || fw.frameworkType || `框架 #${fw.id}`}</span>
                      </div>
                      <Badge variant="outline" className="text-xs">{fw.frameworkType || 'SP'}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">{fw.description || ''}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* 右侧：详情 */}
            <div className="lg:col-span-2">
              {!selectedFramework ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <Eye className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">请选择左侧的广告框架查看详情</p>
                  </CardContent>
                </Card>
              ) : (
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <div className="flex items-center justify-between mb-4">
                    <TabsList>
                      <TabsTrigger value="frameworks">概览</TabsTrigger>
                      <TabsTrigger value="preview">JSON预览</TabsTrigger>
                      <TabsTrigger value="logs">部署日志</TabsTrigger>
                    </TabsList>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm"
                        onClick={() => compileMutation.mutate({ projectId: projectId!, frameworkTypes: ['SP_KW_MANUAL'] })}
                        disabled={compileMutation.isPending}>
                        {compileMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Code className="w-3 h-3 mr-1" />}
                        编译
                      </Button>
                      <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700"
                        onClick={() => deployMutation.mutate({ frameworkId: selectedFramework, profileId: '', dryRun: true })}
                        disabled={deployMutation.isPending}>
                        {deployMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Rocket className="w-3 h-3 mr-1" />}
                        模拟部署
                      </Button>
                    </div>
                  </div>

                  <TabsContent value="frameworks">
                    <Card>
                      <CardContent className="py-6">
                        {(() => {
                          const fw = frameworksData.find((f: unknown) => f.id === selectedFramework);
                          if (!fw) return <p className="text-muted-foreground text-sm">未找到框架详情</p>;
                          return (
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div><p className="text-xs text-muted-foreground">框架类型</p><p className="text-sm font-medium">{fw.frameworkType || '-'}</p></div>
                                <div><p className="text-xs text-muted-foreground">状态</p><div className="flex items-center gap-1">{statusIcons[fw.status]}<span className="text-sm">{fw.status}</span></div></div>
                                <div><p className="text-xs text-muted-foreground">匹配类型</p><p className="text-sm">{fw.matchType || '-'}</p></div>
                                <div><p className="text-xs text-muted-foreground">出价策略</p><p className="text-sm">{fw.biddingStrategy || '-'}</p></div>
                              </div>
                              {fw.compiledPayload && (
                                <div className="pt-4 border-t">
                                  <p className="text-xs text-muted-foreground mb-2">编译结果摘要</p>
                                  <pre className="text-xs bg-muted/20 p-3 rounded overflow-auto max-h-40">
                                    {typeof fw.compiledPayload === 'string' ? fw.compiledPayload : JSON.stringify(fw.compiledPayload, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="preview">
                    <Card>
                      <CardContent className="py-4">
                        {previewQuery.isLoading ? (
                          <div className="text-center py-8"><Loader2 className="w-6 h-6 mx-auto animate-spin text-muted-foreground" /></div>
                        ) : previewData ? (
                          <pre className="text-xs bg-muted/20 p-4 rounded overflow-auto max-h-[500px]">
                            {typeof previewData === 'string' ? previewData : JSON.stringify(previewData, null, 2)}
                          </pre>
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            <FileJson className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">请先编译框架后查看JSON预览</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="logs">
                    <Card>
                      <CardContent className="p-0">
                        {logsData.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            <Rocket className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">暂无部署日志</p>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b bg-muted/30">
                                  <th className="text-left px-4 py-3 font-medium text-xs">时间</th>
                                  <th className="text-center px-3 py-3 font-medium text-xs">状态</th>
                                  <th className="text-left px-3 py-3 font-medium text-xs">消息</th>
                                </tr>
                              </thead>
                              <tbody>
                                {logsData.map((log: unknown, i: number) => (
                                  <tr key={i} className="border-b border-border/30">
                                    <td className="px-4 py-2.5 text-xs">{log.createdAt || log.timestamp || '-'}</td>
                                    <td className="px-3 py-2.5 text-center">
                                      <Badge variant={log.status === 'success' ? 'default' : 'destructive'} className="text-xs">
                                        {log.status}
                                      </Badge>
                                    </td>
                                    <td className="px-3 py-2.5 text-xs">{log.message || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
