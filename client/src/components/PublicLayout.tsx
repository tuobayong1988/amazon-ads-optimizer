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
            <span className="text-lg font-bold tracking-tight">PPCOPT</span>
          </Link>

          {/* 桌面端导航链接 */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link: unknown) => {
              // @ts-ignore
              const isActive = location === link.href || (link.href !== "/" && location.startsWith(link.href));
              return (
                // @ts-ignore
                <Link
                  // @ts-ignore
                  key={link.href}
                  // @ts-ignore
                  href={link.href}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "text-primary bg-primary/10"
                      // @ts-ignore
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  {/* @ts-ignore */}
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
        {/* @ts-ignore */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-lg">
            <div className="container py-4 space-y-2">
              // @ts-ignore
              {NAV_LINKS.map((link: unknown) => {
                // @ts-ignore
                const isActive = location === link.href || (link.href !== "/" && location.startsWith(link.href));
                return (
                  <Link
                    // @ts-ignore
                    key={link.href}
                    // @ts-ignore
                    href={link.href}
                    // @ts-ignore
                    className={`block px-4 py-3 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? "text-primary bg-primary/10"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {/* @ts-ignore */}
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
<footer></footer>
    </div>
  );
}
