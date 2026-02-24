import { useAuth } from "@/_core/hooks/useAuth";
import { EnhancedMetricCard, TacosMetricCard } from "@/components/EnhancedMetricCard";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useEffect, useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { PageMeta, PAGE_META_CONFIG } from "@/components/PageMeta";
import { useIsMobile } from "@/hooks/useMobile";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { safeParseDate } from '@/lib/safeDate';
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
import { getAllPosts } from "@/data/blogPosts";
import { TimeRangeSelector, TimeRangeValue, getDefaultTimeRangeValue, TIME_RANGE_PRESETS, PresetTimeRange } from "@/components/TimeRangeSelector";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
// v187: 已删除generateLast7DaysData和generateAccountsData模拟数据生成器
// 所有数据均通过真实API获取（trpc.adAccount.getDailyTrend / trpc.adAccount.listWithPerformance）

// 营销页面组件（未登录时显示）
function MarketingPage() {
  useEffect(() => {
    document.title = "亚马逊广告智能优化系统 - Amazon Ads Optimizer";
  }, []);

  // 算法工作原理数据
  const algorithmSteps = [
    {
      step: 1,
      title: "三层分频数据同步",
      description: "采用高频(15分钟)、中频(30分钟)、低频(1小时)三层分频策略，实时同步Amazon Ads API数据，确保广告活动状态、竞价和绩效数据始终保持最新。",
      icon: Search,
      details: ["SP/SB/SD全类型覆盖", "多站点多账户聚合", "60天历史数据回溯"]
    },
    {
      step: 2,
      title: "NextGen多算法决策",
      description: "NextGen引擎自动为每个关键词选择最优算法：CQL离线强化学习、Sigmoid曲线拟合、LinUCB上下文赌博机，或多算法Ensemble融合，无需人工干预。",
      icon: Brain,
      details: ["Meta-Learning自动选择", "Thompson Sampling探索", "三层降级保障"]
    },
    {
      step: 3,
      title: "智能分时分位置倾斜",
      description: "基于时区感知的消费者行为分析，识别高投产的时间段和广告位置，自动向高转化时段和位置倾斜竞价和预算，最大化每一分广告花费的回报。",
      icon: Calculator,
      details: ["本地时区购物高峰识别", "位置倾斜比例优化", "搜索词自动迁移"]
    },
    {
      step: 4,
      title: "闭环执行与纠错",
      description: "优化结果实时传递给Amazon并同步回数据库，内置自动纠错监控，确保数据一致性。渐进式调整策略保障安全，异常检测机制实时告警。",
      icon: RefreshCw,
      details: ["双向数据同步保障", "自动纠错引擎", "渐进式安全调整"]
    }
  ];

  // 核心算法特性 - NextGen六大核心引擎
  const coreFeatures = [
    {
      icon: Brain,
      title: "CQL离线强化学习",
      subtitle: "从历史数据中学习最优策略",
      description: "采用Conservative Q-Learning算法，从海量历史出价和转化数据中离线训练决策模型。无需在线试错即可学习最优出价策略，避免了传统A/B测试的高昂成本和时间消耗。",
      benefits: ["从50+条历史记录自动训练", "避免在线试错的预算浪费", "持续迭代越用越精准"]
    },
    {
      icon: BarChart3,
      title: "Sigmoid曲线拟合",
      subtitle: "精准建模出价-曝光关系",
      description: "为每个关键词独立拟合Sigmoid曲线，精确建模出价与曝光量之间的非线性关系。在曲线的边际收益最大化点确定最优出价，实现利润最大化而非简单的ACoS达标。",
      benefits: ["每个关键词独立建模", "利润最大化出价点", "识别出价饱和区间"]
    },
    {
      icon: Target,
      title: "LinUCB上下文赌博机",
      subtitle: "结合上下文特征智能探索",
      description: "将关键词的竞争度、历史CTR、转化率、时间特征等上下文信息融入决策，在探索新机会和利用已知高效策略之间实现最优平衡。数据不足的关键词也能获得合理的出价建议。",
      benefits: ["多维特征智能决策", "探索-利用最优平衡", "新关键词保护策略"]
    },
    {
      icon: Layers,
      title: "Meta-Learning算法选择",
      subtitle: "Thompson Sampling自动择优",
      description: "采用Thompson Sampling策略，根据每个算法在不同场景下的历史表现，自动为每个关键词选择最适合的算法。数据充足时启用Ensemble多算法融合，数据不足时智能降级到规则引擎。",
      benefits: ["自动选择最优算法", "三层降级安全保障", "算法表现持续追踪"]
    },
    {
      icon: Globe,
      title: "时区感知分时分位置",
      subtitle: "本地化消费者行为分析",
      description: "根据不同站点的本地时区分析消费者购买行为，识别高投产的时间段和广告位置。自动向高转化时段和位置倾斜竞价和预算，对低投产时段减少花费，最大化广告回报。",
      benefits: ["准确识别购物高峰时段", "智能位置倾斜比例", "跨站点策略差异化"]
    },
    {
      icon: Clock,
      title: "三层分频实时同步",
      subtitle: "15分钟级数据新鲜度",
      description: "采用高频(15分钟)、中频(30分钟)、低频(1小时)三层分频同步策略。广告状态和预算每15分钟更新，关键词和定位每30分钟同步，确保优化决策始终基于最新数据。",
      benefits: ["15分钟级数据更新", "双向同步数据一致", "24/7全天候运营"]
    }
  ];

  // 效果数据展示
  const performanceMetrics = [
    { label: "平均ACoS降低", value: "23%", trend: "down", color: "text-green-500" },
    { label: "广告销售额提升", value: "35%", trend: "up", color: "text-blue-500" },
    { label: "数据同步频率", value: "15min", trend: "up", color: "text-cyan-500" },
    { label: "运营时间节省", value: "90%", trend: "up", color: "text-purple-500" }
  ];

  // FAQ数据
  const faqs = [
    {
      question: "系统支持哪些类型的Amazon广告？",
      answer: "支持Sponsored Products (SP)、Sponsored Brands (SB)和Sponsored Display (SD)三种广告类型，覆盖Amazon广告的全部主流形式。系统会针对每种广告类型的特点采用不同的优化策略。"
    },
    {
      question: "NextGen算法是如何工作的？",
      answer: "NextGen是我们自主研发的下一代出价引擎，采用三层降级架构：数据充足时自动启用CQL强化学习、Sigmoid曲线拟合或LinUCB上下文赌博机等高级算法；数据不足时智能降级到基于规则的可靠决策；极端情况下采用保守策略兜底。Meta-Learning选择器会自动为每个关键词选择最优算法，无需人工干预。"
    },
    {
      question: "数据同步频率是多少？如何保证数据一致性？",
      answer: "系统采用三层分频同步策略：广告活动状态和预算每15分钟同步一次，广告组和关键词每30分钟同步，完整数据每1小时全量同步。优化调整会实时传递给Amazon并同步回数据库，内置自动纠错引擎确保数据双向一致。"
    },
    {
      question: "如何保证优化不会导致广告效果下降？",
      answer: "系统采用多层安全保障：NextGen引擎内置渐进式调整策略，单次出价变化不超过30%；Meta-Learning会持续追踪每个算法的表现，自动降级表现不佳的算法；异常检测机制实时监控，发现效果异常立即告警并暂停优化。"
    },
    {
      question: "支持多站点多账户管理吗？",
      answer: "支持。您可以在一个账户下管理多个Amazon卖家账户和多个站点（US、CA、MX、UK、DE、FR、IT、ES、JP、AU等），统一查看数据和管理策略。系统会根据每个站点的本地时区和消费者行为模式进行差异化优化。"
    },
    {
      question: "数据安全如何保障？",
      answer: "我们使用Amazon官方的Advertising API进行数据交互，采用OAuth 2.0安全认证。所有数据传输使用HTTPS加密，数据存储符合行业安全标准。系统部署在AWS云平台，享有企业级安全保障。"
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
              <span>NextGen下一代智能优化引擎</span>
            </div>
            <h1 className="text-4xl lg:text-6xl font-bold tracking-tight mb-6">
              AI驱动的
              <span className="text-primary">亚马逊广告优化</span>
            </h1>
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed max-w-3xl">
              基于<strong className="text-foreground">CQL离线强化学习</strong>、<strong className="text-foreground">Sigmoid曲线拟合</strong>和<strong className="text-foreground">Meta-Learning算法自动选择</strong>，
              结合三层分频实时数据同步，实现广告竞价、预算、分时分位置的全自动智能优化。
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
            <Badge variant="outline" className="mb-4">NextGen核心技术</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">六大核心算法引擎</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              NextGen下一代出价引擎，融合强化学习、曲线拟合与元学习，为每个关键词自动选择最优策略
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
                  aspect: "出价决策算法",
                  traditional: "固定规则或单一算法，所有关键词一视同仁",
                  ours: "NextGen多算法融合，Meta-Learning自动为每个关键词选择最优算法"
                },
                {
                  aspect: "数据同步频率",
                  traditional: "每天同步一次，数据严重滞后",
                  ours: "三层分频同步（15分钟/30分钟/1小时），数据始终新鲜"
                },
                {
                  aspect: "学习与进化",
                  traditional: "静态规则，不会从历史数据中学习",
                  ours: "CQL强化学习+Sigmoid曲线拟合，持续从数据中进化"
                },
                {
                  aspect: "分时分位置优化",
                  traditional: "使用UTC时间，忽略本地消费者行为",
                  ours: "时区感知，智能识别高投产时段和位置并自动倾斜"
                },
                {
                  aspect: "安全保障",
                  traditional: "缺乏降级机制，算法失效时无兜底",
                  ours: "三层降级架构（高级算法→规则引擎→保守策略），永不失控"
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

      {/* Blog Section */}
      <section className="py-24 bg-gradient-to-b from-background to-card/30">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4">知识库</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">广告优化博客</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              探索亚马逊广告优化的最新策略、算法解析和成功案例
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            {getAllPosts().slice(0, 6).map((post) => (
              <Link key={post.id} href={`/blog/${post.slug}`}>
                <Card className="overflow-hidden hover:shadow-lg transition-all duration-300 group cursor-pointer h-full">
                  <div className="relative aspect-video overflow-hidden">
                    <img
                      src={post.coverImage}
                      alt={post.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <Badge className="absolute top-3 left-3 bg-primary/90">
                      {post.category === 'algorithm' ? '算法解析' : post.category === 'case-study' ? '客户案例' : '教程'}
                    </Badge>
                  </div>
                  <CardContent className="p-5">
                    <h3 className="text-lg font-semibold mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                      {post.title}
                    </h3>
                    <p className="text-muted-foreground text-sm mb-4 line-clamp-2">
                      {post.excerpt}
                    </p>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {post.readingTime}分钟阅读
                      </span>
                      <span>{post.publishedAt}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <div className="text-center">
            <Button variant="outline" size="lg" asChild>
              <Link href="/blog">
                查看更多文章
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
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
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">让NextGen引擎优化您的广告</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              立即登录，连接您的Amazon Ads账户，让NextGen下一代AI引擎帮您实现广告效果的持续提升
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
              © 2025 Amazon Ads Optimizer. 专注于亚马逊广告智能优化。
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
  const [timeRangeValue, setTimeRangeValue] = useState<TimeRangeValue>(getDefaultTimeRangeValue('today'));
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
  
  // 图表数据：仅使用真实API数据，无数据时返回空数组
  const chartData = useMemo(() => {
    if (trendData && trendData.length > 0) {
      return trendData;
    }
    return [];
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

  const isMobile = useIsMobile();

  // 下拉刷新处理函数
  const handlePullRefresh = async () => {
    await handleRefresh();
  };

  return (
    <DashboardLayout>
      <PageMeta {...PAGE_META_CONFIG.dashboard} />
      <PullToRefresh onRefresh={handlePullRefresh} className="h-full">
      <div className="space-y-6">
        {/* 页面标题和时间范围选择器 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
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
              minDataDate={dataDateRange?.minDate ? safeParseDate(dataDateRange.minDate) : undefined}
              maxDataDate={dataDateRange?.maxDate ? safeParseDate(dataDateRange.maxDate) : undefined}
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
        
        {/* 汇总指标卡片 - 使用增强版组件 */}
        <div className={`grid gap-4 ${isMobile ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6'}`}>
          <EnhancedMetricCard
            title="总花费"
            value={`$${summary.totalSpend.toFixed(0)}`}
            icon={<DollarSign className="w-4 h-4 text-blue-500" />}
            change={summary.spendChange}
            sparklineData={(trendData || []).map(d => ({ value: d.spend }))}
            isRealtime={true}
            realtimeDelay="<5分钟"
            gradientFrom="blue-500"
            gradientTo="blue-600"
            borderColor="blue-500"
          />
          
          <EnhancedMetricCard
            title="总销售额"
            value={`$${summary.totalSales.toFixed(0)}`}
            icon={<ShoppingCart className="w-4 h-4 text-green-500" />}
            change={summary.salesChange}
            sparklineData={(trendData || []).map(d => ({ value: d.sales }))}
            isRealtime={true}
            realtimeDelay="<5分钟"
            gradientFrom="green-500"
            gradientTo="green-600"
            borderColor="green-500"
          />
          
          <EnhancedMetricCard
            title="平均ACoS"
            value={`${summary.avgAcos.toFixed(1)}%`}
            icon={<Percent className="w-4 h-4 text-orange-500" />}
            change={summary.acosChange}
            isInverse={true}
            sparklineData={(trendData || []).map(d => ({ value: d.acos }))}
            gradientFrom="orange-500"
            gradientTo="orange-600"
            borderColor="orange-500"
          />
          
          <EnhancedMetricCard
            title="平均ROAS"
            value={summary.avgRoas.toFixed(2)}
            icon={<Target className="w-4 h-4 text-purple-500" />}
            change={summary.roasChange}
            gradientFrom="purple-500"
            gradientTo="purple-600"
            borderColor="purple-500"
          />
          
          <TacosMetricCard
            adSpend={summary.totalSpend}
            totalSales={summary.totalSales * 1.5}
            change={summary.acosChange * 0.7}
            isRealtime={true}
          />
          
          <EnhancedMetricCard
            title="总订单"
            value={summary.totalOrders.toString()}
            icon={<BarChart3 className="w-4 h-4 text-cyan-500" />}
            change={summary.salesChange}
            gradientFrom="cyan-500"
            gradientTo="cyan-600"
            borderColor="cyan-500"
          />
        </div>
        
        {/* 账户状态概览 */}
        <Card>
          <CardHeader className="pb-2">
            <div className={`flex ${isMobile ? 'flex-col gap-2' : 'items-center justify-between'}`}>
              <CardTitle className="text-lg">账户状态</CardTitle>
              <div className={`flex items-center ${isMobile ? 'gap-3 text-xs' : 'gap-4 text-sm'}`}>
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
            <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'md:grid-cols-2 lg:grid-cols-3'}`}>
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
        <div className={`grid gap-6 ${isMobile ? 'grid-cols-1' : 'lg:grid-cols-2'}`}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">花费与销售趋势</CardTitle>
              <CardDescription>近{days}天数据</CardDescription>
            </CardHeader>
            <CardContent>
              <div className={isMobile ? 'h-[200px]' : 'h-[300px]'}>
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
              <div className={isMobile ? 'h-[200px]' : 'h-[300px]'}>
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
                      formatter={((value: number) => [`${value.toFixed(1)}%`, 'ACoS']) as any}
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
          <Link href="/strategy-center">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Brain className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="font-semibold">策略管理</div>
                  <div className="text-sm text-muted-foreground">管理优化目标</div>
                </div>
                <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          
          <Link href="/auto-correction">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <Target className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <div className="font-semibold">纠错监控</div>
                  <div className="text-sm text-muted-foreground">查看优化状态</div>
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
          
          <Link href="/amazon-api">
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <div className="font-semibold">Amazon API</div>
                  <div className="text-sm text-muted-foreground">管理API连接</div>
                </div>
                <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
      </PullToRefresh>
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
