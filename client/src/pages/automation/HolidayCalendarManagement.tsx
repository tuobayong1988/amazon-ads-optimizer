import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../lib/trpc';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar, Plus, Trash2, Edit2, RefreshCw, Gift, Zap, TrendingUp, AlertCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO, differenceInDays } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const MARKETPLACE_OPTIONS = [
  { value: 'US', label: '🇺🇸 美国', flag: '🇺🇸' },
  { value: 'CA', label: '🇨🇦 加拿大', flag: '🇨🇦' },
  { value: 'MX', label: '🇲🇽 墨西哥', flag: '🇲🇽' },
  { value: 'BR', label: '🇧🇷 巴西', flag: '🇧🇷' },
  { value: 'UK', label: '🇬🇧 英国', flag: '🇬🇧' },
  { value: 'DE', label: '🇩🇪 德国', flag: '🇩🇪' },
  { value: 'FR', label: '🇫🇷 法国', flag: '🇫🇷' },
  { value: 'IT', label: '🇮🇹 意大利', flag: '🇮🇹' },
  { value: 'ES', label: '🇪🇸 西班牙', flag: '🇪🇸' },
  { value: 'JP', label: '🇯🇵 日本', flag: '🇯🇵' },
  { value: 'AU', label: '🇦🇺 澳大利亚', flag: '🇦🇺' },
  { value: 'SG', label: '🇸🇬 新加坡', flag: '🇸🇬' },
];

const PRIORITY_OPTIONS = [
  { value: 'high', label: '高优先级', color: 'bg-red-500' },
  { value: 'medium', label: '中优先级', color: 'bg-yellow-500' },
  { value: 'low', label: '低优先级', color: 'bg-green-500' },
];

interface HolidayFormData {
  name: string;
  startDate: string;
  endDate: string;
  bidMultiplier: string;
  budgetMultiplier: string;
  priority: 'high' | 'medium' | 'low';
  preHolidayDays: number;
}

