// @ts-nocheck
/**
 * v361: 从CampaignDetail.tsx拆分的PlacementPerformanceList子组件
 */

import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { trpc } from '@/utils/trpc';

export function PlacementPerformanceList({ campaignId, campaignType }: { campaignId: number | null, campaignType: string }) {
  const { data: placements, isLoading } = trpc.campaign.getPlacementPerformance.useQuery(
    { campaignId: campaignId! },
    { enabled: !!campaignId }
  );
  
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  // SP广告的位置类型
  const spPlacements = [
    { type: 'TOP_OF_SEARCH', label: '搜索顶部', description: '搜索结果首页顶部位置' },
    { type: 'DETAIL_PAGE', label: '商品详情页', description: '商品详情页上的广告位' },
    { type: 'OTHER', label: '其他位置', description: '搜索结果其余位置' },
  ];
  
  // SD广告的位置类型
  const sdPlacements = [
    { type: 'AMAZON_OWNED', label: 'Amazon自有', description: 'Amazon网站和应用内' },
    { type: 'THIRD_PARTY', label: '第三方', description: '第三方网站和应用' },
  ];

  // SB品牌广告的位置类型
  const sbPlacements = [
    { type: 'TOP_OF_SEARCH', label: '搜索顶部', description: '搜索结果首页顶部品牌广告位' },
    { type: 'DETAIL_PAGE', label: '商品详情页', description: '商品详情页上的品牌广告位' },
    { type: 'OTHER', label: '其他位置', description: '搜索结果其余位置的品牌广告' },
  ];
  
  const placementTypes = campaignType === 'sd' ? sdPlacements : campaignType === 'sb' ? sbPlacements : spPlacements;
  
  // @ts-ignore
  if (!placements || placements.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground mb-4">
          {campaignType === 'sd' 
            ? 'SD展示广告在Amazon自有平台和第三方网站展示'
            : campaignType === 'sb'
            ? 'SB品牌广告在搜索结果和商品详情页展示'
            : 'SP广告在搜索结果和商品详情页展示'}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {placementTypes.map((placement: any) => (
            <Card key={placement.type} className="border-dashed">
              <CardContent className="pt-6">
                <div className="text-center">
                  <h4 className="font-medium">{placement.label}</h4>
                  <p className="text-xs text-muted-foreground mt-1">{placement.description}</p>
                  <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                    <p>曝光: --</p>
                    <p>点击: --</p>
                    <p>花费: --</p>
                    <p>销售额: --</p>
                    <p>ACoS: --</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-xs text-muted-foreground text-center mt-4">
          暂无位置绩效数据，请先同步广告数据
        </p>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground mb-4">
        {campaignType === 'sd' 
          ? 'SD展示广告在Amazon自有平台和第三方网站展示'
          : 'SP广告在搜索结果和商品详情页展示'}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(placements as any[]).map((placement: any) => {
          const spend = parseFloat(placement.spend || "0");
          const sales = parseFloat(placement.sales || "0");
          const acos = sales > 0 ? (spend / sales * 100) : 0;
          const roas = spend > 0 ? (sales / spend) : 0;
          const ctr = placement.impressions > 0 ? (placement.clicks / placement.impressions * 100) : 0;
          const cvr = placement.clicks > 0 ? (placement.orders / placement.clicks * 100) : 0;
          
          const placementInfo = placementTypes.find(p => p.type === placement.placementType) || {
            label: placement.placementType,
            description: ''
          };
          
          return (
            <Card key={placement.id || placement.placementType}>
              <CardContent className="pt-6">
                <div className="text-center">
                  <h4 className="font-medium">{placementInfo.label}</h4>
                  <p className="text-xs text-muted-foreground mt-1">{placementInfo.description}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <div className="text-left">
                      <span className="text-muted-foreground">曝光:</span>
                      <span className="ml-2 font-medium">{(placement.impressions || 0).toLocaleString()}</span>
                    </div>
                    <div className="text-left">
                      <span className="text-muted-foreground">点击:</span>
                      <span className="ml-2 font-medium">{(placement.clicks || 0).toLocaleString()}</span>
                    </div>
                    <div className="text-left">
                      <span className="text-muted-foreground">CTR:</span>
                      <span className="ml-2 font-medium">{ctr.toFixed(2)}%</span>
                    </div>
                    <div className="text-left">
                      <span className="text-muted-foreground">CPC:</span>
                      <span className="ml-2 font-medium">${placement.clicks > 0 ? (spend / placement.clicks).toFixed(2) : '0.00'}</span>
                    </div>
                    <div className="text-left">
                      <span className="text-muted-foreground">花费:</span>
                      <span className="ml-2 font-medium">${spend.toFixed(2)}</span>
                    </div>
                    <div className="text-left">
                      <span className="text-muted-foreground">订单:</span>
                      <span className="ml-2 font-medium">{placement.orders || 0}</span>
                    </div>
                    <div className="text-left">
                      <span className="text-muted-foreground">销售额:</span>
                      <span className="ml-2 font-medium">${sales.toFixed(2)}</span>
                    </div>
                    <div className="text-left">
                      <span className="text-muted-foreground">CVR:</span>
                      <span className="ml-2 font-medium">{cvr.toFixed(2)}%</span>
                    </div>
                    <div className="text-left col-span-2 pt-2 border-t">
                      <span className="text-muted-foreground">ACoS:</span>
                      <span className={`ml-2 font-medium ${acos > 30 ? 'text-red-500' : acos > 20 ? 'text-yellow-500' : 'text-green-500'}`}>
                        {acos.toFixed(2)}%
                      </span>
                      <span className="mx-2 text-muted-foreground">|</span>
                      <span className="text-muted-foreground">ROAS:</span>
                      <span className={`ml-2 font-medium ${roas < 2 ? 'text-red-500' : roas < 3 ? 'text-yellow-500' : 'text-green-500'}`}>
                        {roas.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
