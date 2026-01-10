import { useEffect } from "react";

interface PageMetaProps {
  title: string;
  description: string;
  keywords?: string;
  ogImage?: string;
  canonicalPath?: string;
}

/**
 * PageMeta组件 - 用于管理页面级别的meta标签
 * 
 * 使用方法：
 * <PageMeta 
 *   title="广告活动管理" 
 *   description="管理和优化您的亚马逊广告活动..."
 * />
 */
export function PageMeta({ 
  title, 
  description, 
  keywords,
  ogImage,
  canonicalPath 
}: PageMetaProps) {
  const baseUrl = import.meta.env.VITE_APP_URL || "";
  const defaultOgImage = `${baseUrl}/og-image.png`;
  const fullTitle = `${title} | Amazon Ads Optimizer`;

  useEffect(() => {
    // 更新页面标题
    document.title = fullTitle;

    // 更新或创建meta标签的辅助函数
    const updateMetaTag = (selector: string, content: string, attribute: string = "content") => {
      let meta = document.querySelector(selector) as HTMLMetaElement;
      if (meta) {
        meta.setAttribute(attribute, content);
      } else {
        meta = document.createElement("meta");
        const selectorParts = selector.match(/\[([^\]]+)\]/g);
        if (selectorParts) {
          selectorParts.forEach(part => {
            const [attr, value] = part.slice(1, -1).split("=");
            meta.setAttribute(attr, value?.replace(/"/g, "") || "");
          });
        }
        meta.setAttribute(attribute, content);
        document.head.appendChild(meta);
      }
    };

    // 更新description
    updateMetaTag('meta[name="description"]', description);

    // 更新keywords（如果提供）
    if (keywords) {
      updateMetaTag('meta[name="keywords"]', keywords);
    }

    // 更新Open Graph标签
    updateMetaTag('meta[property="og:title"]', fullTitle);
    updateMetaTag('meta[property="og:description"]', description);
    updateMetaTag('meta[property="og:image"]', ogImage || defaultOgImage);
    if (canonicalPath) {
      updateMetaTag('meta[property="og:url"]', `${baseUrl}${canonicalPath}`);
    }

    // 更新Twitter Card标签
    updateMetaTag('meta[name="twitter:title"]', fullTitle);
    updateMetaTag('meta[name="twitter:description"]', description);
    updateMetaTag('meta[name="twitter:image"]', ogImage || defaultOgImage);

    // 更新canonical链接
    if (canonicalPath) {
      let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
      if (canonical) {
        canonical.href = `${baseUrl}${canonicalPath}`;
      } else {
        canonical = document.createElement("link");
        canonical.rel = "canonical";
        canonical.href = `${baseUrl}${canonicalPath}`;
        document.head.appendChild(canonical);
      }
    }

    // 清理函数 - 恢复默认标题
    return () => {
      document.title = "亚马逊广告智能优化工具 | 自动竞价与ACoS优化 - Amazon Ads Optimizer";
    };
  }, [title, description, keywords, ogImage, canonicalPath, fullTitle, baseUrl, defaultOgImage]);

  return null;
}

// 预定义的页面meta配置
export const PAGE_META_CONFIG = {
  dashboard: {
    title: "数据概览",
    description: "查看您的亚马逊广告整体表现，包括花费、销售额、ACoS、ROAS等核心指标的实时数据和趋势分析。",
    keywords: "亚马逊广告数据,广告概览,ACoS分析,ROAS监控",
    canonicalPath: "/dashboard"
  },
  campaigns: {
    title: "广告活动管理",
    description: "管理和优化您的所有亚马逊广告活动，支持SP、SB、SD全类型广告的批量操作和智能筛选。",
    keywords: "广告活动管理,SP广告,SB广告,SD广告,批量操作",
    canonicalPath: "/campaigns"
  },
  strategyCenter: {
    title: "策略管理中心",
    description: "创建和管理广告优化策略，设置自动化规则，实现广告出价、预算、否定词的智能调整。",
    keywords: "广告策略,自动化规则,出价优化,预算管理",
    canonicalPath: "/strategy-center"
  },
  optimizationTargets: {
    title: "优化目标设置",
    description: "设置广告优化目标，定义ACoS目标值、预算限制和优化优先级，让系统自动为您优化广告表现。",
    keywords: "优化目标,ACoS目标,预算限制,优化优先级",
    canonicalPath: "/optimization-targets"
  },
  smartOptimization: {
    title: "智能优化中心",
    description: "基于动态弹性系数和UCB算法的智能优化引擎，自动分析广告数据并执行最优调整策略。",
    keywords: "智能优化,弹性系数,UCB算法,自动优化",
    canonicalPath: "/smart-optimization"
  },
  abTesting: {
    title: "A/B测试",
    description: "创建和管理广告A/B测试，对比不同策略的效果，找到最佳的广告优化方案。",
    keywords: "A/B测试,广告测试,策略对比,效果分析",
    canonicalPath: "/ab-testing"
  },
  reports: {
    title: "数据报告",
    description: "生成详细的广告数据报告，包括日报、周报、月报，支持自定义时间范围和指标维度。",
    keywords: "数据报告,广告报告,日报周报,数据导出",
    canonicalPath: "/reports"
  },
  settings: {
    title: "系统设置",
    description: "配置账户设置、API连接、通知偏好和系统参数，管理您的Amazon Ads Optimizer使用体验。",
    keywords: "系统设置,账户配置,API连接,通知设置",
    canonicalPath: "/settings"
  }
} as const;

export default PageMeta;
