/**
 * 路由辅助函数模块
 * 
 * 从 routers.ts 拆分出的共享辅助函数，供各路由模块使用。
 */

/**
 * 生成模拟的趋势数据（当没有真实历史数据时使用）
 */
export function generateSimulatedTrendData(target: any, days: number) {
  const data = [];
  const now = new Date();
  
  // 基础数据
  const baseImpressions = target.impressions || 1000;
  const baseClicks = target.clicks || 50;
  const baseSpend = parseFloat(target.spend || "10");
  const baseSales = parseFloat(target.sales || "30");
  const baseOrders = target.orders || 3;
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    // 添加随机波动（±30%）
    const variation = 0.7 + Math.random() * 0.6;
    const weekdayFactor = date.getDay() === 0 || date.getDay() === 6 ? 0.8 : 1.1;
    
    const impressions = Math.round((baseImpressions / days) * variation * weekdayFactor);
    const clicks = Math.round((baseClicks / days) * variation * weekdayFactor);
    const spend = Math.round((baseSpend / days) * variation * weekdayFactor * 100) / 100;
    const sales = Math.round((baseSales / days) * variation * weekdayFactor * 100) / 100;
    const orders = Math.round((baseOrders / days) * variation * weekdayFactor);
    
    const ctr = impressions > 0 ? (clicks / impressions * 100) : 0;
    const cvr = clicks > 0 ? (orders / clicks * 100) : 0;
    const acos = sales > 0 ? (spend / sales * 100) : 0;
    const roas = spend > 0 ? (sales / spend) : 0;
    const cpc = clicks > 0 ? (spend / clicks) : 0;
    
    data.push({
      date: date.toISOString().split('T')[0],
      impressions,
      clicks,
      spend,
      sales,
      orders,
      ctr: Math.round(ctr * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      acos: Math.round(acos * 100) / 100,
      roas: Math.round(roas * 100) / 100,
      cpc: Math.round(cpc * 100) / 100,
    });
  }
  
  return data;
}

/**
 * 计算趋势摘要数据
 */
export function calculateTrendSummary(data: unknown[]) {
  if (!data || data.length === 0) {
    return {
      totalImpressions: 0,
      totalClicks: 0,
      totalSpend: 0,
      totalSales: 0,
      totalOrders: 0,
      avgCtr: 0,
      avgCvr: 0,
      avgAcos: 0,
      avgRoas: 0,
      avgCpc: 0,
      trend: {
        impressions: 'stable',
        clicks: 'stable',
        spend: 'stable',
        sales: 'stable',
        acos: 'stable',
        roas: 'stable',
      },
    };
  }
  
  const totalImpressions = data.reduce((sum: number, d: Record<string, unknown>) => sum + d.impressions, 0);
  const totalClicks = data.reduce((sum: number, d: Record<string, unknown>) => sum + d.clicks, 0);
  const totalSpend = data.reduce((sum: number, d: Record<string, unknown>) => sum + d.spend, 0);
  const totalSales = data.reduce((sum: number, d: Record<string, unknown>) => sum + d.sales, 0);
  const totalOrders = data.reduce((sum: number, d: Record<string, unknown>) => sum + d.orders, 0);
  
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0;
  const avgCvr = totalClicks > 0 ? (totalOrders / totalClicks * 100) : 0;
  const avgAcos = totalSales > 0 ? (totalSpend / totalSales * 100) : 0;
  const avgRoas = totalSpend > 0 ? (totalSales / totalSpend) : 0;
  const avgCpc = totalClicks > 0 ? (totalSpend / totalClicks) : 0;
  
  // 计算趋势（对比前半段和后半段）
  const midPoint = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, midPoint);
  const secondHalf = data.slice(midPoint);
  
  const calcTrend = (metric: string) => {
    const firstAvg = firstHalf.reduce((sum: number, d: Record<string, unknown>) => sum + (d[metric] || 0), 0) / (firstHalf.length || 1);
    const secondAvg = secondHalf.reduce((sum: number, d: Record<string, unknown>) => sum + (d[metric] || 0), 0) / (secondHalf.length || 1);
    const change = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg * 100) : 0;
    
    if (change > 10) return 'up';
    if (change < -10) return 'down';
    return 'stable';
  };
  
  return {
    totalImpressions,
    totalClicks,
    totalSpend: Math.round(totalSpend * 100) / 100,
    totalSales: Math.round(totalSales * 100) / 100,
    totalOrders,
    avgCtr: Math.round(avgCtr * 100) / 100,
    avgCvr: Math.round(avgCvr * 100) / 100,
    avgAcos: Math.round(avgAcos * 100) / 100,
    avgRoas: Math.round(avgRoas * 100) / 100,
    avgCpc: Math.round(avgCpc * 100) / 100,
    trend: {
      impressions: calcTrend('impressions'),
      clicks: calcTrend('clicks'),
      spend: calcTrend('spend'),
      sales: calcTrend('sales'),
      acos: calcTrend('acos'),
      roas: calcTrend('roas'),
    },
  };
}

/**
 * 计算下次发送时间
 */
export function calculateNextSendTime(
  frequency: string,
  sendTime: string,
  sendDayOfWeek?: number,
  sendDayOfMonth?: number
): string {
  const now = new Date();
  const [hours, minutes] = sendTime.split(':').map(Number);
  
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (frequency === 'daily') {
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
  } else if (frequency === 'weekly') {
    const targetDay = sendDayOfWeek ?? 1; // 默认周一
    const currentDay = next.getDay();
    let daysUntilTarget = targetDay - currentDay;
    if (daysUntilTarget < 0 || (daysUntilTarget === 0 && next <= now)) {
      daysUntilTarget += 7;
    }
    next.setDate(next.getDate() + daysUntilTarget);
  } else if (frequency === 'monthly') {
    const targetDate = sendDayOfMonth ?? 1; // 默认1号
    next.setDate(targetDate);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
  }
  return next.toISOString().slice(0, 19).replace('T', ' ');
}
