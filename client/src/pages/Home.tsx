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
  FileSpreadsheet
} from "lucide-react";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isAuthenticated) {
      setLocation("/dashboard");
    }
  }, [isAuthenticated, setLocation]);

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
            <h1 className="text-4xl lg:text-6xl font-bold tracking-tight mb-6">
              亚马逊广告
              <span className="text-primary">智能竞价优化</span>
              系统
            </h1>
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
              基于市场曲线建模和边际分析算法，自动优化您的亚马逊广告出价，
              提升广告投放效率和ROI。支持SP、SB、SD全广告类型。
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

      {/* Features Section */}
      <section className="py-24 bg-card/50">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">核心功能</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              参考Adspert的先进算法逻辑，为亚马逊卖家提供专业的广告优化解决方案
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <FeatureCard
              icon={<LineChart className="w-6 h-6" />}
              title="市场曲线建模"
              description="分析出价-流量-转化关系，识别流量天花板和最优出价点，计算边际收入和边际成本"
            />
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
            立即登录，体验智能竞价优化带来的效率提升
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
