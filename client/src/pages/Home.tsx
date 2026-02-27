import { useAuth } from "@/_core/hooks/useAuth";
import { EnhancedMetricCard, TacosMetricCard } from "@/components/EnhancedMetricCard";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
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
  Lightbulb,
  GripVertical,
  Swords,
  Crosshair,
  Radar,
  Gauge,
  Flame,
  Scale,
  ScanEye,
  ShieldCheck,
  Trophy,
  Crown,
  Orbit,
  Telescope
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
  Legend,
  ComposedChart,
  Line,
  Bar,
  BarChart,
  ReferenceLine
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Progress } from "@/components/ui/progress";
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
    document.title = "NextGen-GTO 博弈论驱动的亚马逊广告智能优化 - Amazon Ads Optimizer";
  }, []);

  // 算法工作原理数据 - v237: NextGen-GTO五步流程
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
      title: "GTO博弈论修正",
      description: "六大GTO引擎对NextGen基础出价进行博弈论修正：感知竞争环境、计算期望价值、识别探索机会、分配预算池、捕捉竞争窗口、平衡关键词组合，输出最优修正系数。",
      icon: Swords,
      details: ["竞争环境动态感知", "期望价值(EV)出价", "关键词组合平衡"]
    },
    {
      step: 4,
      title: "智能分时分位置倾斜",
      description: "基于时区感知的消费者行为分析，识别高投产的时间段和广告位置，自动向高转化时段和位置倾斜竞价和预算，最大化每一分广告花费的回报。",
      icon: Calculator,
      details: ["本地时区购物高峰识别", "位置倾斜比例优化", "搜索词自动迁移"]
    },
    {
      step: 5,
      title: "闭环执行与纠错",
      description: "优化结果实时传递给Amazon并同步回数据库，内置自动纠错监控和风险行动引擎，确保数据一致性。渐进式调整策略保障安全，异常检测机制实时告警。",
      icon: RefreshCw,
      details: ["双向数据同步保障", "自动纠错引擎", "风险行动自动触发"]
    }
  ];

  // v237: NextGen-GTO双层引擎体系 — 6个ML基础引擎 + 6个GTO博弈引擎
  const mlEngines = [
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

  // v237: GTO博弈论引擎 — 六大博弈策略引擎
  const gtoEngines = [
    {
      icon: Radar,
      title: "竞争环境感知引擎",
      subtitle: "实时识别竞争对手行为模式",
      description: "借鉴扑克中的对手分类策略，通过分析CPC波动、曝光份额变化和竞争密度，将竞争环境动态分类为疯狂型、紧缩型、被动型或中性型，并据此调整出价策略。",
      benefits: ["4种竞争环境自动识别", "竞争密度实时监测", "对手行为模式追踪"]
    },
    {
      icon: Scale,
      title: "动态EV出价引擎",
      subtitle: "基于期望价值计算最优出价",
      description: "将扑克中的底池赔率和隐含赔率概念应用于广告出价。为每个关键词计算每次点击的期望价值(EV)和盈亏平衡出价，只在EV为正时加注，EV为负时果断弃牌。",
      benefits: ["每次点击EV精确计算", "盈亏平衡出价自动推导", "加注/跟注/弃牌智能决策"]
    },
    {
      icon: Telescope,
      title: "探索性投资引擎",
      subtitle: "对潜力关键词进行脉冲式探测",
      description: "借鉴扑克中的半诈唬策略，对数据不足但有潜力的'听牌型'关键词进行小幅脉冲式加注探测。以可控的成本验证关键词潜力，避免过早放弃可能的高价值机会。",
      benefits: ["冷启动关键词智能探测", "听牌型关键词脉冲加注", "探测成本严格可控"]
    },
    {
      icon: ShieldCheck,
      title: "预算分池与风控引擎",
      subtitle: "80/20分池策略与ACoS熔断机制",
      description: "借鉴扑克中的资金管理策略，将预算分为80%核心池和20%探索池。核心池保护已验证的高ROI关键词，探索池用于测试新机会。当ACoS超过目标2倍时自动触发熔断保护。",
      benefits: ["80/20预算分池管理", "ACoS熔断自动保护", "核心利润永不受损"]
    },
    {
      icon: Crosshair,
      title: "竞争窗口打击引擎",
      subtitle: "捕捉并利用每日弱竞争时段",
      description: "借鉴扑克中的位置攻击策略，分析每日24小时的竞争强度变化，识别竞争对手退出或减弱的时间窗口，在这些窗口中加大投放力度，以更低的CPC获取更多高质量流量。",
      benefits: ["弱竞争窗口自动识别", "低CPC高效获客", "竞争高峰智能收缩"]
    },
    {
      icon: Orbit,
      title: "关键词组合平衡器",
      subtitle: "全局视角优化关键词投资组合",
      description: "借鉴扑克中的范围平衡策略，将关键词分为利润核心、流量驱动、品牌防御、长尾探索和新词探索五种角色，确保投资组合在进攻与防守之间保持最优平衡。",
      benefits: ["5种关键词角色分配", "攻守平衡自动调节", "全局投资组合优化"]
    }
  ];

  // 合并为coreFeatures供向后兼容
  const coreFeatures = mlEngines;

  // v237: 效果数据展示 - 更新为GTO体系指标
  const performanceMetrics = [
    { label: "平均ACoS降低", value: "23%", trend: "down", color: "text-green-500" },
    { label: "广告销售额提升", value: "35%", trend: "up", color: "text-blue-500" },
    { label: "GTO引擎数量", value: "12", trend: "up", color: "text-amber-500" },
    { label: "运营时间节省", value: "90%", trend: "up", color: "text-purple-500" }
  ];

  // v237: FAQ数据 - 更新为NextGen-GTO体系
  const faqs = [
    {
      question: "系统支持哪些类型的Amazon广告？",
      answer: "支持Sponsored Products (SP)、Sponsored Brands (SB)和Sponsored Display (SD)三种广告类型，覆盖Amazon广告的全部主流形式。系统会针对每种广告类型的特点采用不同的优化策略。"
    },
    {
      question: "NextGen-GTO算法是如何工作的？",
      answer: "NextGen-GTO是我们自主研发的博弈论驱动广告优化引擎，采用双层12引擎架构。第一层是NextGen机器学习层，包含CQL强化学习、Sigmoid曲线拟合、LinUCB上下文赌博机等高级算法，为每个关键词计算基础出价。第二层是GTO博弈论修正层，包含竞争环境感知、动态EV出价、探索性投资、预算分池风控、竞争窗口打击和关键词组合平衡六大引擎，对基础出价进行博弈论修正。两层协同工作，输出最终的最优出价。"
    },
    {
      question: "什么是GTO博弈论优化？它和传统优化有什么区别？",
      answer: "GTO (Game Theory Optimal) 是博弈论中的最优策略概念。传统广告优化只关注关键词自身的表现数据，而GTO优化将广告竞价视为一场多方博弈：它会感知竞争对手的行为模式、计算每次点击的期望价值、识别竞争薄弱的时间窗口、平衡整体关键词投资组合。这种全局博弈视角能够在复杂的竞争环境中找到更优的出价策略。"
    },
    {
      question: "数据同步频率是多少？如何保证数据一致性？",
      answer: "系统采用三层分频同步策略：广告活动状态和预算每15分钟同步一次，广告组和关键词每30分钟同步，完整数据每1小时全量同步。优化调整会实时传递给Amazon并同步回数据库，内置自动纠错引擎确保数据双向一致，同步成功率始终保持在100%。"
    },
    {
      question: "如何保证优化不会导致广告效果下降？",
      answer: "系统采用多层安全保障：NextGen引擎内置渐进式调整策略，单次出价变化不超过30%；GTO修正系数被严格限制在0.6~1.4的安全边界内；预算分池引擎将80%预算锁定在已验证的高ROI关键词上；ACoS熔断机制在超标时自动冻结探索池；Meta-Learning会持续追踪每个算法的表现，自动降级表现不佳的算法。"
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
              <Swords className="w-4 h-4" />
              <span>NextGen-GTO 博弈论驱动的智能优化引擎</span>
            </div>
            <h1 className="text-4xl lg:text-6xl font-bold tracking-tight mb-6">
              博弈论驱动的
              <span className="text-primary">亚马逊广告优化</span>
            </h1>
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed max-w-3xl">
              融合<strong className="text-foreground">机器学习</strong>与<strong className="text-foreground">博弈论(GTO)</strong>的双层12引擎架构。
              NextGen层提供CQL强化学习、Sigmoid曲线拟合等AI出价能力，GTO层注入竞争环境感知、期望价值出价、关键词组合平衡等博弈策略，
              实现广告竞价、预算、分时分位置的全自动智能优化。
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

      {/* v237: 双层引擎架构 Section */}
      <section className="py-24 bg-card/30">
        <div className="container">
          {/* 架构总览 */}
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4">双层12引擎架构</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">NextGen-GTO 双层智能引擎</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              第一层机器学习引擎计算基础出价，第二层博弈论引擎进行竞争环境修正，双层协同输出最优出价
            </p>
          </div>

          {/* 第一层: NextGen ML引擎 */}
          <div className="mb-16">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Brain className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold">第一层：NextGen 机器学习引擎</h3>
                <p className="text-sm text-muted-foreground">基于强化学习、曲线拟合与元学习，为每个关键词计算基础出价</p>
              </div>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {mlEngines.map((feature, i) => (
                <Card key={i} className="bg-card/50 border-blue-500/20 hover:border-blue-500/50 transition-colors group">
                  <CardHeader>
                    <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-4 group-hover:bg-blue-500/20 transition-colors">
                      <feature.icon className="w-6 h-6 text-blue-500" />
                    </div>
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                    <CardDescription>{feature.subtitle}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">{feature.description}</p>
                    <ul className="space-y-2">
                      {feature.benefits.map((benefit, j) => (
                        <li key={j} className="flex items-center gap-2 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-blue-500 flex-shrink-0" />
                          <span>{benefit}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* 连接箭头 */}
          <div className="flex items-center justify-center my-8">
            <div className="flex items-center gap-4 px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-500/10 via-amber-500/10 to-amber-500/10 border border-border/50">
              <span className="text-sm font-medium text-blue-500">基础出价</span>
              <ArrowRight className="w-5 h-5 text-muted-foreground" />
              <Swords className="w-6 h-6 text-amber-500" />
              <ArrowRight className="w-5 h-5 text-muted-foreground" />
              <span className="text-sm font-medium text-amber-500">GTO修正系数 (0.6~1.4)</span>
              <ArrowRight className="w-5 h-5 text-muted-foreground" />
              <span className="text-sm font-medium text-green-500">最终出价</span>
            </div>
          </div>

          {/* 第二层: GTO博弈论引擎 */}
          <div className="mt-16">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Swords className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold">第二层：GTO 博弈论修正引擎</h3>
                <p className="text-sm text-muted-foreground">基于博弈论最优策略(GTO)，从竞争环境、期望价值、风控等维度修正基础出价</p>
              </div>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {gtoEngines.map((feature, i) => (
                <Card key={i} className="bg-card/50 border-amber-500/20 hover:border-amber-500/50 transition-colors group">
                  <CardHeader>
                    <div className="w-12 h-12 rounded-lg bg-amber-500/10 flex items-center justify-center mb-4 group-hover:bg-amber-500/20 transition-colors">
                      <feature.icon className="w-6 h-6 text-amber-500" />
                    </div>
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                    <CardDescription>{feature.subtitle}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">{feature.description}</p>
                    <ul className="space-y-2">
                      {feature.benefits.map((benefit, j) => (
                        <li key={j} className="flex items-center gap-2 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          <span>{benefit}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 工作原理 Section */}
      <section id="how-it-works" className="py-24">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4">工作原理</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">智能优化五步流程</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              从数据采集到AI决策，经博弈论修正后自动执行，形成完整的优化闭环
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-6">
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
                  ours: "NextGen-GTO双层12引擎，ML计算基础出价 + GTO博弈论修正"
                },
                {
                  aspect: "竞争环境感知",
                  traditional: "完全忽略竞争对手行为，只看自身数据",
                  ours: "GTO引擎实时感知竞争环境，自动识别对手行为模式并调整策略"
                },
                {
                  aspect: "出价决策逻辑",
                  traditional: "基于固定规则或简单阈值决策",
                  ours: "基于期望价值(EV)计算，EV为正加注、EV为负弃牌，类似扑克博弈策略"
                },
                {
                  aspect: "预算风控",
                  traditional: "无预算分池，探索新词可能损害核心利润",
                  ours: "80/20预算分池 + ACoS熔断机制，核心利润永不受损"
                },
                {
                  aspect: "关键词组合管理",
                  traditional: "独立优化每个关键词，缺乏全局视角",
                  ours: "关键词组合平衡器，5种角色分配，攻守平衡自动调节"
                },
                {
                  aspect: "安全保障",
                  traditional: "缺乏降级机制，算法失效时无兜底",
                  ours: "三层降级 + GTO安全边界(0.6~1.4) + 预算熔断，永不失控"
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
            <Swords className="w-12 h-12 text-primary mx-auto mb-6" />
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">让NextGen-GTO引擎优化您的广告</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              立即登录，连接您的Amazon Ads账户，让博弈论驱动的双层12引擎帮您在竞争中赢得每一次出价决策
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
              无需信用卡 · 双层12引擎即刻启动 · 随时取消
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
              © 2026 Amazon Ads Optimizer. 博弈论驱动的亚马逊广告智能优化。
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// v233: 重新设计的运营作战指挥中心（登录后显示）
// v234: 卡片ID定义
const DEFAULT_CARD_ORDER = ['kpi-cards', 'system-health', 'trend-chart', 'account-risk', 'sync-health', 'algorithm-effect', 'order-trend', 'quick-actions'];

// v251: 卡片尺寸类型定义 - full-width独占一行，compact并排显示
const CARD_SIZE_TYPE: Record<string, 'full' | 'compact'> = {
  'kpi-cards': 'full',
  'system-health': 'full',  // v261: 系统健康监控卡片
  'trend-chart': 'full',
  'account-risk': 'full',
  'sync-health': 'compact',
  'algorithm-effect': 'compact',
  'order-trend': 'compact',
  'quick-actions': 'compact',
};

// v251: 将卡片按尺寸类型分组为渲染行
// 连续的compact卡片会被合并到同一行的grid中
function groupCardsIntoRows(cardOrder: string[]): { type: 'full' | 'compact-group'; cards: string[] }[] {
  const rows: { type: 'full' | 'compact-group'; cards: string[] }[] = [];
  let currentCompactGroup: string[] = [];
  
  for (const cardId of cardOrder) {
    const sizeType = CARD_SIZE_TYPE[cardId] || 'full';
    if (sizeType === 'full') {
      // 先flush当前compact组
      if (currentCompactGroup.length > 0) {
        rows.push({ type: 'compact-group', cards: [...currentCompactGroup] });
        currentCompactGroup = [];
      }
      rows.push({ type: 'full', cards: [cardId] });
    } else {
      currentCompactGroup.push(cardId);
      // 最多3个compact卡片一行
      if (currentCompactGroup.length >= 3) {
        rows.push({ type: 'compact-group', cards: [...currentCompactGroup] });
        currentCompactGroup = [];
      }
    }
  }
  // flush剩余的compact组
  if (currentCompactGroup.length > 0) {
    rows.push({ type: 'compact-group', cards: [...currentCompactGroup] });
  }
  return rows;
}

function DashboardContent() {
  const { user } = useAuth();
  // v233: 默认显示近7天而非"今天"，让数据有分析价值
  const [timeRangeValue, setTimeRangeValue] = useState<TimeRangeValue>(getDefaultTimeRangeValue('7days'));
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // v234: 卡片顺序状态和持久化
  const [cardOrder, setCardOrder] = useState<string[]>(DEFAULT_CARD_ORDER);
  const [isDragging, setIsDragging] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // 获取用户偏好
  const { data: userPreferences } = trpc.user.getPreferences.useQuery(
    undefined,
    { enabled: !!user }
  );
  
  // 保存用户偏好
  const updatePreferences = trpc.user.updatePreferences.useMutation();
  
  // 从服务器加载卡片顺序
  useEffect(() => {
    if (userPreferences && (userPreferences as any).dashboardCardOrder) {
      const savedOrder = (userPreferences as any).dashboardCardOrder as string[];
      // 确保所有默认卡片都存在（防止新增卡片丢失）
      const mergedOrder = [...savedOrder];
      DEFAULT_CARD_ORDER.forEach(id => {
        if (!mergedOrder.includes(id)) mergedOrder.push(id);
      });
      // 移除已删除的卡片
      const validOrder = mergedOrder.filter(id => DEFAULT_CARD_ORDER.includes(id));
      setCardOrder(validOrder);
    }
  }, [userPreferences]);
  
  // 拖拽结束处理
  const handleDragEnd = useCallback((result: DropResult) => {
    setIsDragging(false);
    if (!result.destination) return;
    const sourceIndex = result.source.index;
    const destIndex = result.destination.index;
    if (sourceIndex === destIndex) return;
    
    const newOrder = [...cardOrder];
    const [removed] = newOrder.splice(sourceIndex, 1);
    newOrder.splice(destIndex, 0, removed);
    setCardOrder(newOrder);
    
    // 防抖保存到服务器
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      updatePreferences.mutate(
        { key: 'dashboardCardOrder', value: newOrder },
        { onSuccess: () => toast.success('布局已保存', { duration: 1500, icon: '✓' }) }
      );
    }, 500);
  }, [cardOrder, updatePreferences]);
  
  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, []);
  
  // 获取数据可用日期范围
  const { data: dataDateRange } = trpc.adAccount.getDataDateRange.useQuery(
    undefined,
    { enabled: !!user }
  );
  
  const days = timeRangeValue.days;
  const startDate = format(timeRangeValue.dateRange.from, 'yyyy-MM-dd');
  const endDate = format(timeRangeValue.dateRange.to, 'yyyy-MM-dd');
  const timeRange = timeRangeValue.preset === 'custom' ? 'custom' : timeRangeValue.preset;
  
  // 获取账户列表及绩效数据
  const { data: accountsWithPerformance, refetch: refetchAccounts } = trpc.adAccount.listWithPerformance.useQuery(
    { timeRange: timeRange as any, days, startDate, endDate },
    { enabled: !!user }
  );
  
  // 获取图表趋势数据
  const { data: trendData } = trpc.adAccount.getDailyTrend.useQuery(
    { days, timeRange: timeRange as any, startDate, endDate },
    { enabled: !!user }
  );
  
  // v233: 获取纠错监控数据
  const { data: correctionDashboard } = trpc.autoCorrection.getDashboard.useQuery(
    undefined,
    { enabled: !!user, refetchInterval: 60000 }
  );
  
  // v233: 获取算法效果统计
  const { data: algorithmStats } = trpc.algorithmEffect.getStats.useQuery(
    { days: 30 },
    { enabled: !!user }
  );
  
  // v261: 获取系统健康核心指标（回滚率 + 算法激活率）
  const selectedAccountId = accountsWithPerformance?.[0]?.id;
  const { data: healthMetrics } = trpc.monitoring.getHealthMetrics.useQuery(
    { accountId: selectedAccountId!, days: 7 },
    { enabled: !!user && !!selectedAccountId, refetchInterval: 5 * 60 * 1000 }
  );
  
  // v261: 获取部署后纠错报告
  const { data: deployCorrectionReport } = trpc.monitoring.getDeployCorrectionReport.useQuery(
    undefined,
    { enabled: !!user, refetchInterval: 10 * 60 * 1000 }
  );
  
  // 图表数据
  const chartData = useMemo(() => {
    if (trendData && trendData.length > 0) return trendData;
    return [];
  }, [trendData]);
  
  // v233: 合并图表数据 - 花费/销售额柱状图 + ACoS折线图
  const combinedChartData = useMemo(() => {
    return chartData.map(d => ({
      ...d,
      profit: d.sales - d.spend,
    }));
  }, [chartData]);
  
  // 按ACoS从高到低排序（风险排行）
  const accountsData = useMemo(() => {
    if (!accountsWithPerformance || accountsWithPerformance.length === 0) return [];
    return [...accountsWithPerformance].sort((a, b) => b.acos - a.acos);
  }, [accountsWithPerformance]);
  
  // 计算汇总数据
  const summary = useMemo(() => {
    const totalSpend = accountsData.reduce((sum, a) => sum + a.spend, 0);
    const totalSales = accountsData.reduce((sum, a) => sum + a.sales, 0);
    const totalOrders = accountsData.reduce((sum, a) => sum + a.orders, 0);
    const avgAcos = totalSpend > 0 && totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
    const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
    const profit = totalSales - totalSpend;
    
    const spendChange = accountsData.length > 0 
      ? accountsData.reduce((sum, a) => sum + (a.change?.spend || 0) * a.spend, 0) / Math.max(totalSpend, 1)
      : 0;
    const salesChange = accountsData.length > 0
      ? accountsData.reduce((sum, a) => sum + (a.change?.sales || 0) * a.sales, 0) / Math.max(totalSales, 1)
      : 0;
    const acosChange = accountsData.length > 0
      ? accountsData.reduce((sum, a) => sum + (a.change?.acos || 0), 0) / accountsData.length
      : 0;
    const roasChange = -acosChange;
    
    return { totalSpend, totalSales, totalOrders, avgAcos, avgRoas, profit, spendChange, salesChange, acosChange, roasChange };
  }, [accountsData]);
  
  // 账户健康统计
  const healthStats = useMemo(() => {
    const healthy = accountsData.filter(a => a.status === 'healthy').length;
    const warning = accountsData.filter(a => a.status === 'warning').length;
    const critical = accountsData.filter(a => a.status === 'critical').length;
    return { healthy, warning, critical, total: accountsData.length };
  }, [accountsData]);
  
  // v235: 同步状态统计 — 修复同步成功率计算
  // 根因: not_applicable 和 invalid_legacy 是不需要同步到Amazon的内部事件（如keyword_create失败记录），
  // 不应计入同步成功率的分母。纠错监控页面已正确排除，首页需要对齐。
  const syncStats = useMemo(() => {
    if (!correctionDashboard?.statusDistribution) return { synced: 0, pending: 0, failed: 0, total: 0, notApplicable: 0 };
    const dist = correctionDashboard.statusDistribution as any[];
    const synced = Number(dist.find((d: any) => d.api_sync_status === 'synced')?.count || 0);
    const pending = Number(dist.find((d: any) => d.api_sync_status === 'pending_sync' || d.api_sync_status === 'pending')?.count || 0);
    const failed = Number(dist.find((d: any) => d.api_sync_status === 'failed')?.count || 0);
    const notApplicable = Number(dist.find((d: any) => d.api_sync_status === 'not_applicable')?.count || 0)
      + Number(dist.find((d: any) => d.api_sync_status === 'invalid_legacy')?.count || 0);
    // v235: total只统计需要同步的事件（synced + pending + failed），排除not_applicable和invalid_legacy
    const syncableTotal = synced + pending + failed;
    return { synced, pending, failed, total: syncableTotal, notApplicable };
  }, [correctionDashboard]);
  
  // v233: 算法使用统计
  const algorithmSummary = useMemo(() => {
    if (!algorithmStats || algorithmStats.length === 0) return { totalOps: 0, avgPositiveRate: 0, bestAlgorithm: '无数据', algorithms: [] };
    const totalOps = algorithmStats.reduce((sum, a) => sum + a.count, 0);
    const avgPositiveRate = algorithmStats.reduce((sum, a) => sum + a.positiveRate * a.count, 0) / Math.max(totalOps, 1);
    const best = [...algorithmStats].sort((a, b) => b.positiveRate - a.positiveRate)[0];
    return { totalOps, avgPositiveRate, bestAlgorithm: best?.algorithm || '无数据', algorithms: algorithmStats };
  }, [algorithmStats]);
  
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
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500/20 border-green-500/50';
      case 'warning': return 'bg-yellow-500/20 border-yellow-500/50';
      case 'critical': return 'bg-red-500/20 border-red-500/50';
      default: return 'bg-muted';
    }
  };
  
  const getAcosColor = (acos: number) => {
    if (acos <= 30) return 'text-green-500';
    if (acos <= 50) return 'text-yellow-500';
    return 'text-red-500';
  };
  
  const getAcosBgColor = (acos: number) => {
    if (acos <= 30) return 'bg-green-500';
    if (acos <= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const isMobile = useIsMobile();

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
              <Activity className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              运营指挥中心
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {startDate} ~ {endDate} · 最后同步: {formatInTimeZone(new Date(), 'America/Los_Angeles', 'MM/dd HH:mm')} PST
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
        
        {/* v234: 拖拽卡片布局 / v251: 恢复合理的卡片尺寸布局 */}
        <DragDropContext onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
          <Droppable droppableId="dashboard-cards">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`grid gap-6 ${isMobile ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3'} ${snapshot.isDraggingOver ? 'bg-primary/5 rounded-xl transition-colors' : ''}`}
              >
                {cardOrder.map((cardId, index) => {
                  // v251: full-width卡片跨全列，compact卡片自然流入grid列
                  const sizeType = CARD_SIZE_TYPE[cardId] || 'full';
                  const isFullWidth = sizeType === 'full';
                  
                  return (
                  <Draggable key={cardId} draggableId={cardId} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        className={`group relative cursor-grab active:cursor-grabbing rounded-xl ${isFullWidth && !isMobile ? 'lg:col-span-3' : ''} ${snapshot.isDragging ? 'z-50 opacity-90 shadow-2xl shadow-primary/20 scale-[1.01] ring-2 ring-primary/40' : 'hover:ring-1 hover:ring-border/50'} transition-all duration-200`}
                      >
                        {/* 拖拽指示条 - hover时显示在卡片顶部 */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2 py-1.5 text-xs text-muted-foreground">
                          <GripVertical className="w-3.5 h-3.5" />
                          <span>拖拽调整顺序</span>
                          <GripVertical className="w-3.5 h-3.5" />
                        </div>
                        
                        {/* 卡片内容 */}
                        {cardId === 'kpi-cards' && (
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
                        )}
                        
                        {cardId === 'system-health' && healthMetrics?.success && healthMetrics.metrics && (
                          <Card>
                            <CardHeader className="pb-2">
                              <div className="flex items-center justify-between">
                                <div>
                                  <CardTitle className="text-lg flex items-center gap-2">
                                    <Shield className="w-5 h-5 text-blue-500" />
                                    系统健康监控
                                  </CardTitle>
                                  <CardDescription>v261 核心指标实时追踪</CardDescription>
                                </div>
                                <Badge variant="outline" className="text-xs">
                                  每5分钟刷新
                                </Badge>
                              </div>
                            </CardHeader>
                            <CardContent>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {/* 回滚率 */}
                                <div className={`p-4 rounded-lg border ${
                                  healthMetrics.metrics.rollbackRate.status === 'healthy' 
                                    ? 'border-green-500/30 bg-green-500/5' 
                                    : healthMetrics.metrics.rollbackRate.status === 'warning'
                                    ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-red-500/30 bg-red-500/5'
                                }`}>
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className={`w-2 h-2 rounded-full ${
                                      healthMetrics.metrics.rollbackRate.status === 'healthy' ? 'bg-green-500' :
                                      healthMetrics.metrics.rollbackRate.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                                    }`} />
                                    <span className="text-xs text-muted-foreground">回滚率</span>
                                  </div>
                                  <div className={`text-2xl font-bold ${
                                    healthMetrics.metrics.rollbackRate.status === 'healthy' ? 'text-green-400' :
                                    healthMetrics.metrics.rollbackRate.status === 'warning' ? 'text-yellow-400' : 'text-red-400'
                                  }`}>
                                    {healthMetrics.metrics.rollbackRate.rate.toFixed(1)}%
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                    {healthMetrics.metrics.rollbackRate.trend === 'improving' ? (
                                      <><TrendingDown className="w-3 h-3 text-green-500" /> 改善中</>
                                    ) : healthMetrics.metrics.rollbackRate.trend === 'worsening' ? (
                                      <><TrendingUp className="w-3 h-3 text-red-500" /> 恶化中</>
                                    ) : '稳定'}
                                    <span className="ml-1">(前期: {healthMetrics.metrics.rollbackRate.previousRate.toFixed(1)}%)</span>
                                  </div>
                                </div>
                                {/* 算法激活率 */}
                                <div className={`p-4 rounded-lg border ${
                                  healthMetrics.metrics.algorithmActivation.status === 'healthy'
                                    ? 'border-green-500/30 bg-green-500/5'
                                    : healthMetrics.metrics.algorithmActivation.status === 'warning'
                                    ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-red-500/30 bg-red-500/5'
                                }`}>
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className={`w-2 h-2 rounded-full ${
                                      healthMetrics.metrics.algorithmActivation.status === 'healthy' ? 'bg-green-500' :
                                      healthMetrics.metrics.algorithmActivation.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                                    }`} />
                                    <span className="text-xs text-muted-foreground">高级算法激活率</span>
                                  </div>
                                  <div className={`text-2xl font-bold ${
                                    healthMetrics.metrics.algorithmActivation.status === 'healthy' ? 'text-green-400' :
                                    healthMetrics.metrics.algorithmActivation.status === 'warning' ? 'text-yellow-400' : 'text-red-400'
                                  }`}>
                                    {healthMetrics.metrics.algorithmActivation.advancedRate.toFixed(1)}%
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {Object.entries(healthMetrics.metrics.algorithmActivation.algorithmRates || {}).map(([name, rate]) => `${name}: ${(rate as number).toFixed(0)}%`).join(', ') || '无数据'}
                                  </div>
                                </div>
                                {/* ACoS趋势 */}
                                {(() => {
                                  const acosTrend = healthMetrics.metrics.acosTrend;
                                  const acosStatus = acosTrend.deathSpiralDetected ? 'critical' : acosTrend.direction === 'improving' ? 'healthy' : acosTrend.direction === 'worsening' ? 'warning' : 'healthy';
                                  return (
                                <div className={`p-4 rounded-lg border ${
                                  acosStatus === 'healthy'
                                    ? 'border-green-500/30 bg-green-500/5'
                                    : acosStatus === 'warning'
                                    ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-red-500/30 bg-red-500/5'
                                }`}>
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className={`w-2 h-2 rounded-full ${
                                      acosStatus === 'healthy' ? 'bg-green-500' :
                                      acosStatus === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                                    }`} />
                                    <span className="text-xs text-muted-foreground">ACoS趋势 {acosTrend.deathSpiralDetected ? '⚠️死亡螺旋' : ''}</span>
                                  </div>
                                  <div className={`text-2xl font-bold ${
                                    acosStatus === 'healthy' ? 'text-green-400' :
                                    acosStatus === 'warning' ? 'text-yellow-400' : 'text-red-400'
                                  }`}>
                                    {acosTrend.currentAcos.toFixed(1)}%
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                    {acosTrend.direction === 'improving' ? (
                                      <><TrendingDown className="w-3 h-3 text-green-500" /> 改善中</>
                                    ) : acosTrend.direction === 'worsening' ? (
                                      <><TrendingUp className="w-3 h-3 text-red-500" /> 恶化中</>
                                    ) : '稳定'}
                                    <span className="ml-1">(变化: {acosTrend.changePoints > 0 ? '+' : ''}{acosTrend.changePoints.toFixed(1)}pp)</span>
                                  </div>
                                </div>
                                  );
                                })()}
                                {/* 熔断状态 */}
                                {(() => {
                                  const cbr = healthMetrics.metrics.circuitBreakerRate;
                                  const cbrStatus = cbr.rate < 5 ? 'healthy' : cbr.rate < 20 ? 'warning' : 'critical';
                                  return (
                                <div className={`p-4 rounded-lg border ${
                                  cbrStatus === 'healthy'
                                    ? 'border-green-500/30 bg-green-500/5'
                                    : cbrStatus === 'warning'
                                    ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-red-500/30 bg-red-500/5'
                                }`}>
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className={`w-2 h-2 rounded-full ${
                                      cbrStatus === 'healthy' ? 'bg-green-500' :
                                      cbrStatus === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                                    }`} />
                                    <span className="text-xs text-muted-foreground">熔断率</span>
                                  </div>
                                  <div className={`text-2xl font-bold ${
                                    cbrStatus === 'healthy' ? 'text-green-400' :
                                    cbrStatus === 'warning' ? 'text-yellow-400' : 'text-red-400'
                                  }`}>
                                    {cbr.rate.toFixed(1)}%
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    触发: {cbr.trippedCount} / {cbr.totalDecisions}
                                  </div>
                                </div>
                                  );
                                })()}
                              </div>
                              {/* v261: 部署后纠错报告 */}
                              {deployCorrectionReport?.success && deployCorrectionReport.report?.latestDeploy && (
                                <div className="mt-4 p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium flex items-center gap-2">
                                      <Zap className="w-4 h-4 text-blue-400" />
                                      最近部署纠错报告
                                    </span>
                                    <Badge variant="outline" className="text-xs">
                                      v{deployCorrectionReport.report.latestDeploy.version}
                                    </Badge>
                                  </div>
                                  <div className="grid grid-cols-4 gap-3 text-center">
                                    <div>
                                      <div className="text-lg font-bold text-foreground">{deployCorrectionReport.report.latestDeploy.targetsProcessed}</div>
                                      <div className="text-xs text-muted-foreground">目标处理</div>
                                    </div>
                                    <div>
                                      <div className="text-lg font-bold text-green-400">{deployCorrectionReport.report.latestDeploy.targetsSucceeded}</div>
                                      <div className="text-xs text-muted-foreground">成功</div>
                                    </div>
                                    <div>
                                      <div className="text-lg font-bold text-red-400">{deployCorrectionReport.report.latestDeploy.targetsFailed}</div>
                                      <div className="text-xs text-muted-foreground">失败</div>
                                    </div>
                                    <div>
                                      <div className="text-lg font-bold text-blue-400">{deployCorrectionReport.report.latestDeploy.totalActions}</div>
                                      <div className="text-xs text-muted-foreground">优化动作</div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        )}
                        
                        {cardId === 'trend-chart' && (
                          <Card>
                            <CardHeader className="pb-2">
                              <div className="flex items-center justify-between">
                                <div>
                                  <CardTitle className="text-lg">花费 vs 销售额 vs ACoS 趋势</CardTitle>
                                  <CardDescription>柱状图为花费与销售额，折线为ACoS走势，红色虚线为30%目标线</CardDescription>
                                </div>
                                <div className="flex items-center gap-3 text-xs">
                                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-500 inline-block"></span> 花费</span>
                                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block"></span> 销售额</span>
                                  <span className="flex items-center gap-1"><span className="w-3 h-1 bg-orange-500 inline-block rounded"></span> ACoS</span>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent>
                              <div className={isMobile ? 'h-[280px]' : 'h-[360px]'}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <ComposedChart data={combinedChartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                    <XAxis dataKey="date" stroke="#666" />
                                    <YAxis yAxisId="left" stroke="#666" tickFormatter={(v) => `$${v}`} />
                                    <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
                                    <Tooltip 
                                      contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }}
                                      formatter={(value: number | undefined, name: string) => {
                                        const v = value ?? 0;
                                        if (name === 'ACoS') return [`${v.toFixed(1)}%`, name];
                                        return [`$${v.toFixed(0)}`, name];
                                      }}
                                    />
                                    <ReferenceLine yAxisId="right" y={30} stroke="#ef4444" strokeDasharray="5 5" label={{ value: '目标 30%', position: 'right', fill: '#ef4444', fontSize: 11 }} />
                                    <Bar yAxisId="left" dataKey="spend" name="花费" fill="#3b82f6" fillOpacity={0.8} radius={[2, 2, 0, 0]} />
                                    <Bar yAxisId="left" dataKey="sales" name="销售额" fill="#22c55e" fillOpacity={0.8} radius={[2, 2, 0, 0]} />
                                    <Line yAxisId="right" type="monotone" dataKey="acos" name="ACoS" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3, fill: '#f59e0b' }} />
                                  </ComposedChart>
                                </ResponsiveContainer>
                              </div>
                            </CardContent>
                          </Card>
                        )}
                        
                        {cardId === 'account-risk' && (
                          <Card>
                            <CardHeader className="pb-2">
                              <div className="flex items-center justify-between">
                                <CardTitle className="text-lg flex items-center gap-2">
                                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                                  账户风险排行
                                </CardTitle>
                                <div className="flex items-center gap-3 text-xs">
                                  <span className="flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                                    健康 {healthStats.healthy}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
                                    警告 {healthStats.warning}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <XCircle className="w-3.5 h-3.5 text-red-500" />
                                    严重 {healthStats.critical}
                                  </span>
                                </div>
                              </div>
                              <CardDescription>按ACoS从高到低排列 — 高风险账户将自动触发NextGen算法紧急优化</CardDescription>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-3">
                                {accountsData.map((account, idx) => (
                                  <div 
                                    key={account.id}
                                    className={`p-3 rounded-lg border ${getStatusColor(account.status)} flex items-center gap-4`}
                                  >
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${account.status === 'critical' ? 'bg-red-500/30 text-red-400' : account.status === 'warning' ? 'bg-yellow-500/30 text-yellow-400' : 'bg-green-500/30 text-green-400'}`}>
                                      {idx + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold truncate">{account.name}</span>
                                        <Badge variant="outline" className="text-xs shrink-0">{account.marketplace}</Badge>
                                        {account.status === 'critical' && <Badge variant="destructive" className="text-xs shrink-0 animate-pulse">紧急优化中</Badge>}
                                        {account.status === 'warning' && <Badge variant="outline" className="text-xs shrink-0 border-yellow-500/50 text-yellow-400">自动监控</Badge>}
                                      </div>
                                      <div className="text-xs text-muted-foreground mt-0.5">
                                        花费 ${account.spend.toFixed(0)} · 销售 ${account.sales.toFixed(0)} · {account.orders}单
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <div className={`text-lg font-bold ${getAcosColor(account.acos)}`}>
                                        {account.acos.toFixed(1)}%
                                      </div>
                                      <div className="text-xs text-muted-foreground">ACoS</div>
                                    </div>
                                    <div className="w-20 shrink-0 hidden sm:block">
                                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                                        <div 
                                          className={`h-full rounded-full transition-all ${getAcosBgColor(account.acos)}`}
                                          style={{ width: `${Math.min(account.acos / 100 * 100, 100)}%` }}
                                        />
                                      </div>
                                      <div className="text-xs text-muted-foreground text-center mt-0.5">ROAS {account.roas.toFixed(2)}</div>
                                    </div>
                                  </div>
                                ))}
                                {accountsData.length === 0 && (
                                  <div className="text-center text-muted-foreground py-8">暂无账户数据</div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                        
                        {cardId === 'sync-health' && (
                          <Card className="h-full">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base flex items-center gap-2">
                                <RefreshCw className="w-4 h-4 text-blue-500" />
                                同步健康度
                                {/* v235: 同步状态指示器 */}
                                {syncStats.total > 0 && (
                                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
                                    syncStats.failed > 0 ? 'bg-red-500/20 text-red-400' :
                                    syncStats.pending > 0 ? 'bg-yellow-500/20 text-yellow-400' :
                                    'bg-green-500/20 text-green-400'
                                  }`}>
                                    {syncStats.failed > 0 ? '需要关注' : syncStats.pending > 0 ? '同步中' : '全部同步'}
                                  </span>
                                )}
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">已同步</span>
                                <span className="font-semibold text-green-500">{syncStats.synced.toLocaleString()}</span>
                              </div>
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">待同步</span>
                                <span className={`font-semibold ${syncStats.pending > 0 ? 'text-yellow-500' : 'text-muted-foreground'}`}>{syncStats.pending.toLocaleString()}</span>
                              </div>
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">同步失败</span>
                                <span className={`font-semibold ${syncStats.failed > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>{syncStats.failed.toLocaleString()}</span>
                              </div>
                              {/* v235: 不适用事件数（内部操作，不需要同步到Amazon） */}
                              {syncStats.notApplicable > 0 && (
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">不适用</span>
                                  <span className="font-semibold text-muted-foreground">{syncStats.notApplicable.toLocaleString()}</span>
                                </div>
                              )}
                              {syncStats.total > 0 && (
                                <div>
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="text-muted-foreground">同步成功率</span>
                                    <span className={`font-semibold ${
                                      syncStats.total > 0 && syncStats.synced === syncStats.total ? 'text-green-500' :
                                      syncStats.failed > 0 ? 'text-red-500' : ''
                                    }`}>{((syncStats.synced / syncStats.total) * 100).toFixed(1)}%</span>
                                  </div>
                                  <Progress value={(syncStats.synced / syncStats.total) * 100} className="h-2" />
                                </div>
                              )}
                              {/* v235: 同步异常时显示自动纠错触发提示 */}
                              {(syncStats.failed > 0 || syncStats.pending > 10) && (
                                <div className="pt-2 border-t border-border/50">
                                  <div className="flex items-center gap-2 text-xs">
                                    <Zap className="w-3.5 h-3.5 text-yellow-500" />
                                    <span className="text-yellow-400">系统将自动触发纠错扫描以修复同步异常</span>
                                  </div>
                                </div>
                              )}
                              {correctionDashboard?.lastScan && (
                                <div className="pt-2 border-t border-border/50">
                                  <div className="text-xs text-muted-foreground">最近扫描</div>
                                  <div className="text-xs mt-1">
                                    发现 <span className="text-yellow-500 font-semibold">{correctionDashboard.lastScan.totalIssuesFound}</span> 个问题，
                                    已纠正 <span className="text-green-500 font-semibold">{correctionDashboard.lastScan.totalCorrected}</span> 个
                                  </div>
                                </div>
                              )}
                              <Link href="/auto-correction">
                                <div className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1 pt-1">
                                  查看纠错监控详情 <ArrowRight className="w-3 h-3" />
                                </div>
                              </Link>
                            </CardContent>
                          </Card>
                        )}
                        
                        {cardId === 'algorithm-effect' && (
                          <Card className="h-full">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base flex items-center gap-2">
                                <Brain className="w-4 h-4 text-purple-500" />
                                算法效果概览
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">30天优化操作</span>
                                <span className="font-semibold">{algorithmSummary.totalOps.toLocaleString()} 次</span>
                              </div>
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">平均正向率</span>
                                <span className={`font-semibold ${algorithmSummary.avgPositiveRate >= 50 ? 'text-green-500' : 'text-yellow-500'}`}>
                                  {algorithmSummary.avgPositiveRate.toFixed(1)}%
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">最优算法</span>
                                <Badge variant="outline" className="text-xs">{algorithmSummary.bestAlgorithm}</Badge>
                              </div>
                              {algorithmSummary.algorithms.length > 0 && (
                                <div className="pt-2 border-t border-border/50 space-y-2">
                                  <div className="text-xs text-muted-foreground">各算法表现</div>
                                  {algorithmSummary.algorithms.map((alg) => (
                                    <div key={alg.algorithm} className="flex items-center gap-2">
                                      <span className="text-xs w-24 truncate" title={alg.algorithm}>{alg.algorithm}</span>
                                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                        <div 
                                          className={`h-full rounded-full ${alg.positiveRate >= 60 ? 'bg-green-500' : alg.positiveRate >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                          style={{ width: `${alg.positiveRate}%` }}
                                        />
                                      </div>
                                      <span className="text-xs w-10 text-right">{alg.positiveRate}%</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <Link href="/strategy-center">
                                <div className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1 pt-1">
                                  查看策略管理详情 <ArrowRight className="w-3 h-3" />
                                </div>
                              </Link>
                            </CardContent>
                          </Card>
                        )}
                        
                        {cardId === 'order-trend' && (
                          <Card className="h-full">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-lg">订单趋势</CardTitle>
                              <CardDescription>近{days}天每日订单量</CardDescription>
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
                                    <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }} />
                                    <Area type="monotone" dataKey="orders" name="订单数" stroke="#06b6d4" fillOpacity={1} fill="url(#colorOrders)" />
                                  </AreaChart>
                                </ResponsiveContainer>
                              </div>
                            </CardContent>
                          </Card>
                        )}
                        
                        {cardId === 'quick-actions' && (
                          <Card className="h-full">
                            <CardHeader className="pb-2">
                              <CardTitle className="text-lg">快捷操作</CardTitle>
                              <CardDescription>常用功能入口</CardDescription>
                            </CardHeader>
                            <CardContent>
                              <div className="grid grid-cols-2 gap-3">
                                <Link href="/strategy-center">
                                  <div className="p-3 rounded-lg border border-border/50 hover:border-primary/50 transition-colors cursor-pointer flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                                      <Brain className="w-4 h-4 text-primary" />
                                    </div>
                                    <div>
                                      <div className="font-semibold text-sm">策略管理</div>
                                      <div className="text-xs text-muted-foreground">管理优化目标</div>
                                    </div>
                                  </div>
                                </Link>
                                <Link href="/auto-correction">
                                  <div className="p-3 rounded-lg border border-border/50 hover:border-primary/50 transition-colors cursor-pointer flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center">
                                      <Target className="w-4 h-4 text-green-500" />
                                    </div>
                                    <div>
                                      <div className="font-semibold text-sm">纠错监控</div>
                                      <div className="text-xs text-muted-foreground">查看优化状态</div>
                                    </div>
                                  </div>
                                </Link>
                                <Link href="/campaigns">
                                  <div className="p-3 rounded-lg border border-border/50 hover:border-primary/50 transition-colors cursor-pointer flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                      <BarChart3 className="w-4 h-4 text-blue-500" />
                                    </div>
                                    <div>
                                      <div className="font-semibold text-sm">广告活动</div>
                                      <div className="text-xs text-muted-foreground">管理广告活动</div>
                                    </div>
                                  </div>
                                </Link>
                                <Link href="/amazon-api">
                                  <div className="p-3 rounded-lg border border-border/50 hover:border-primary/50 transition-colors cursor-pointer flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
                                      <FileText className="w-4 h-4 text-purple-500" />
                                    </div>
                                    <div>
                                      <div className="font-semibold text-sm">Amazon API</div>
                                      <div className="text-xs text-muted-foreground">管理API连接</div>
                                    </div>
                                  </div>
                                </Link>
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    )}
                  </Draggable>
                  );
                })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
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
