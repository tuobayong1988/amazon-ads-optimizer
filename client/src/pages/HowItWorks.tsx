import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getLoginUrl } from "@/const";
import PublicLayout from "@/components/PublicLayout";
import {
  ArrowRight,
  Brain,
  Swords,
  CheckCircle2,
  XCircle,
  Target,
  BarChart3,
  RefreshCw,
  Globe,
  Clock,
  Search,
  Layers,
  Calculator,
  Radar,
  Scale,
  Telescope,
  ShieldCheck,
  Crosshair,
  Orbit,
} from "lucide-react";

// NextGen ML引擎数据
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

// GTO博弈论引擎数据
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

// 五步流程
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

// 技术对比
const comparisons = [
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
];

export default function HowItWorks() {
  useEffect(() => {
    document.title = "优化逻辑 - PPC Optimizer";
  }, []);

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-background to-amber-500/5" />
        <div className="relative container text-center">
          <Badge variant="outline" className="mb-4">双层12引擎架构</Badge>
          <h1 className="text-4xl lg:text-5xl font-bold mb-6">NextGen-GTO 优化逻辑</h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-8">
            第一层机器学习引擎计算基础出价，第二层博弈论引擎进行竞争环境修正，双层协同输出最优出价
          </p>
          {/* 架构流程图 */}
          <div className="flex items-center justify-center gap-4 px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-500/10 via-amber-500/10 to-green-500/10 border border-border/50 max-w-2xl mx-auto">
            <span className="text-sm font-medium text-blue-500">NextGen 基础出价</span>
            <ArrowRight className="w-5 h-5 text-muted-foreground" />
            <Swords className="w-6 h-6 text-amber-500" />
            <ArrowRight className="w-5 h-5 text-muted-foreground" />
            <span className="text-sm font-medium text-amber-500">GTO修正 (0.6~1.4)</span>
            <ArrowRight className="w-5 h-5 text-muted-foreground" />
            <span className="text-sm font-medium text-green-500">最终出价</span>
          </div>
        </div>
      </section>

      {/* 五步流程 */}
      <section className="py-24 bg-card/30">
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
                      <Badge key={j} variant="secondary" className="text-xs">{detail}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 第一层：NextGen ML引擎 */}
      <section className="py-24">
        <div className="container">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Brain className="w-6 h-6 text-blue-500" />
            </div>
            <div>
              <h2 className="text-2xl lg:text-3xl font-bold">第一层：NextGen 机器学习引擎</h2>
              <p className="text-muted-foreground">基于强化学习、曲线拟合与元学习，为每个关键词计算基础出价</p>
            </div>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {mlEngines.map((engine, i) => (
              <Card key={i} className="bg-card/50 border-blue-500/20 hover:border-blue-500/50 transition-colors group">
                <CardHeader>
                  <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-4 group-hover:bg-blue-500/20 transition-colors">
                    <engine.icon className="w-6 h-6 text-blue-500" />
                  </div>
                  <CardTitle className="text-lg">{engine.title}</CardTitle>
                  <CardDescription>{engine.subtitle}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">{engine.description}</p>
                  <ul className="space-y-2">
                    {engine.benefits.map((benefit, j) => (
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
      </section>

      {/* 连接箭头 */}
      <div className="flex items-center justify-center py-8 bg-card/30">
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

      {/* 第二层：GTO博弈论引擎 */}
      <section className="py-24 bg-card/30">
        <div className="container">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-12 h-12 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Swords className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <h2 className="text-2xl lg:text-3xl font-bold">第二层：GTO 博弈论修正引擎</h2>
              <p className="text-muted-foreground">基于博弈论最优策略(GTO)，从竞争环境、期望价值、风控等维度修正基础出价</p>
            </div>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {gtoEngines.map((engine, i) => (
              <Card key={i} className="bg-card/50 border-amber-500/20 hover:border-amber-500/50 transition-colors group">
                <CardHeader>
                  <div className="w-12 h-12 rounded-lg bg-amber-500/10 flex items-center justify-center mb-4 group-hover:bg-amber-500/20 transition-colors">
                    <engine.icon className="w-6 h-6 text-amber-500" />
                  </div>
                  <CardTitle className="text-lg">{engine.title}</CardTitle>
                  <CardDescription>{engine.subtitle}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">{engine.description}</p>
                  <ul className="space-y-2">
                    {engine.benefits.map((benefit, j) => (
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
      </section>

      {/* 技术对比 */}
      <section className="py-24">
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
              {comparisons.map((item, i) => (
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

      {/* CTA */}
      <section className="py-24 bg-card/30">
        <div className="container">
          <div className="max-w-4xl mx-auto text-center bg-gradient-to-br from-primary/10 via-primary/5 to-transparent rounded-3xl p-12 border border-primary/20">
            <Swords className="w-12 h-12 text-primary mx-auto mb-6" />
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">体验NextGen-GTO引擎</h2>
            <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
              立即登录，连接您的Amazon Ads账户，让博弈论驱动的双层12引擎帮您在竞争中赢得每一次出价决策
            </p>
            <Button size="lg" asChild>
              <a href={getLoginUrl()}>
                免费开始使用
                <ArrowRight className="ml-2 h-5 w-5" />
              </a>
            </Button>
            <p className="text-sm text-muted-foreground mt-6">
              无需信用卡 · 双层12引擎即刻启动 · 随时取消
            </p>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