export default function HolidayCalendarManagement() {
  const queryClient = useQueryClient();
  const [selectedMarketplace, setSelectedMarketplace] = useState('US');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<unknown>(null);
  const [formData, setFormData] = useState<HolidayFormData>({
    name: '',
    startDate: '',
    endDate: '',
    bidMultiplier: '1.3',
    budgetMultiplier: '1.5',
    priority: 'medium',
    preHolidayDays: 7
  });

  // 获取节假日配置列表
  const { data: holidays, isLoading } = trpc.holidayConfig.list.useQuery({
    marketplace: selectedMarketplace
  });

  // 获取即将到来的节假日
  const { data: upcomingHolidays } = trpc.holidayConfig.getUpcoming.useQuery({
    marketplace: selectedMarketplace,
    days: 60
  });

  // 获取支持的站点列表
  // @ts-ignore
  const { data: marketplaces } = trpc.holidayConfig.getMarketplaces.useQuery() as unknown;

  // 初始化系统默认节假日
  const initializeMutation = trpc.holidayConfig.initializeDefaults.useMutation({
    onSuccess: (count) => {
      toast.success(`成功初始化 ${count} 个系统默认节假日`);
      queryClient.invalidateQueries({ queryKey: ['holidayConfig'] });
    },
    onError: (error) => {
      toast.error(`初始化失败: ${error.message}`);
    }
  });

  // 创建节假日配置
  const createMutation = trpc.holidayConfig.create.useMutation({
    onSuccess: () => {
      toast.success('节假日配置创建成功');
      setIsAddDialogOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['holidayConfig'] });
    },
    onError: (error) => {
      toast.error(`创建失败: ${error.message}`);
    }
  });

  // 更新节假日配置
  const updateMutation = trpc.holidayConfig.update.useMutation({
    onSuccess: () => {
      toast.success('节假日配置更新成功');
      setEditingHoliday(null);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['holidayConfig'] });
    },
    onError: (error) => {
      toast.error(`更新失败: ${error.message}`);
    }
  });

  // 删除节假日配置
  const deleteMutation = trpc.holidayConfig.delete.useMutation({
    onSuccess: () => {
      toast.success('节假日配置已删除');
      queryClient.invalidateQueries({ queryKey: ['holidayConfig'] });
    },
    onError: (error) => {
      toast.error(`删除失败: ${error.message}`);
    }
  });

  // 切换启用状态
  const toggleMutation = trpc.holidayConfig.toggle.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidayConfig'] });
    },
    onError: (error) => {
      toast.error(`状态切换失败: ${error.message}`);
    }
  });

  const resetForm = () => {
    setFormData({
      name: '',
      startDate: '',
      endDate: '',
      bidMultiplier: '1.3',
      budgetMultiplier: '1.5',
      priority: 'medium',
      preHolidayDays: 7
    });
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.startDate || !formData.endDate) {
      toast.error('请填写完整的节假日信息');
      return;
    }

    if (editingHoliday) {
      // @ts-ignore
      updateMutation.mutate({
        // @ts-ignore
        id: editingHoliday.id,
        ...formData
      });
    } else {
      createMutation.mutate({
        marketplace: selectedMarketplace,
        ...formData
      });
    }
  };

  const handleEdit = (holiday: unknown) => {
    // @ts-ignore
    setEditingHoliday(holiday);
    // @ts-ignore
    setFormData({
      // @ts-ignore
      name: holiday.name,
      // @ts-ignore
      startDate: holiday.startDate,
      // @ts-ignore
      endDate: holiday.endDate,
      // @ts-ignore
      bidMultiplier: holiday.bidMultiplier,
      // @ts-ignore
      budgetMultiplier: holiday.budgetMultiplier,
      // @ts-ignore
      priority: holiday.priority,
      // @ts-ignore
      preHolidayDays: holiday.preHolidayDays || 7
    });
    setIsAddDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm('确定要删除这个节假日配置吗？')) {
      deleteMutation.mutate({ id });
    }
  };

  const handleToggle = (id: number, currentState: number) => {
    toggleMutation.mutate({ id, isActive: currentState !== 1 });
  };

  const getPriorityBadge = (priority: string) => {
    const option = PRIORITY_OPTIONS.find(p => p.value === priority);
    return (
      <Badge className={`${option?.color || 'bg-gray-500'} text-white`}>
        {option?.label || priority}
      </Badge>
    );
  };

  const getDaysUntil = (dateStr: string) => {
    const date = parseISO(dateStr);
    const today = new Date();
    return differenceInDays(date, today);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Calendar className="h-6 w-6 text-blue-400" />
              节假日日历管理
            </h1>
            <p className="text-gray-400 mt-1">
              配置节假日和促销日的竞价/预算调整策略，支持不同站点的本地化配置
            </p>
          </div>
          <div className="flex gap-3">
            <Select value={selectedMarketplace} onValueChange={setSelectedMarketplace}>
              <SelectTrigger className="w-[180px] bg-gray-800 border-gray-700">
                <SelectValue placeholder="选择站点" />
              </SelectTrigger>
              <SelectContent>
                {MARKETPLACE_OPTIONS.map(mp => (
                  <SelectItem key={mp.value} value={mp.value}>
                    {mp.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => initializeMutation.mutate({ marketplace: selectedMarketplace })}
              disabled={initializeMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${initializeMutation.isPending ? 'animate-spin' : ''}`} />
              初始化默认节假日
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
              setIsAddDialogOpen(open);
              if (!open) {
                setEditingHoliday(null);
                resetForm();
              }
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  添加节假日
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>{editingHoliday ? '编辑节假日' : '添加节假日'}</DialogTitle>
                  <DialogDescription>
                    配置节假日期间的竞价和预算调整策略
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">节假日名称</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="例如：Prime Day"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="startDate">开始日期</Label>
                      <Input
                        id="startDate"
                        type="date"
                        value={formData.startDate}
                        onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="endDate">结束日期</Label>
                      <Input
                        id="endDate"
                        type="date"
                        value={formData.endDate}
                        onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="bidMultiplier">竞价乘数</Label>
                      <Input
                        id="bidMultiplier"
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="3"
                        value={formData.bidMultiplier}
                        onChange={(e) => setFormData({ ...formData, bidMultiplier: e.target.value })}
                      />
                      <p className="text-xs text-gray-400">1.0 = 不调整，1.3 = 提高30%</p>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="budgetMultiplier">预算乘数</Label>
                      <Input
                        id="budgetMultiplier"
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="5"
                        value={formData.budgetMultiplier}
                        onChange={(e) => setFormData({ ...formData, budgetMultiplier: e.target.value })}
                      />
                      <p className="text-xs text-gray-400">1.0 = 不调整，1.5 = 提高50%</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="priority">优先级</Label>
                      <Select
                        value={formData.priority}
                        onValueChange={(value: 'high' | 'medium' | 'low') => setFormData({ ...formData, priority: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRIORITY_OPTIONS.map(p => (
                            <SelectItem key={p.value} value={p.value}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="preHolidayDays">预热天数</Label>
                      <Input
                        id="preHolidayDays"
                        type="number"
                        min="0"
                        max="30"
                        value={formData.preHolidayDays}
                        onChange={(e) => setFormData({ ...formData, preHolidayDays: parseInt(e.target.value) || 0 })}
                      />
                      <p className="text-xs text-gray-400">节假日前开始预热的天数</p>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    取消
                  </Button>
                  <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                    {editingHoliday ? '更新' : '创建'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* 即将到来的节假日提醒 */}
        {upcomingHolidays && upcomingHolidays.length > 0 && (
          <Card className="bg-gradient-to-r from-orange-900/50 to-yellow-900/30 border-orange-700/50">
            {/* @ts-ignore */}
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-white flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-orange-400" />
                // @ts-ignore
                即将到来的节假日
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* @ts-ignore */}
              <div className="flex flex-wrap gap-3">
                {upcomingHolidays.slice(0, 5).map((holiday: unknown) => {
                  // @ts-ignore
                  const daysUntil = getDaysUntil(holiday.startDate);
                  return (
                    // @ts-ignore
                    <div
                      // @ts-ignore
                      key={holiday.id}
                      className="flex items-center gap-2 bg-gray-800/50 rounded-lg px-3 py-2"
                    >
                      <Gift className="h-4 w-4 text-orange-400" />
                      {/* @ts-ignore */}
                      <span className="text-white font-medium">{holiday.name}</span>
                      <Badge variant="outline" className="text-orange-300 border-orange-500">
                        {daysUntil}天后
                      </Badge>
                      <span className="text-gray-400 text-sm">
                        // @ts-ignore
                        竞价×{(holiday as any).bidMultiplier} 预算×{(holiday as any).budgetMultiplier}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="all" className="space-y-4">
          <TabsList className="bg-gray-800">
            <TabsTrigger value="all">全部节假日</TabsTrigger>
            <TabsTrigger value="active">已启用</TabsTrigger>
            <TabsTrigger value="system">系统默认</TabsTrigger>
            <TabsTrigger value="custom">自定义</TabsTrigger>
          </TabsList>

          {/* @ts-ignore */}
          <TabsContent value="all">
            <HolidayTable
              holidays={holidays || []}
              isLoading={isLoading}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggle={handleToggle}
              getPriorityBadge={getPriorityBadge}
            />
          </TabsContent>

          {/* @ts-ignore */}
          <TabsContent value="active">
            <HolidayTable
              // @ts-ignore
              holidays={(holidays || []).filter((h: unknown) => h.isActive === 1)}
              isLoading={isLoading}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggle={handleToggle}
              getPriorityBadge={getPriorityBadge}
            />
          </TabsContent>

          <TabsContent value="system">
            <HolidayTable
              // @ts-ignore
              holidays={(holidays || []).filter((h: unknown) => h.isSystemDefault === 1)}
              isLoading={isLoading}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggle={handleToggle}
              getPriorityBadge={getPriorityBadge}
            />
          </TabsContent>

          <TabsContent value="custom">
            <HolidayTable
              // @ts-ignore
              holidays={(holidays || []).filter((h: unknown) => h.isSystemDefault !== 1)}
              isLoading={isLoading}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggle={handleToggle}
              getPriorityBadge={getPriorityBadge}
            />
          </TabsContent>
        </Tabs>

        {/* 使用说明 */}
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">使用说明</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-gray-300">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <Zap className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <h4 className="font-medium text-white">竞价乘数</h4>
                  <p className="text-sm text-gray-400">
                    节假日期间自动调整关键词竞价。例如1.3表示提高30%竞价以获取更多流量。
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <h4 className="font-medium text-white">预算乘数</h4>
                  <p className="text-sm text-gray-400">
                    节假日期间自动调整广告预算。例如1.5表示提高50%预算以支撑更多曝光。
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-2 bg-orange-500/20 rounded-lg">
                  <Clock className="h-5 w-5 text-orange-400" />
                </div>
                <div>
                  <h4 className="font-medium text-white">预热期</h4>
                  <p className="text-sm text-gray-400">
                    在节假日前的预热期内，系统会逐步提高竞价和预算，为大促做准备。
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

// 节假日表格组件
function HolidayTable({
  holidays,
  isLoading,
  onEdit,
  onDelete,
  onToggle,
  getPriorityBadge
}: {
  holidays: unknown[];
  isLoading: boolean;
  onEdit: (holiday: unknown) => void;
  onDelete: (id: number) => void;
  onToggle: (id: number, currentState: number) => void;
  getPriorityBadge: (priority: string) => React.ReactNode;
}) {
  if (isLoading) {
    return (
      <Card className="bg-gray-800/50 border-gray-700">
        <CardContent className="py-10 text-center text-gray-400">
          加载中...
        </CardContent>
      </Card>
    );
  }

  if (holidays.length === 0) {
    return (
      <Card className="bg-gray-800/50 border-gray-700">
        <CardContent className="py-10 text-center text-gray-400">
          暂无节假日配置，点击"初始化默认节假日"或"添加节假日"开始配置
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          {/* @ts-ignore */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                {/* @ts-ignore */}
                <th className="text-left py-3 px-4 text-gray-400 font-medium">状态</th>
                {/* @ts-ignore */}
                <th className="text-left py-3 px-4 text-gray-400 font-medium">节假日名称</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">日期范围</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium">优先级</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium">竞价乘数</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium">预算乘数</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium">预热天数</th>
                {/* @ts-ignore */}
                <th className="text-center py-3 px-4 text-gray-400 font-medium">类型</th>
                <th className="text-right py-3 px-4 text-gray-400 font-medium">操作</th>
              </tr>
            </thead>
            {/* @ts-ignore */}
            <tbody>
              {holidays.map((holiday: unknown) => (
                // @ts-ignore
                <tr key={holiday.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="py-3 px-4">
                    <Switch
                      // @ts-ignore
                      checked={holiday.isActive === 1}
                      // @ts-ignore
                      onCheckedChange={() => onToggle(holiday.id, holiday.isActive)}
                    />
                  </td>
                  {/* @ts-ignore */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Gift className="h-4 w-4 text-orange-400" />
                      {/* @ts-ignore */}
                      {/* @ts-ignore */}
                      <span className="text-white font-medium">{holiday.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-300">
                    {/* @ts-ignore */}
                    {holiday.startDate} ~ {holiday.endDate}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {/* @ts-ignore */}
                    {getPriorityBadge(holiday.priority)}
                  </td>
                  <td className="py-3 px-4 text-center text-blue-400">
                    // @ts-ignore
                    ×{(holiday as any).bidMultiplier}
                  </td>
                  <td className="py-3 px-4 text-center text-green-400">
                    // @ts-ignore
                    ×{(holiday as any).budgetMultiplier}
                  </td>
                  <td className="py-3 px-4 text-center text-gray-300">
                    {/* @ts-ignore */}
                    {holiday.preHolidayDays || 0}天
                  </td>
                  <td className="py-3 px-4 text-center">
                    {/* @ts-ignore */}
                    {holiday.isSystemDefault === 1 ? (
                      <Badge variant="secondary">系统</Badge>
                    ) : (
                      <Badge variant="outline">自定义</Badge>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(holiday)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        // @ts-ignore
                        onClick={() => onDelete(holiday.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
