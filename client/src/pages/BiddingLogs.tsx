import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { 
  Search, 
  Filter, 
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  FileText,
  Download,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";

export default function BiddingLogs() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Fetch accounts
  const { data: accounts } = trpc.adAccount.list.useQuery();
  const accountId = selectedAccountId || accounts?.[0]?.id;

  // Fetch bidding logs
  const { data: logsData, isLoading } = trpc.biddingLog.list.useQuery(
    { accountId: accountId!, limit: pageSize, offset: page * pageSize },
    { enabled: !!accountId }
  );

  const logs = logsData?.logs || [];
  const totalLogs = logsData?.total || 0;
  const totalPages = Math.ceil(totalLogs / pageSize);

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    const matchesSearch = 
      log.targetName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.reason?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAction = actionFilter === "all" || log.actionType === actionFilter;
    return matchesSearch && matchesAction;
  });

  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case "increase":
        return <TrendingUp className="w-4 h-4 text-success" />;
      case "decrease":
        return <TrendingDown className="w-4 h-4 text-destructive" />;
      default:
        return <Minus className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getActionLabel = (actionType: string) => {
    switch (actionType) {
      case "increase":
        return "增加";
      case "decrease":
        return "降低";
      default:
        return "设置";
    }
  };

  const getMatchTypeLabel = (matchType: string | null) => {
    if (!matchType) return null;
    const labels: Record<string, string> = {
      broad: "广泛",
      phrase: "词组",
      exact: "精确",
    };
    return labels[matchType] || matchType;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">竞价日志</h1>
            <p className="text-muted-foreground">
              查看所有出价调整记录，了解优化决策依据
            </p>
          </div>
          <Button variant="outline" onClick={() => {
            // Export functionality placeholder
            const csvContent = logs.map(log => 
              `${log.createdAt},${log.targetName},${log.actionType},${log.previousBid},${log.newBid},${log.reason}`
            ).join('\n');
            const blob = new Blob([`时间,目标,操作,原出价,新出价,原因\n${csvContent}`], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'bidding_logs.csv';
            a.click();
          }}>
            <Download className="w-4 h-4 mr-2" />
            导出日志
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索关键词或原因..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="操作类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部操作</SelectItem>
                  <SelectItem value="increase">出价增加</SelectItem>
                  <SelectItem value="decrease">出价降低</SelectItem>
                  <SelectItem value="set">出价设置</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card>
          <CardHeader>
            <CardTitle>出价调整记录</CardTitle>
            <CardDescription>
              共 {totalLogs.toLocaleString()} 条记录
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredLogs.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[180px]">时间</TableHead>
                        <TableHead className="min-w-[250px]">优化对象</TableHead>
                        <TableHead>匹配类型</TableHead>
                        <TableHead>操作</TableHead>
                        <TableHead className="text-right">原出价</TableHead>
                        <TableHead className="text-right">新出价</TableHead>
                        <TableHead className="text-right">变化</TableHead>
                        <TableHead className="min-w-[300px]">调整原因</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(log.createdAt), "yyyy-MM-dd HH:mm", { locale: zhCN })}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                log.targetType === 'keyword' ? 'bg-primary/10 text-primary' : 'bg-chart-4/10 text-chart-4'
                              }`}>
                                {log.targetType === 'keyword' ? '关键词' : 'ASIN'}
                              </span>
                              <span className="truncate max-w-[200px]" title={log.targetName || ''}>
                                {log.targetName || '-'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {log.matchType ? (
                              <span className={`match-${log.matchType}`}>
                                {getMatchTypeLabel(log.matchType)}
                              </span>
                            ) : '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {getActionIcon(log.actionType)}
                              <span>{getActionLabel(log.actionType)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            ${parseFloat(log.previousBid).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            ${parseFloat(log.newBid).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={log.actionType === 'increase' ? 'bid-increase' : log.actionType === 'decrease' ? 'bid-decrease' : ''}>
                              {log.bidChangePercent ? `${parseFloat(log.bidChangePercent) > 0 ? '+' : ''}${log.bidChangePercent}%` : '-'}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            <div className="max-w-[300px] truncate" title={log.reason || ''}>
                              {log.reason || '-'}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    显示 {page * pageSize + 1} - {Math.min((page + 1) * pageSize, totalLogs)} 条，共 {totalLogs} 条
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                    >
                      <ChevronLeft className="w-4 h-4" />
                      上一页
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {page + 1} / {totalPages || 1}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                    >
                      下一页
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-16">
                <FileText className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">暂无竞价日志</h3>
                <p className="text-muted-foreground">
                  运行优化后，所有出价调整记录将显示在这里
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
