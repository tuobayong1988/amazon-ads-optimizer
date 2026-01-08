import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { 
  BarChart3, 
  Target, 
  TrendingUp, 
  Zap, 
  ArrowRight, 
  Shield, 
  Clock,
  LineChart,
  Settings,
  FileSpreadsheet,
  Brain,
  Layers,
  RefreshCw,
  AlertTriangle,
  GitBranch,
  Workflow
} from "lucide-react";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isAuthenticated) {
      setLocation("/dashboard");
    }
  }, [isAuthenticated, setLocation]);

  // 设置页面标题用于SEO
  useEffect(() => {
    document.title = "亚马逊广告智能优化系统 - Amazon Ads Optimizer";
  }, []);

  if (loading || isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background"></div>
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
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Brain className="w-4 h-4" />
              <span>自主研发的智能优化算法</span>
            </div>
            <h1 className="text-4xl lg:text-6xl font-bold tracking-tight mb-6">
              亚马逊广告
              <span className="text-primary">全自动智能优化</span>
              系统
            </h1>
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
              基于<strong>市场曲线建模</strong>、<strong>边际效益分析</strong>和<strong>流量隔离算法</strong>，
              实现广告出价、预算、否定词的全自动优化。每2小时自动运营，让您的广告投放效率持续提升。
            </p>
            <div className="flex flex-wrap gap-4">
              <Button size="lg" asChild>
                <a href={getLoginUrl()}>
                  开始使用
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
              <Button size="lg" variant="outline">
                了解更多
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Core Algorithm Section */}
      <section className="py-24 bg-card/50">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">核心算法引擎</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              自主研发的六大核心算法，实现广告优化的全流程自动化
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <AlgorithmCard
              icon={<LineChart className="w-6 h-6" />}
              title="市场曲线建模"
              description="分析出价-流量-转化关系，构建市场响应曲线，识别流量天花板和最优出价点"
              highlight="边际收入 = 边际成本"
            />
            <AlgorithmCard
              icon={<TrendingUp className="w-6 h-6" />}
              title="智能预算分配"
              description="多时间窗口分析（7/14/30天），边际效益递减模型，自动在高效广告活动间分配预算"
              highlight="多维度评分引擎"
            />
            <AlgorithmCard
              icon={<Layers className="w-6 h-6" />}
              title="N-Gram流量分析"
              description="提取搜索词词根，识别无转化高频词根，自动生成否定词建议，节省无效花费"
              highlight="置信度算法"
            />
            <AlgorithmCard
              icon={<GitBranch className="w-6 h-6" />}
              title="流量冲突检测"
              description="识别同一搜索词在多个广告活动中的重复竞争，自动选择最优广告活动承接流量"
              highlight="动态归一化评分"
            />
            <AlgorithmCard
              icon={<Workflow className="w-6 h-6" />}
              title="漏斗否定词同步"
              description="精准层→发现层→广泛层的漏斗模型，自动同步否定词，实现流量的精准隔离"
              highlight="三层漏斗架构"
            />
            <AlgorithmCard
              icon={<RefreshCw className="w-6 h-6" />}
              title="关键词迁移引擎"
              description="识别广泛匹配中的高转化搜索词，自动建议迁移到精确匹配，提升广告效率"
              highlight="自动化迁移建议"
            />
          </div>
        </div>
      </section>

      {/* Auto Operation Section */}
      <section className="py-24">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-chart-4/10 text-chart-4 text-sm font-medium mb-6">
                <Clock className="w-4 h-4" />
                <span>每2小时自动运营</span>
              </div>
              <h2 className="text-3xl font-bold mb-6">全自动运营策略</h2>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                系统每2小时自动执行完整的优化流程，无需人工干预。从数据同步到优化执行，
                全程自动化，让您的广告投放始终保持最佳状态。
              </p>
              <div className="space-y-4">
                <AutoStepItem step="1" title="数据同步" description="自动从Amazon API获取最新广告数据" />
                <AutoStepItem step="2" title="N-Gram分析" description="分析搜索词词根，识别无效流量" />
                <AutoStepItem step="3" title="漏斗同步" description="自动同步否定词到各层漏斗" />
                <AutoStepItem step="4" title="冲突检测" description="检测并解决流量冲突问题" />
                <AutoStepItem step="5" title="迁移建议" description="生成关键词迁移建议" />
                <AutoStepItem step="6" title="出价优化" description="基于市场曲线自动调整出价" />
              </div>
            </div>
            <div className="bg-card rounded-2xl p-8 border border-border/50">
              <h3 className="text-xl font-semibold mb-6">安全边界保护</h3>
              <div className="space-y-4">
                <SafetyItem icon={<Shield className="w-5 h-5" />} title="调整幅度限制" description="单次出价调整不超过30%，预算调整不超过50%" />
                <SafetyItem icon={<AlertTriangle className="w-5 h-5" />} title="异常检测" description="自动检测数据异常，暂停可疑调整" />
                <SafetyItem icon={<RefreshCw className="w-5 h-5" />} title="自动回滚" description="效果恶化时自动回滚到之前的设置" />
                <SafetyItem icon={<FileSpreadsheet className="w-5 h-5" />} title="完整日志" description="所有调整记录可追溯，支持审计" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-card/50">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">功能特性</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              为亚马逊卖家提供专业的广告优化解决方案
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Target className="w-6 h-6" />}
              title="绩效组目标配置"
              description="支持目标ACoS、目标ROAS、每日花费上限、销售最大化等多种优化目标"
            />
            <FeatureCard
              icon={<Clock className="w-6 h-6" />}
              title="日内多次竞价"
              description="一天内根据实时数据多次调整出价，快速响应市场变化"
            />
            <FeatureCard
              icon={<BarChart3 className="w-6 h-6" />}
              title="数据可视化仪表盘"
              description="展示核心KPI、趋势图表、时间段对比分析，一目了然"
            />
            <FeatureCard
              icon={<FileSpreadsheet className="w-6 h-6" />}
              title="竞价日志透明化"
              description="公开所有竞价调整记录，包括时间、广告活动、出价变化、调整原因"
            />
            <FeatureCard
              icon={<Settings className="w-6 h-6" />}
              title="灵活的优化设置"
              description="账号级和广告活动级的配置，支持配置继承，满足不同场景需求"
            />
            <FeatureCard
              icon={<Brain className="w-6 h-6" />}
              title="智能决策解释"
              description="每个优化决策都有详细的理由说明，让您了解系统的优化逻辑"
            />
          </div>
        </div>
      </section>

      {/* Ad Types Section */}
      <section className="py-24">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">支持全部亚马逊广告类型</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              针对不同广告类型制定相应的优化策略
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <AdTypeCard
              type="SP"
              title="Sponsored Products"
              description="支持自动广告和手动广告，关键词（Broad/Phrase/Exact）和商品定位优化"
              color="primary"
            />
            <AdTypeCard
              type="SB"
              title="Sponsored Brands"
              description="品牌推广广告优化，提升品牌曝光和知名度"
              color="chart-4"
            />
            <AdTypeCard
              type="SD"
              title="Sponsored Display"
              description="展示型推广广告优化，精准触达目标受众"
              color="chart-5"
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-gradient-to-br from-primary/20 to-background">
        <div className="container text-center">
          <h2 className="text-3xl font-bold mb-4">开始优化您的亚马逊广告</h2>
          <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
            立即登录，体验全自动智能优化带来的效率提升
          </p>
          <Button size="lg" asChild>
            <a href={getLoginUrl()}>
              免费开始
              <ArrowRight className="ml-2 h-5 w-5" />
            </a>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border">
        <div className="container">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold">Amazon Ads Optimizer</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2025 Amazon Ads Optimizer. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function AlgorithmCard({ icon, title, description, highlight }: { icon: React.ReactNode; title: string; description: string; highlight: string }) {
  return (
    <div className="bg-card rounded-xl p-6 border border-border/50 hover:border-primary/50 transition-colors group">
      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
        {icon}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed mb-3">{description}</p>
      <div className="inline-flex items-center px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
        {highlight}
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-card rounded-xl p-6 border border-border/50 hover:border-primary/50 transition-colors">
      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function AdTypeCard({ type, title, description, color }: { type: string; title: string; description: string; color: string }) {
  return (
    <div className="bg-card rounded-xl p-8 border border-border/50 text-center hover:shadow-lg transition-shadow">
      <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full bg-${color}/20 text-${color} text-2xl font-bold mb-4`}>
        {type}
      </div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}

function AutoStepItem({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
        {step}
      </div>
      <div>
        <h4 className="font-medium">{title}</h4>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function SafetyItem({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-lg bg-chart-4/10 text-chart-4 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <h4 className="font-medium">{title}</h4>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
