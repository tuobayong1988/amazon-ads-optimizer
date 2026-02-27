/**
 * CampaignManagementPanel.tsx - v272 P3
 * 广告活动管理面板 - 从PerformanceGroupDetail中拆分
 * 
 * 包含:
 * 1. 广告活动列表展示
 * 2. 广告活动排序和筛选
 * 3. 广告活动添加/移除操作
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Search,
  Plus,
  Trash2,
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
} from 'lucide-react';

interface CampaignManagementProps {
  groupCampaigns: any[];
  onRemoveCampaign?: (campaignId: number) => void;
  onAddCampaigns?: () => void;
  isLoading?: boolean;
}

type SortField = 'campaignName' | 'spend' | 'sales' | 'acos' | 'roas' | 'clicks' | 'impressions';
type SortDirection = 'asc' | 'desc';

export default function CampaignManagementPanel({
  groupCampaigns = [],
  onRemoveCampaign,
  onAddCampaigns,
  isLoading = false,
}: CampaignManagementProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('spend');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // 排序处理
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // 筛选和排序
  const filteredCampaigns = useMemo(() => {
    let result = [...groupCampaigns];
    
    // 搜索筛选
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((c: any) => 
        (c.campaignName || '').toLowerCase().includes(term)
      );
    }

    // 排序
    result.sort((a: any, b: any) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case 'campaignName':
          aVal = (a.campaignName || '').toLowerCase();
          bVal = (b.campaignName || '').toLowerCase();
          break;
        default:
          aVal = Number(a[sortField] || 0);
          bVal = Number(b[sortField] || 0);
      }
      
      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : -1;
      }
      return aVal < bVal ? 1 : -1;
    });

    return result;
  }, [groupCampaigns, searchTerm, sortField, sortDirection]);

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return <ArrowUpDown className="h-3 w-3 text-primary" />;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">广告活动管理</CardTitle>
            <CardDescription>
              共 {groupCampaigns.length} 个广告活动
              {searchTerm && ` (筛选后 ${filteredCampaigns.length} 个)`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索广告活动..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-48"
              />
            </div>
            {onAddCampaigns && (
              <Button size="sm" onClick={onAddCampaigns}>
                <Plus className="h-4 w-4 mr-1" />
                添加
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('campaignName')}
                >
                  <div className="flex items-center gap-1">
                    广告活动 {getSortIcon('campaignName')}
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50 text-right"
                  onClick={() => handleSort('spend')}
                >
                  <div className="flex items-center justify-end gap-1">
                    花费 {getSortIcon('spend')}
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50 text-right"
                  onClick={() => handleSort('sales')}
                >
                  <div className="flex items-center justify-end gap-1">
                    销售 {getSortIcon('sales')}
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50 text-right"
                  onClick={() => handleSort('acos')}
                >
                  <div className="flex items-center justify-end gap-1">
                    ACoS {getSortIcon('acos')}
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-muted/50 text-right"
                  onClick={() => handleSort('clicks')}
                >
                  <div className="flex items-center justify-end gap-1">
                    点击 {getSortIcon('clicks')}
                  </div>
                </TableHead>
                {onRemoveCampaign && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCampaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {searchTerm ? '没有匹配的广告活动' : '暂无广告活动'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredCampaigns.map((campaign: any) => (
                  <TableRow key={campaign.id || campaign.campaignId}>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {campaign.campaignName || `Campaign ${campaign.campaignId}`}
                    </TableCell>
                    <TableCell className="text-right">
                      ${(campaign.spend || 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      ${(campaign.sales || 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={campaign.acos > 40 ? 'text-red-600' : campaign.acos > 25 ? 'text-yellow-600' : 'text-green-600'}>
                        {(campaign.acos || 0).toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {(campaign.clicks || 0).toLocaleString()}
                    </TableCell>
                    {onRemoveCampaign && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onRemoveCampaign(campaign.id || campaign.campaignId)}
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
