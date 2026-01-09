import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useEffect, useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { 
  BarChart3, 
  Target, 
  TrendingUp, 
  TrendingDown,
  Zap, 
  ArrowRight, 
  Shield, 
  Brain,
  RefreshCw,
  DollarSign,
  ShoppingCart,
  Percent,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  Clock,
  Globe,
  Search,
  LineChart,
  PieChart,
  Layers,
  Settings,
  ChevronRight,
  Star,
  Users,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Calculator,
  Filter,
  Lightbulb
} from "lucide-react";
import toast from "react-hot-toast";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts";
import { Link } from "wouter";
import { TimeRangeSelector, TimeRangeValue, getDefaultTimeRangeValue, TIME_RANGE_PRESETS, PresetTimeRange } from "@/components/TimeRangeSelector";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

// 生成最近7天的模拟数据
const generateLast7DaysData = () => {
  const data = [];
  const now = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    
    const spend = 80 + Math.random() * 60;
    const acos = 18 + Math.random() * 12;
    const sales = spend / (acos / 100);
    
    data.push({
      date: dateStr,
      spend: parseFloat(spend.toFixed(0)),
      sales: parseFloat(sales.toFixed(0)),
      acos: parseFloat(acos.toFixed(1)),
      orders: Math.floor(sales / 35),
    });
  }
  return data;
};

// 生成多账户数据
const generateAccountsData = () => {
  return [
    {
      id: 1,
      name: 'ElaraFit',
      marketplace: 'US',
      spend: 640.13,
      sales: 1920.45,
      acos: 20.2,
      roas: 3.0,
      orders: 55,
      status: 'warning',
      alerts: 1,
      change: { spend: 5.2, sales: 8.3, acos: -2.1 }
    },
    {
      id: 2,
      name: 'ElaraFit EU',
      marketplace: 'DE',
      spend: 320.50,
      sales: 890.20,
      acos: 25.8,
      roas: 2.78,
      orders: 28,
      status: 'healthy',
      alerts: 0,
      change: { spend: -3.1, sales: 2.5, acos: -4.2 }
    },
    {
      id: 3,
      name: 'ElaraFit UK',
      marketplace: 'UK',
      spend: 180.25,
      sales: 520.80,
      acos: 22.5,
      roas: 2.89,
      orders: 18,
      status: 'healthy',
      alerts: 0,
      change: { spend: 1.8, sales: 5.6, acos: -1.5 }
    }
  ];
};

