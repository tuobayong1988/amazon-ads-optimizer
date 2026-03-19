import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getLoginUrl } from "@/const";
import PublicLayout from "@/components/PublicLayout";
import { Link } from "wouter";
import { getAllPosts } from "@/data/blogPosts";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Brain,
  Swords,
  Zap,
  Shield,
  Clock,
  ChevronRight,
  CheckCircle2,
  Target,
  BarChart3,
  RefreshCw,
  Globe,
  Layers,
} from "lucide-react";

// 核心效果数据
const performanceMetrics = [
  { label: "平均ACoS降低", value: "23%", trend: "down" as const, color: "text-green-500" },
  { label: "广告销售额提升", value: "35%", trend: "up" as const, color: "text-blue-500" },
  { label: "GTO引擎数量", value: "12", trend: "up" as const, color: "text-amber-500" },
  { label: "运营时间节省", value: "90%", trend: "up" as const, color: "text-purple-500" },
];

// 核心功能亮点（精简版）
const highlights = [
  {
    icon: Brain,
    title: "NextGen 机器学习引擎",
    description: "CQL强化学习、Sigmoid曲线拟合、LinUCB上下文赌博机等多算法自动择优，为每个关键词计算最优基础出价。",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
  },
  {
    icon: Swords,
    title: "GTO 博弈论修正引擎",
    description: "竞争环境感知、动态EV出价、预算分池风控等六大博弈策略引擎，从竞争维度修正出价，在博弈中赢得每一次决策。",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
  },
  {
    icon: Shield,
    title: "多层安全保障体系",
    description: "渐进式调整（单次不超30%）、GTO安全边界（0.6~1.4）、80/20预算分池、ACoS熔断机制，确保广告投放永不失控。",
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/20",
  },
  {
    icon: RefreshCw,
    title: "闭环执行与自动纠错",
    description: "15分钟级三层分频数据同步，内置自动纠错引擎和部署后重优化机制，确保优化决策始终基于最新数据和最新算法。",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/20",
  },
];

// 支持的广告类型
const adTypes = [
  { abbr: "SP", name: "Sponsored Products", desc: "商品推广" },
  { abbr: "SB", name: "Sponsored Brands", desc: "品牌推广" },
  { abbr: "SD", name: "Sponsored Display", desc: "展示推广" },
];

// FAQ精选
const faqs = [
  {
    question: "系统支持哪些类型的Amazon广告？",
    answer: "支持Sponsored Products (SP)、Sponsored Brands (SB)和Sponsored Display (SD)三种广告类型，覆盖Amazon广告的全部主流形式。系统会针对每种广告类型的特点采用不同的优化策略。"
  },
  {
    question: "NextGen-GTO算法是如何工作的？",
    answer: "NextGen-GTO是我们自主研发的博弈论驱动广告优化引擎，采用双层12引擎架构。第一层是NextGen机器学习层，为每个关键词计算基础出价。第二层是GTO博弈论修正层，从竞争环境维度修正出价。两层协同工作，输出最终的最优出价。"
  },
  {
    question: "如何保证优化不会导致广告效果下降？",
    answer: "系统采用多层安全保障：渐进式调整（单次不超30%）、GTO修正系数安全边界（0.6~1.4）、80/20预算分池、ACoS熔断机制、Meta-Learning自动降级等。确保广告投放永不失控。"
  },
  {
    question: "数据同步频率是多少？",
    answer: "系统采用三层分频同步策略：广告活动状态和预算每15分钟同步一次，广告组和关键词每30分钟同步，完整数据每1小时全量同步。同步成功率始终保持在99.9%以上。"
  },
  {
    question: "支持多站点多账户管理吗？",
    answer: "支持。您可以在一个账户下管理多个Amazon卖家账户和多个站点（US、CA、MX、UK、DE、FR、IT、ES、JP、AU等），统一查看数据和管理策略。"
  },
];

export default function LandingPage() {
  useEffect(() => {
    document.title = "PPC Optimizer - 博弈论驱动的亚马逊广告智能优化";
  }, []);

  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const blogPosts = getAllPosts().slice(0, 3);

  return (
    <PublicLayout>
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
        <div className="absolute top-20 right-10 w-72 h-72 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-10 left-10 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />

        <div className="relative container py-24 lg:py-36">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Swords className="w-4 h-4" />
              <span>NextGen-GTO 博弈论驱动的智能优化引擎</span>
            </div>
            <h1 className="text-4xl lg:text-6xl font-bold tracking-tight mb-6">
              博弈论驱动的
              <span className="text-primary block mt-2">亚马逊广告优化</span>
            </h1>
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed max-w-3xl">
              融合<strong className="text-foreground">机器学习</strong>与<strong className="text-foreground">博弈论(GTO)</strong>的双层12引擎架构。
              不只是"AI智能出价"，而是真正解决归因延迟、竞争环境变化、死亡螺旋等核心痛点的全自动广告优化系统。
            </p>

            {/* 核心指标 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {performanceMetrics.map((metric: unknown, i: unknown) => (
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
                <Link href="/how-it-works">
                  了解优化逻辑
                  <ChevronRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* 核心功能亮点 */}
      <section className="py-24 bg-card/30">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4">核心能力</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">为什么选择 PPC Optimizer</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              不只是降低ACoS，而是从算法、博弈、安全、执行四个维度全面优化您的广告投放
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {highlights.map((item: unknown, i: unknown) => (
              <Card key={i} className={`${item.borderColor} hover:shadow-lg transition-all duration-300 group`}>
                <CardHeader>
                  <div className={`w-12 h-12 rounded-lg ${item.bgColor} flex items-center justify-center mb-2 group-hover:scale-110 transition-transform`}>
                    <item.icon className={`w-6 h-6 ${item.color}`} />
                  </div>
                  <CardTitle className="text-lg">{item.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center mt-10">
            <Button variant="outline" asChild>
              <Link href="/how-it-works">
                查看完整优化逻辑
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* 支持的广告类型 */}
      <section className="py-24">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4">全面支持</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">支持所有Amazon广告类型</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-3xl mx-auto">
            {adTypes.map((ad: unknown, i: unknown) => (
              <div key={i} className="text-center p-8 rounded-2xl bg-card border border-border/50 hover:border-primary/30 transition-colors">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-primary">{ad.abbr}</span>
                </div>
                <h3 className="font-semibold mb-1">{ad.name}</h3>
                <p className="text-sm text-muted-foreground">{ad.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 博客预览 */}
      {blogPosts.length > 0 && (
        <section className="py-24 bg-card/30">
          <div className="container">
            <div className="text-center mb-16">
              <Badge variant="outline" className="mb-4">知识库</Badge>
              <h2 className="text-3xl lg:text-4xl font-bold mb-4">最新博客文章</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                探索亚马逊广告优化的最新策略、算法解析和成功案例
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
              {blogPosts.map((post: unknown) => (
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
      )}

      {/* FAQ */}
      <section className="py-24">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4">常见问题</Badge>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">FAQ</h2>
          </div>
          <div className="max-w-3xl mx-auto space-y-4">
            {faqs.map((faq: unknown, i: unknown) => (
              <div key={i} className="bg-card border border-border/50 rounded-lg overflow-hidden">
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

      {/* CTA */}
      <section className="py-24 bg-card/30">
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
              <Button size="lg" variant="outline" asChild>
                <Link href="/contact">
                  联系我们
                </Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-6">
              无需信用卡 · 双层12引擎即刻启动 · 随时取消
            </p>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
