// @ts-nocheck
/**
 * v361: 从CampaignDetail.tsx拆分的KeywordsList子组件
 */

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Tag } from 'lucide-react';
import { trpc } from '@/utils/trpc';

export function KeywordsList({ adGroups }: { adGroups: any[] }) {
  const [allKeywords, setAllKeywords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // 为每个广告组获取关键词
  const keywordQueries = adGroups.map(ag => 
    trpc.keyword.list.useQuery({ adGroupId: ag.id }, { enabled: !!ag.id })
  );
  
  // 合并所有关键词
  useEffect(() => {
    const keywords: any[] = [];
    let loading = false;
    
    keywordQueries.forEach((query: any, index: any) => {
      if (query.isLoading) {
        loading = true;
      }
      if (query.data) {
        keywords.push(...query.data.map((k: any) => ({
          ...k,
          adGroupName: adGroups[index]?.adGroupName
        })));
      }
    });
    
    setIsLoading(loading);
    setAllKeywords(keywords);
  }, [keywordQueries.map(q => q.data).join(",")]);
  
  // 按销售额排序
  const sortedKeywords = [...allKeywords].sort((a: any, b: any) => 
    parseFloat(b.sales || "0") - parseFloat(a.sales || "0")
  );
  
  if (isLoading && allKeywords.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  if (sortedKeywords.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Tag className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>暂无关键词数据</p>
      </div>
    );
  }
  
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>关键词</TableHead>
          <TableHead>匹配类型</TableHead>
          <TableHead>广告组</TableHead>
          <TableHead className="text-right">出价</TableHead>
          <TableHead className="text-right">花费</TableHead>
          <TableHead className="text-right">销售额</TableHead>
          <TableHead className="text-right">ACoS</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedKeywords.slice(0, 20).map((keyword: any) => {
          const kwSpend = parseFloat(keyword.spend || "0");
          const kwSales = parseFloat(keyword.sales || "0");
          const kwAcos = kwSales > 0 ? (kwSpend / kwSales * 100) : 0;
          return (
            <TableRow key={keyword.id}>
              <TableCell className="font-medium">{keyword.keywordText}</TableCell>
              <TableCell>
                <Badge variant="outline">
                  {keyword.matchType === "exact" ? "精确" : keyword.matchType === "phrase" ? "词组" : "广泛"}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{keyword.adGroupName}</TableCell>
              <TableCell className="text-right">${keyword.bid || "N/A"}</TableCell>
              <TableCell className="text-right">${kwSpend.toFixed(2)}</TableCell>
              <TableCell className="text-right">${kwSales.toFixed(2)}</TableCell>
              <TableCell className="text-right">
                <span className={kwAcos > 30 ? "text-red-500" : kwAcos > 20 ? "text-yellow-500" : "text-green-500"}>
                  {kwSales > 0 ? `${kwAcos.toFixed(2)}%` : "N/A"}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}


// 投放词列表子组件
