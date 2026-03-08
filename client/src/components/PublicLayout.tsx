import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { Zap, Mail, MapPin, Building2, Menu, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useState } from "react";

// 前台导航链接配置
const NAV_LINKS = [
  { href: "/", label: "首页" },
  { href: "/how-it-works", label: "优化逻辑" },
  { href: "/blog", label: "博客" },
  { href: "/contact", label: "联系我们" },
];

// 前台公共布局组件 — 未登录页面统一使用
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* 顶部导航栏 */}
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="container flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold tracking-tight">PPC Optimizer</span>
          </Link>

          {/* 桌面端导航链接 */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link: any) => {
              const isActive = location === link.href || (link.href !== "/" && location.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* 登录按钮 */}
          <div className="hidden md:flex items-center gap-3">
            <Button variant="outline" size="sm" asChild>
              <a href={getLoginUrl()}>登录</a>
            </Button>
            <Button size="sm" asChild>
              <a href={getLoginUrl()}>免费试用</a>
            </Button>
          </div>

          {/* 移动端菜单按钮 */}
          <button
            className="md:hidden p-2 rounded-md hover:bg-muted/50 transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* 移动端菜单 */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-lg">
            <div className="container py-4 space-y-2">
              {NAV_LINKS.map((link: any) => {
                const isActive = location === link.href || (link.href !== "/" && location.startsWith(link.href));
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`block px-4 py-3 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? "text-primary bg-primary/10"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {link.label}
                  </Link>
                );
              })}
              <div className="pt-2 border-t border-border/50 flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" asChild>
                  <a href={getLoginUrl()}>登录</a>
                </Button>
                <Button size="sm" className="flex-1" asChild>
                  <a href={getLoginUrl()}>免费试用</a>
                </Button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* 页面内容 */}
      <main className="flex-1">
        {children}
      </main>

      {/* 底部公司信息 */}
      <footer className="border-t border-border/50 bg-card/30">
        {/* 上部：多列信息 */}
        <div className="container py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
            {/* 品牌信息 */}
            <div className="lg:col-span-1">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
                  <Zap className="w-5 h-5 text-primary-foreground" />
                </div>
                <span className="text-lg font-bold">PPC Optimizer</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                博弈论驱动的亚马逊广告智能优化系统，融合机器学习与GTO策略的双层12引擎架构，为跨境电商卖家提供全自动广告优化服务。
              </p>
            </div>

            {/* 产品 */}
            <div>
              <h4 className="font-semibold mb-4">产品</h4>
              <ul className="space-y-3">
                <li>
                  <Link href="/how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    优化逻辑
                  </Link>
                </li>
                <li>
                  <Link href="/blog" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    博客
                  </Link>
                </li>
                <li>
                  <Link href="/contact" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    联系我们
                  </Link>
                </li>
              </ul>
            </div>

            {/* 支持的广告类型 */}
            <div>
              <h4 className="font-semibold mb-4">支持的广告类型</h4>
              <ul className="space-y-3">
                <li className="text-sm text-muted-foreground">Sponsored Products (SP)</li>
                <li className="text-sm text-muted-foreground">Sponsored Brands (SB)</li>
                <li className="text-sm text-muted-foreground">Sponsored Display (SD)</li>
              </ul>
            </div>

            {/* 公司信息 */}
            <div>
              <h4 className="font-semibold mb-4">公司信息</h4>
              <ul className="space-y-3">
                <li className="flex items-start gap-2.5">
                  <Building2 className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Shenzhen Yipin Mingxuan Technology Co., Ltd.</p>
                    <p className="text-sm text-muted-foreground">深圳一品名轩科技有限公司</p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    深圳市龙岗区坂田街道岗头社区新围仔五和大道4004号名筑大厦608
                  </p>
                </li>
                <li className="flex items-center gap-2.5">
                  <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <a href="mailto:vip@ppcopt.com" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                    vip@ppcopt.com
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* 下部：版权信息 */}
        <div className="border-t border-border/50">
          <div className="container py-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Shenzhen Yipin Mingxuan Technology Co., Ltd. All rights reserved.
            </p>
            <p className="text-xs text-muted-foreground">
              深圳一品名轩科技有限公司 版权所有
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