// 营销页面组件（未登录时显示）
function MarketingPage() {
  useEffect(() => {
    document.title = "亚马逊广告智能优化系统 - Amazon Ads Optimizer";
  }, []);

  // 算法工作原理数据
  const algorithmSteps = [
    {
      step: 1,
      title: "数据采集与分析",
      description: "每2小时自动同步Amazon Ads API数据，包括广告活动、关键词、搜索词报告等，构建完整的数据基础。",
      icon: Search,
      details: ["SP/SB/SD全类型支持", "多站点数据聚合", "历史数据趋势分析"]
    },
    {
      step: 2,
      title: "动态弹性系数计算",
      description: "基于历史出价变化和点击量变化，动态计算每个关键词的点击弹性系数，精准预测出价调整效果。",
      icon: Calculator,
      details: ["回归分析建模", "置信区间评估", "异常值过滤"]
    },
    {
      step: 3,
      title: "智能优化决策",
      description: "结合边际效益分析、UCB探索-利用平衡算法，为每个广告活动生成最优的出价和预算建议。",
      icon: Brain,
      details: ["边际收益=边际成本", "探索新机会", "风险控制"]
    },
    {
      step: 4,
      title: "自动执行与监控",
      description: "根据您配置的策略自动执行优化操作，并持续监控效果，形成闭环优化。",
      icon: RefreshCw,
      details: ["渐进式调整", "异常告警", "效果追踪"]
    }
  ];

  // 核心算法特性
  const coreFeatures = [
    {
      icon: BarChart3,
      title: "动态弹性系数",
      subtitle: "精准预测竞价效果",
      description: "传统优化工具使用固定的弹性系数（如-1.5），而我们基于每个关键词的历史出价变化数据，动态计算其真实的点击弹性。这意味着对于竞争激烈的关键词和长尾关键词，系统会采用不同的优化策略。",
      benefits: ["提高出价预测准确性30%+", "避免过度出价浪费预算", "识别高弹性机会词"]
    },
    {
      icon: Target,
      title: "UCB预算分配",
      subtitle: "探索-利用平衡算法",
      description: "采用Upper Confidence Bound算法，在优化高效广告活动的同时，为数据不足的广告活动保留探索预算。确保不会因为早期数据不足而错过潜力广告。",
      benefits: ["发现被低估的广告活动", "最小探索预算保障", "动态调整探索比例"]
    },
    {
      icon: Globe,
      title: "时区感知分时",
      subtitle: "本地化消费者行为分析",
      description: "根据不同站点的本地时区分析消费者购买行为，而非使用UTC时间。美国站分析美国消费者的购物高峰，日本站分析日本消费者的行为模式。",
      benefits: ["准确识别购物高峰时段", "智能分时出价调整", "跨站点策略差异化"]
    },
    {
      icon: Filter,
      title: "智能N-Gram分析",
      subtitle: "精准否定无效流量",
      description: "在否定关键词分析中引入最小点击量阈值（默认5次）和品牌词白名单保护，避免因数据量不足而误判，同时保护您的品牌词不被错误否定。",
      benefits: ["减少误判率50%+", "品牌词自动保护", "支持自定义白名单"]
    },
    {
      icon: Lightbulb,
      title: "新词探索策略",
      subtitle: "7天探索期保护",
      description: "新添加的关键词在前7天内享有探索期保护，即使表现不佳也不会被立即否定或大幅降价，给予充分的数据积累时间。",
      benefits: ["避免过早否定潜力词", "新词转化率提升", "数据驱动的决策"]
    },
    {
      icon: Clock,
      title: "每2小时自动运营",
      subtitle: "全天候智能优化",
      description: "系统每2小时自动执行一轮完整的优化流程，包括数据同步、分析计算、策略执行，无需人工干预，让您的广告始终保持最优状态。",
      benefits: ["24/7全天候优化", "快速响应市场变化", "节省运营人力成本"]
    }
  ];

  // 效果数据展示
  const performanceMetrics = [
    { label: "平均ACoS降低", value: "23%", trend: "down", color: "text-green-500" },
    { label: "广告销售额提升", value: "35%", trend: "up", color: "text-blue-500" },
    { label: "无效花费减少", value: "41%", trend: "down", color: "text-green-500" },
    { label: "运营时间节省", value: "90%", trend: "up", color: "text-purple-500" }
  ];

  // FAQ数据
  const faqs = [
    {
      question: "系统支持哪些类型的Amazon广告？",
      answer: "支持Sponsored Products (SP)、Sponsored Brands (SB)和Sponsored Display (SD)三种广告类型，覆盖Amazon广告的全部主流形式。"
    },
    {
      question: "优化策略会自动执行还是需要人工确认？",
      answer: "您可以选择自动执行或人工确认模式。自动模式下，系统会在您设定的安全范围内自动执行优化；人工确认模式下，系统会生成建议供您审核后再执行。"
    },
    {
      question: "如何保证优化不会导致广告效果下降？",
      answer: "系统采用渐进式调整策略，单次出价调整不超过25%，预算调整不超过30%。同时设有异常检测机制，当检测到效果异常下降时会自动暂停优化并发出告警。"
    },
    {
      question: "支持多站点多账户管理吗？",
      answer: "支持。您可以在一个账户下管理多个Amazon卖家账户和多个站点（US、CA、MX、UK、DE、FR、IT、ES、JP、AU等），统一查看数据和管理策略。"
    },
    {
      question: "数据安全如何保障？",
      answer: "我们使用Amazon官方的Advertising API进行数据交互，采用OAuth 2.0安全认证。所有数据传输使用HTTPS加密，数据存储符合行业安全标准。"
    }
  ];

  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background"></div>
        {/* 装饰性背景元素 */}
        <div className="absolute top-20 right-10 w-72 h-72 bg-primary/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-10 left-10 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl"></div>
        
        <nav className="relative container py-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">Amazon Ads Optimizer</span>
          </div>
          <Button asChild>
            <a href={getLoginUrl()}>登录</a>
          </Button>
        </nav>

        <div className="relative container py-24 lg:py-32">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Brain className="w-4 h-4" />
              <span>自主研发的智能优化算法</span>
            </div>
            <h1 className="text-4xl lg:text-6xl font-bold tracking-tight mb-6">
              让数据驱动您的
              <span className="text-primary">亚马逊广告优化</span>
            </h1>
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed max-w-3xl">
              基于<strong className="text-foreground">动态弹性系数计算</strong>、<strong className="text-foreground">UCB探索-利用平衡</strong>和<strong className="text-foreground">时区感知分时分析</strong>，
              实现广告出价、预算、否定词的全自动优化。每2小时自动运营，让您的广告投放效率持续提升。
            </p>
            
            {/* 核心指标展示 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {performanceMetrics.map((metric, i) => (
                <div key={i} className="bg-card/50 backdrop-blur-sm border border-border/50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    {metric.trend === "up" ? (
                      <ArrowUpRight className={`w-4 h-4 ${metric.color}`} />
                    ) : (
                      <ArrowDownRight className={`w-4 h-4 ${metric.color}`} />
                    )}
                    <span className={`text-2xl font-bold ${metric.color}`}>{metric.value}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{metric.label}</p>
                </div>
              ))}
            </div>
            
            <div className="flex flex-wrap gap-4">
              <Button size="lg" asChild>
                <a href={getLoginUrl()}>
                  免费开始使用
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#how-it-works">
                  了解工作原理
                  <ChevronRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* 核心算法引擎 Section */}
      <section className="py-24 bg-card/30">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4">核心技术</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">六大核心算法引擎</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              每一个算法都经过精心设计，解决传统广告优化工具的痛点问题
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {coreFeatures.map((feature, i) => (
              <Card key={i} className="bg-card/50 border-border/50 hover:border-primary/50 transition-colors group">
                <CardHeader>
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                    <feature.icon className="w-6 h-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                  <CardDescription>{feature.subtitle}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">{feature.description}</p>
                  <ul className="space-y-2">
                    {feature.benefits.map((benefit, j) => (
                      <li key={j} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <span>{benefit}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* 工作原理 Section */}
      <section id="how-it-works" className="py-24">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4">工作原理</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">智能优化四步流程</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              从数据采集到自动执行，形成完整的优化闭环
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {algorithmSteps.map((step, i) => (
              <div key={i} className="relative">
                {/* 连接线 */}
                {i < algorithmSteps.length - 1 && (
                  <div className="hidden lg:block absolute top-12 left-full w-full h-0.5 bg-gradient-to-r from-primary/50 to-transparent -translate-x-4"></div>
                )}
                
                <div className="text-center">
                  <div className="relative inline-flex">
                    <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                      <step.icon className="w-10 h-10 text-primary" />
                    </div>
                    <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                      {step.step}
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground mb-4">{step.description}</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {step.details.map((detail, j) => (
                      <Badge key={j} variant="secondary" className="text-xs">
                        {detail}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 算法对比 Section */}
      <section className="py-24 bg-card/30">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4">技术优势</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">与传统工具的区别</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              我们的算法针对传统优化工具的局限性进行了全面升级
            </p>
          </div>
          
          <div className="max-w-4xl mx-auto">
            <div className="grid gap-4">
              {[
                {
                  aspect: "弹性系数计算",
                  traditional: "使用固定值（如-1.5），所有关键词一视同仁",
                  ours: "基于历史数据动态计算，每个关键词独立建模"
                },
                {
                  aspect: "预算分配策略",
                  traditional: "只优化表现好的广告，忽略潜力广告",
                  ours: "UCB算法平衡探索与利用，不错过任何机会"
                },
                {
                  aspect: "分时分析",
                  traditional: "使用UTC时间，忽略本地消费者行为",
                  ours: "时区感知，按站点本地时间分析购物高峰"
                },
                {
                  aspect: "否定词判断",
                  traditional: "简单规则判断，容易误判品牌词和新词",
                  ours: "最小点击量阈值+品牌词白名单+探索期保护"
                },
                {
                  aspect: "CPC预测",
                  traditional: "假设CPC等于出价，预测不准确",
                  ours: "基于历史CPC/Bid比例动态估算实际CPC"
                }
              ].map((item, i) => (
                <div key={i} className="grid md:grid-cols-3 gap-4 p-4 rounded-lg bg-card border border-border/50">
                  <div className="font-medium text-primary">{item.aspect}</div>
                  <div className="flex items-start gap-2">
                    <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-muted-foreground">{item.traditional}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-sm">{item.ours}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 支持的广告类型 */}
      <section className="py-24">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4">全面支持</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">支持所有Amazon广告类型</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              无论您使用哪种广告形式，我们都能提供智能优化支持
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              {
                type: "Sponsored Products",
                abbr: "SP",
                description: "商品推广广告，出现在搜索结果和商品详情页",
                features: ["关键词竞价优化", "自动/手动广告支持", "搜索词分析"]
              },
              {
                type: "Sponsored Brands",
                abbr: "SB",
                description: "品牌推广广告，展示品牌Logo和多个商品",
                features: ["品牌曝光优化", "视频广告支持", "品牌词保护"]
              },
              {
                type: "Sponsored Display",
                abbr: "SD",
                description: "展示型推广广告，站内外精准触达消费者",
                features: ["受众定向优化", "再营销策略", "跨渠道追踪"]
              }
            ].map((ad, i) => (
              <Card key={i} className="text-center">
                <CardHeader>
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl font-bold text-primary">{ad.abbr}</span>
                  </div>
                  <CardTitle>{ad.type}</CardTitle>
                  <CardDescription>{ad.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-left">
                    {ad.features.map((feature, j) => (
                      <li key={j} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-24 bg-card/30">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4">常见问题</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">FAQ</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              关于系统使用的常见问题解答
            </p>
          </div>
          
          <div className="max-w-3xl mx-auto space-y-4">
            {faqs.map((faq, i) => (
              <div 
                key={i} 
                className="bg-card border border-border/50 rounded-lg overflow-hidden"
              >
                <button
                  className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-muted/50 transition-colors"
                  onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                >
                  <span className="font-medium">{faq.question}</span>
                  <ChevronRight className={`w-5 h-5 text-muted-foreground transition-transform ${expandedFaq === i ? 'rotate-90' : ''}`} />
                </button>
                {expandedFaq === i && (
                  <div className="px-6 pb-4">
                    <p className="text-muted-foreground">{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24">
        <div className="container">
          <div className="max-w-4xl mx-auto text-center bg-gradient-to-br from-primary/10 via-primary/5 to-transparent rounded-3xl p-12 border border-primary/20">
            <Sparkles className="w-12 h-12 text-primary mx-auto mb-6" />
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">开始智能优化您的广告</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              立即登录，连接您的Amazon Ads账户，让AI帮您实现广告效果的持续提升
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Button size="lg" asChild>
                <a href={getLoginUrl()}>
                  免费开始使用
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-6">
              无需信用卡 · 即刻开始 · 随时取消
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border/50">
        <div className="container">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold">Amazon Ads Optimizer</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2024 Amazon Ads Optimizer. 专注于亚马逊广告智能优化。
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// 仪表盘组件（登录后显示）
function DashboardContent() {
  const { user } = useAuth();
  const [timeRangeValue, setTimeRangeValue] = useState<TimeRangeValue>(getDefaultTimeRangeValue('7days'));
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // 获取数据可用日期范围（用于限制自定义日期选择器）
  const { data: dataDateRange } = trpc.adAccount.getDataDateRange.useQuery(
    undefined,
    { enabled: !!user }
  );
  
  // 计算时间范围的天数和日期
  const days = timeRangeValue.days;
  const startDate = format(timeRangeValue.dateRange.from, 'yyyy-MM-dd');
  const endDate = format(timeRangeValue.dateRange.to, 'yyyy-MM-dd');
  const timeRange = timeRangeValue.preset === 'custom' ? 'custom' : timeRangeValue.preset;
  
  // 获取账户列表及绩效数据（支持时间范围筛选）
  const { data: accountsWithPerformance, refetch: refetchAccounts } = trpc.adAccount.listWithPerformance.useQuery(
    { timeRange: timeRange as any, days, startDate, endDate },
    { enabled: !!user }
  );
  
  // 获取图表数据（真实数据）
  const { data: trendData } = trpc.adAccount.getDailyTrend.useQuery(
    { days, timeRange: timeRange as any, startDate, endDate },
    { enabled: !!user }
  );
  
  // 图表数据：优先使用真实数据，否则使用模拟数据
  const chartData = useMemo(() => {
    if (trendData && trendData.length > 0) {
      return trendData;
    }
    return generateLast7DaysData();
  }, [trendData]);
  
  // 使用真实账户数据，按市场优先级排序
  const accountsData = useMemo(() => {
    if (!accountsWithPerformance || accountsWithPerformance.length === 0) {
      return [];
    }
    // 市场优先级排序：US > CA > MX > 其他
    const marketplacePriority: Record<string, number> = {
      'US': 1,
      'CA': 2,
      'MX': 3,
      'UK': 4,
      'DE': 5,
      'FR': 6,
      'IT': 7,
      'ES': 8,
      'JP': 9,
      'AU': 10,
    };
    return [...accountsWithPerformance].sort((a, b) => {
      const priorityA = marketplacePriority[a.marketplace] || 99;
      const priorityB = marketplacePriority[b.marketplace] || 99;
      return priorityA - priorityB;
    });
  }, [accountsWithPerformance]);
  
  // 计算汇总数据
  const summary = useMemo(() => {
    const totalSpend = accountsData.reduce((sum, a) => sum + a.spend, 0);
    const totalSales = accountsData.reduce((sum, a) => sum + a.sales, 0);
    const totalOrders = accountsData.reduce((sum, a) => sum + a.orders, 0);
    const avgAcos = totalSpend > 0 && totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
    const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
    
    // 计算变化（基于各账户的变化加权平均）
    const spendChange = accountsData.length > 0 
      ? accountsData.reduce((sum, a) => sum + (a.change?.spend || 0) * a.spend, 0) / Math.max(totalSpend, 1)
      : 0;
    const salesChange = accountsData.length > 0
      ? accountsData.reduce((sum, a) => sum + (a.change?.sales || 0) * a.sales, 0) / Math.max(totalSales, 1)
      : 0;
    const acosChange = accountsData.length > 0
      ? accountsData.reduce((sum, a) => sum + (a.change?.acos || 0), 0) / accountsData.length
      : 0;
    const roasChange = -acosChange; // ROAS变化与ACoS变化相反
    
    return {
      totalSpend,
      totalSales,
      totalOrders,
      avgAcos,
      avgRoas,
      spendChange,
      salesChange,
      acosChange,
      roasChange
    };
  }, [accountsData]);
  
  // 计算账户健康状态统计
  const healthStats = useMemo(() => {
    const healthy = accountsData.filter(a => a.status === 'healthy').length;
    const warning = accountsData.filter(a => a.status === 'warning').length;
    const critical = accountsData.filter(a => a.status === 'critical').length;
    return { healthy, warning, critical };
  }, [accountsData]);
  
  // 刷新数据
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetchAccounts();
      toast.success('数据已刷新');
    } catch (error) {
      toast.error('刷新失败');
    } finally {
      setIsRefreshing(false);
    }
  };
  
  // 获取状态颜色
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500/20 border-green-500/50';
      case 'warning': return 'bg-yellow-500/20 border-yellow-500/50';
      case 'critical': return 'bg-red-500/20 border-red-500/50';
      default: return 'bg-muted';
    }
  };
  
  // 获取状态图标
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'critical': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return null;
    }
  };
  
  // 格式化变化值
  const formatChange = (value: number) => {
    const prefix = value >= 0 ? '+' : '';
    return `${prefix}${value.toFixed(1)}%`;
  };
  
  // 获取变化颜色（对于ACoS，下降是好的）
  const getChangeColor = (value: number, inverse: boolean = false) => {
    if (inverse) {
      return value <= 0 ? 'text-green-500' : 'text-red-500';
    }
    return value >= 0 ? 'text-green-500' : 'text-red-500';
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题和时间范围选择器 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-primary" />
              数据概览
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              多账户广告数据一览 · <span className="text-primary">数据截至 {endDate}</span> (最后同步: {formatInTimeZone(new Date(), 'America/Los_Angeles', 'MM/dd HH:mm')} PST)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TimeRangeSelector
              value={timeRangeValue}
              onChange={setTimeRangeValue}
              minDataDate={dataDateRange?.minDate ? new Date(dataDateRange.minDate) : undefined}
              maxDataDate={dataDateRange?.maxDate ? new Date(dataDateRange.maxDate) : undefined}
            />
            <Button 
              variant="outline" 
              size="icon"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
        
        {/* 汇总指标卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">总花费</span>
                <DollarSign className="w-4 h-4 text-blue-500" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold">${summary.totalSpend.toFixed(0)}</span>
              </div>
              <div className={`text-xs mt-1 ${getChangeColor(summary.spendChange)}`}>
                <TrendingUp className="w-3 h-3 inline mr-1" />
                {formatChange(summary.spendChange)} vs.上期
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">总销售额</span>
                <ShoppingCart className="w-4 h-4 text-green-500" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold">${summary.totalSales.toFixed(0)}</span>
              </div>
              <div className={`text-xs mt-1 ${getChangeColor(summary.salesChange)}`}>
                <TrendingUp className="w-3 h-3 inline mr-1" />
                {formatChange(summary.salesChange)} vs.上期
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">平均ACoS</span>
                <Percent className="w-4 h-4 text-orange-500" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold">{summary.avgAcos.toFixed(1)}%</span>
              </div>
              <div className={`text-xs mt-1 ${getChangeColor(summary.acosChange, true)}`}>
                <TrendingUp className="w-3 h-3 inline mr-1" />
                {formatChange(summary.acosChange)} vs.上期
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">平均ROAS</span>
                <Target className="w-4 h-4 text-purple-500" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold">{summary.avgRoas.toFixed(2)}</span>
              </div>
              <div className={`text-xs mt-1 ${getChangeColor(summary.roasChange)}`}>
                <TrendingUp className="w-3 h-3 inline mr-1" />
                {formatChange(summary.roasChange)} vs.上期
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 border-cyan-500/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">总订单</span>
                <BarChart3 className="w-4 h-4 text-cyan-500" />
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold">{summary.totalOrders}</span>
              </div>
              <div className={`text-xs mt-1 ${getChangeColor(summary.salesChange)}`}>
                <TrendingUp className="w-3 h-3 inline mr-1" />
                +{summary.totalOrders > 0 ? Math.round(summary.salesChange) : 0} vs.上期
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* 账户状态概览 */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">账户状态</CardTitle>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  健康 {healthStats.healthy}
                </span>
                <span className="flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  警告 {healthStats.warning}
                </span>
                <span className="flex items-center gap-1">
                  <XCircle className="w-4 h-4 text-red-500" />
                  严重 {healthStats.critical}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {accountsData.map((account) => (
                <div 
                  key={account.id}
                  className={`p-4 rounded-lg border ${getStatusColor(account.status)}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{account.name}</span>
                      <Badge variant="outline" className="text-xs">{account.marketplace}</Badge>
                    </div>
                    {account.alerts > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {account.alerts} 警告
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">花费</span>
                      <div className="font-semibold">${account.spend.toFixed(0)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">销售额</span>
                      <div className="font-semibold">${account.sales.toFixed(0)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">ACoS</span>
                      <div className="font-semibold">{account.acos.toFixed(1)}%</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">ROAS</span>
                      <div className="font-semibold">{account.roas.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        
        {/* 趋势图表 */}
        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">花费与销售趋势</CardTitle>
              <CardDescription>近{days}天数据</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis dataKey="date" stroke="#666" />
                    <YAxis stroke="#666" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#1a1a1a', 
                        border: '1px solid #333',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Area 
                      type="monotone" 
                      dataKey="spend" 
                      name="花费" 
                      stroke="#3b82f6" 
                      fillOpacity={1} 
                      fill="url(#colorSpend)" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="sales" 
                      name="销售额" 
                      stroke="#22c55e" 
                      fillOpacity={1} 
                      fill="url(#colorSales)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">ACoS趋势</CardTitle>
              <CardDescription>近{days}天数据</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorAcos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis dataKey="date" stroke="#666" />
                    <YAxis stroke="#666" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#1a1a1a', 
                        border: '1px solid #333',
                        borderRadius: '8px'
                      }}
                      formatter={(value: number) => [`${value.toFixed(1)}%`, 'ACoS']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="acos" 
                      name="ACoS" 
                      stroke="#f59e0b" 
                      fillOpacity={1} 
                      fill="url(#colorAcos)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* 订单趋势 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">订单趋势</CardTitle>
            <CardDescription>近{days}天数据</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="date" stroke="#666" />
                  <YAxis stroke="#666" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#1a1a1a', 
                      border: '1px solid #333',
                      borderRadius: '8px'
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="orders" 
                    name="订单数" 
                    stroke="#06b6d4" 
                    fillOpacity={1} 
                    fill="url(#colorOrders)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        
        {/* 快捷操作 */}
        <div className="grid md:grid-cols-4 gap-4">
          <Link href="/optimization-center">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Brain className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="font-semibold">智能优化中心</div>
                  <div className="text-sm text-muted-foreground">自动优化广告</div>
                </div>
                <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          
          <Link href="/strategy">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <Target className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <div className="font-semibold">策略管理</div>
                  <div className="text-sm text-muted-foreground">配置优化策略</div>
                </div>
                <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          
          <Link href="/campaigns">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <div className="font-semibold">广告活动</div>
                  <div className="text-sm text-muted-foreground">管理广告活动</div>
                </div>
                <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          
          <Link href="/reports">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <div className="font-semibold">数据分析</div>
                  <div className="text-sm text-muted-foreground">查看详细报告</div>
                </div>
                <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function Home() {
  const { user, loading: isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  
  return user ? <DashboardContent /> : <MarketingPage />;
}
