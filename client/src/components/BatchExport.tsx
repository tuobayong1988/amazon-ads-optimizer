/**
 * 批量导出组件
 * 支持批量导出多个优化目标的数据
 */
import { useState } from 'react';
import { safeToISODateString } from '@/lib/safeDate';
// xlsx 和 jszip 使用动态导入以减少初始 bundle 大小
// import * as XLSX from 'xlsx';
// import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Download, Loader2 } from 'lucide-react';

interface PerformanceGroup {
  id: number;
  name: string;
  optimizationGoal?: string;
}

interface BatchExportProps {
  groups: PerformanceGroup[];
  onExport: (groupIds: number[], format: 'csv' | 'excel', timeRange: string) => Promise<any[]>;
}

export function BatchExport({ groups, onExport }: BatchExportProps) {
  const [open, setOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [format, setFormat] = useState<'csv' | 'excel'>('excel');
  const [timeRange, setTimeRange] = useState('30d');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleSelectAll = () => {
    if (selectedGroups.length === groups.length) {
      setSelectedGroups([]);
    } else {
      setSelectedGroups(groups.map(g => g.id));
    }
  };

  const handleToggleGroup = (groupId: number) => {
    setSelectedGroups(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );
  };

  const handleExport = async () => {
    if (selectedGroups.length === 0) {
      toast.error('请选择要导出的优化目标');
      return;
    }

    setExporting(true);
    setProgress(0);

    try {
      if (format === 'excel') {
        // Excel格式:创建多工作表文件
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        
        for (let i = 0; i < selectedGroups.length; i++) {
          const groupId = selectedGroups[i];
          const group = groups.find(g => g.id === groupId);
          
          // 获取数据
          const data = await onExport([groupId], format, timeRange);
          
          // 创建工作表
          const ws = XLSX.utils.json_to_sheet(data.map(d => ({
            '日期': d.date,
            '花费($)': d.spend,
            '销售额($)': d.sales,
            'ACoS(%)': d.acos,
            '转化数': d.orders || 0,
            '点击数': d.clicks || 0,
            '展示数': d.impressions || 0
          })));
          
          // 添加到工作簿
          const sheetName = group?.name.substring(0, 31) || `目标${groupId}`;
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
          
          setProgress(((i + 1) / selectedGroups.length) * 100);
        }
        
        // 下载文件
        XLSX.writeFile(wb, `批量导出_${timeRange}_${safeToISODateString(new Date())}.xlsx`);
        toast.success(`成功导出 ${selectedGroups.length} 个优化目标`);
        
      } else {
        // CSV格式:创建ZIP压缩包
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        
        for (let i = 0; i < selectedGroups.length; i++) {
          const groupId = selectedGroups[i];
          const group = groups.find(g => g.id === groupId);
          
          // 获取数据
          const data = await onExport([groupId], format, timeRange);
          
          // 生成CSV内容
          const csvContent = [
            ['日期', '花费($)', '销售额($)', 'ACoS(%)', '转化数', '点击数', '展示数'],
            ...data.map(d => [
              d.date,
              d.spend,
              d.sales,
              d.acos,
              d.orders || 0,
              d.clicks || 0,
              d.impressions || 0
            ])
          ].map(row => row.join(',')).join('\n');
          
          // 添加到ZIP
          const fileName = `${group?.name || `目标${groupId}`}_${timeRange}.csv`;
          zip.file(fileName, `\ufeff${csvContent}`); // BOM for UTF-8
          
          setProgress(((i + 1) / selectedGroups.length) * 100);
        }
        
        // 生成并下载ZIP
        const blob = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `批量导出_${timeRange}_${safeToISODateString(new Date())}.zip`;
        link.click();
        toast.success(`成功导出 ${selectedGroups.length} 个优化目标`);
      }
      
      setOpen(false);
      setSelectedGroups([]);
      
    } catch (error: any) {
      console.error('批量导出失败:', error);
      toast.error(`导出失败: ${error.message}`);
    } finally {
      setExporting(false);
      setProgress(0);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline" size="sm">
        <Download className="w-4 h-4 mr-2" />
        批量导出
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>批量导出数据</DialogTitle>
            <DialogDescription>
              选择要导出的优化目标和导出格式
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* 选择优化目标 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>选择优化目标 ({selectedGroups.length}/{groups.length})</Label>
                <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                  {selectedGroups.length === groups.length ? '取消全选' : '全选'}
                </Button>
              </div>
              
              <div className="border rounded-md p-4 max-h-60 overflow-y-auto space-y-2">
                {groups.map(group => (
                  <div key={group.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`group-${group.id}`}
                      checked={selectedGroups.includes(group.id)}
                      onCheckedChange={() => handleToggleGroup(group.id)}
                    />
                    <Label
                      htmlFor={`group-${group.id}`}
                      className="flex-1 cursor-pointer"
                    >
                      {group.name}
                      {group.optimizationGoal && (
                        <span className="text-xs text-muted-foreground ml-2">
                          ({group.optimizationGoal})
                        </span>
                      )}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* 导出格式 */}
            <div className="space-y-2">
              <Label>导出格式</Label>
              <Select value={format} onValueChange={(v: any) => setFormat(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="excel">Excel (多工作表)</SelectItem>
                  <SelectItem value="csv">CSV (ZIP压缩包)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 时间范围 */}
            <div className="space-y-2">
              <Label>时间范围</Label>
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">最近7天</SelectItem>
                  <SelectItem value="30d">最近30天</SelectItem>
                  <SelectItem value="90d">最近90天</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 导出进度 */}
            {exporting && (
              <div className="space-y-2">
                <Label>导出进度</Label>
                <Progress value={progress} className="w-full" />
                <p className="text-sm text-muted-foreground text-center">
                  {Math.round(progress)}% 完成
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={exporting}>
              取消
            </Button>
            <Button onClick={handleExport} disabled={exporting || selectedGroups.length === 0}>
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  导出中...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  开始导出
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
