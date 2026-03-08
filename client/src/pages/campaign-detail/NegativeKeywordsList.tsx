// @ts-nocheck
/**
 * v361: 从CampaignDetail.tsx拆分的NegativeKeywordsList子组件
 */

import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2 } from 'lucide-react';
import { trpc } from '@/utils/trpc';

export function NegativeKeywordsList({ campaignId }: { campaignId: number }) {
  const { data: negatives, isLoading } = trpc.campaign.getNegativeKeywords.useQuery(
    { campaignId },
    { enabled: !!campaignId }
  );
  
  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  if (!negatives || negatives.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Ban className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>暂无否定关键词数据</p>
        <p className="text-sm mt-1">您可以在搜索词页面中将低效搜索词添加为否定词</p>
      </div>
    );
  }
  
  // 分类：否定关键词 vs 否定商品
  const negKeywords = negatives.filter((n: any) => n.negativeType === 'keyword');
  const negProducts = negatives.filter((n: any) => n.negativeType === 'product');
  
  return (
    <div className="space-y-6">
      {/* 否定关键词 */}
      <div>
        <h4 className="text-sm font-medium mb-3">否定关键词 ({negKeywords.length})</h4>
        {negKeywords.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>否定词</TableHead>
                <TableHead>匹配类型</TableHead>
                <TableHead>否定级别</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>添加时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {negKeywords.map((neg: any) => (
                <TableRow key={neg.id}>
                  <TableCell className="font-medium">{neg.negativeText}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {neg.negativeMatchType === 'negative_exact' ? '精确否定' : '词组否定'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {neg.negativeLevel === 'campaign' ? '广告活动级' : '广告组级'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {neg.negativeSource === 'manual' ? '手动添加' : 
                     neg.negativeSource === 'search_term_harvest' ? '搜索词收割' :
                     neg.negativeSource === 'auto_optimization' ? '自动优化' : neg.negativeSource}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {neg.createdAt ? safeToLocaleDateString(neg.createdAt) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">暂无否定关键词</p>
        )}
      </div>
      
      {/* 否定商品 */}
      <div>
        <h4 className="text-sm font-medium mb-3">否定商品定向 ({negProducts.length})</h4>
        {negProducts.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>否定商品/ASIN</TableHead>
                <TableHead>否定级别</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>添加时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {negProducts.map((neg: any) => (
                <TableRow key={neg.id}>
                  <TableCell className="font-medium">{neg.negativeText}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {neg.negativeLevel === 'campaign' ? '广告活动级' : '广告组级'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {neg.negativeSource === 'manual' ? '手动添加' : 
                     neg.negativeSource === 'search_term_harvest' ? '搜索词收割' :
                     neg.negativeSource === 'auto_optimization' ? '自动优化' : neg.negativeSource}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {neg.createdAt ? safeToLocaleDateString(neg.createdAt) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">暂无否定商品定向</p>
        )}
      </div>
    </div>
  );
}

