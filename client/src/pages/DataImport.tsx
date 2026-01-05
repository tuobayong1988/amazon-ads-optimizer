import { useState, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Upload, 
  FileSpreadsheet, 
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Download,
  Info
} from "lucide-react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";

export default function DataImport() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [reportType, setReportType] = useState("search_term");
  const [marketplace, setMarketplace] = useState("US");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Fetch import history
  const { data: importJobs, refetch: refetchJobs } = trpc.import.list.useQuery();

  // Create import job mutation
  const createImportJob = trpc.import.create.useMutation({
    onSuccess: () => {
      toast.success("导入任务已创建");
      setSelectedFile(null);
      setUploadProgress(0);
      refetchJobs();
    },
    onError: (error) => {
      toast.error("导入失败: " + error.message);
    },
  });

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const validTypes = [
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ];
      if (!validTypes.includes(file.type) && !file.name.endsWith('.csv') && !file.name.endsWith('.xlsx')) {
        toast.error("请上传CSV或Excel文件");
        return;
      }
      setSelectedFile(file);
    }
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadProgress(0);

    // Simulate upload progress
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return prev + 10;
      });
    }, 200);

    try {
      // In a real implementation, you would upload the file to S3 first
      // For now, we'll just create the import job
      const fileType = selectedFile.name.endsWith('.csv') ? 'csv' : 'excel';
      
      await createImportJob.mutateAsync({
        fileName: selectedFile.name,
        fileType: fileType as 'csv' | 'excel',
        reportType,
      });

      setUploadProgress(100);
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      clearInterval(progressInterval);
      setIsUploading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-5 h-5 text-success" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-destructive" />;
      case 'processing':
        return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
      default:
        return <Clock className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: '等待处理',
      processing: '处理中',
      completed: '已完成',
      failed: '失败',
    };
    return labels[status] || status;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">数据导入</h1>
          <p className="text-muted-foreground">
            导入亚马逊广告报告数据，支持CSV和Excel格式
          </p>
        </div>

        <Tabs defaultValue="upload" className="space-y-6">
          <TabsList>
            <TabsTrigger value="upload">
              <Upload className="w-4 h-4 mr-2" />
              上传文件
            </TabsTrigger>
            <TabsTrigger value="history">
              <FileText className="w-4 h-4 mr-2" />
              导入历史
            </TabsTrigger>
          </TabsList>

          {/* Upload Tab */}
          <TabsContent value="upload">
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Upload Area */}
              <Card>
                <CardHeader>
                  <CardTitle>上传广告报告</CardTitle>
                  <CardDescription>
                    从亚马逊广告后台下载报告并上传
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* File Drop Zone */}
                  <div 
                    className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                      selectedFile ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <input
                      type="file"
                      id="file-upload"
                      className="hidden"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleFileSelect}
                    />
                    <label htmlFor="file-upload" className="cursor-pointer">
                      {selectedFile ? (
                        <div className="space-y-2">
                          <FileSpreadsheet className="w-12 h-12 mx-auto text-primary" />
                          <p className="font-medium">{selectedFile.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                          <Button variant="outline" size="sm" onClick={(e) => {
                            e.preventDefault();
                            setSelectedFile(null);
                          }}>
                            更换文件
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Upload className="w-12 h-12 mx-auto text-muted-foreground" />
                          <p className="font-medium">点击或拖拽文件到此处</p>
                          <p className="text-sm text-muted-foreground">
                            支持 CSV、Excel (.xlsx, .xls) 格式
                          </p>
                        </div>
                      )}
                    </label>
                  </div>

                  {/* Report Type Selection */}
                  <div className="space-y-2">
                    <Label>报告类型</Label>
                    <Select value={reportType} onValueChange={setReportType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="search_term">搜索词报告</SelectItem>
                        <SelectItem value="targeting">定位报告</SelectItem>
                        <SelectItem value="campaign">广告活动报告</SelectItem>
                        <SelectItem value="placement">展示位置报告</SelectItem>
                        <SelectItem value="bulk">批量操作表格</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Marketplace Selection */}
                  <div className="space-y-2">
                    <Label>市场</Label>
                    <Select value={marketplace} onValueChange={setMarketplace}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="US">美国 (US)</SelectItem>
                        <SelectItem value="CA">加拿大 (CA)</SelectItem>
                        <SelectItem value="UK">英国 (UK)</SelectItem>
                        <SelectItem value="DE">德国 (DE)</SelectItem>
                        <SelectItem value="FR">法国 (FR)</SelectItem>
                        <SelectItem value="IT">意大利 (IT)</SelectItem>
                        <SelectItem value="ES">西班牙 (ES)</SelectItem>
                        <SelectItem value="JP">日本 (JP)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Upload Progress */}
                  {isUploading && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>上传中...</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <Progress value={uploadProgress} />
                    </div>
                  )}

                  {/* Upload Button */}
                  <Button 
                    className="w-full" 
                    onClick={handleUpload}
                    disabled={!selectedFile || isUploading}
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        上传中...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        开始导入
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Instructions */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Info className="w-5 h-5" />
                    导入说明
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">支持的报告类型</h4>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
                          <span><strong>搜索词报告</strong> - 包含关键词、搜索词、点击、转化等数据</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
                          <span><strong>定位报告</strong> - 包含ASIN定位、商品定位的表现数据</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
                          <span><strong>广告活动报告</strong> - 广告活动级别的汇总数据</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
                          <span><strong>展示位置报告</strong> - 不同广告位的表现数据</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
                          <span><strong>批量操作表格</strong> - 亚马逊批量操作导出的完整数据</span>
                        </li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-medium mb-2">如何下载报告</h4>
                      <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                        <li>登录亚马逊广告后台</li>
                        <li>进入"报告"或"批量操作"页面</li>
                        <li>选择所需的报告类型和时间范围</li>
                        <li>下载CSV或Excel格式的报告</li>
                        <li>在此页面上传下载的文件</li>
                      </ol>
                    </div>

                    <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                      <h4 className="font-medium mb-2 text-primary">提示</h4>
                      <p className="text-sm text-muted-foreground">
                        建议定期导入最新数据以获得更准确的优化建议。系统会自动识别并合并重复数据。
                      </p>
                    </div>
                  </div>

                  {/* Download Template */}
                  <div className="pt-4 border-t">
                    <Button variant="outline" className="w-full" onClick={() => toast.info("模板下载功能开发中")}>
                      <Download className="w-4 h-4 mr-2" />
                      下载数据模板
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>导入历史</CardTitle>
                <CardDescription>
                  查看所有数据导入记录
                </CardDescription>
              </CardHeader>
              <CardContent>
                {importJobs && importJobs.length > 0 ? (
                  <div className="space-y-4">
                    {importJobs.map((job) => (
                      <div 
                        key={job.id} 
                        className="flex items-center justify-between p-4 rounded-lg border bg-card"
                      >
                        <div className="flex items-center gap-4">
                          {getStatusIcon(job.status || 'pending')}
                          <div>
                            <p className="font-medium">{job.fileName}</p>
                            <p className="text-sm text-muted-foreground">
                              {format(new Date(job.createdAt), "yyyy-MM-dd HH:mm", { locale: zhCN })}
                              {job.reportType && ` · ${job.reportType}`}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`status-${job.status}`}>
                            {getStatusLabel(job.status || 'pending')}
                          </span>
                          {job.processedRows !== null && job.totalRows !== null && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {job.processedRows} / {job.totalRows} 行
                            </p>
                          )}
                          {job.errorMessage && (
                            <p className="text-sm text-destructive mt-1">
                              {job.errorMessage}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-16">
                    <FileText className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">暂无导入记录</h3>
                    <p className="text-muted-foreground">
                      上传广告报告后，导入记录将显示在这里
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
