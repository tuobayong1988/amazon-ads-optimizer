import { useLocation } from "wouter";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  Target,
  Megaphone,
  Settings,
} from "lucide-react";

/**
 * v187: 移动端底部导航配置
 * 每个按钮指向不同的有效页面路径
 * - 概览: 数据概览首页
 * - 策略: 策略管理（优化目标列表）
 * - 广告: 广告活动列表
 * - 设置: 系统设置
 */
const navItems = [
  { icon: LayoutDashboard, label: "概览", path: "/" },
  { icon: Target, label: "策略", path: "/strategy-center" },
  { icon: Megaphone, label: "广告", path: "/campaigns" },
  { icon: Settings, label: "设置", path: "/settings" },
];

/**
 * 移动端底部导航栏组件
 * 仅在移动端显示，提供快速导航功能
 */
export function MobileBottomNav() {
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();

  // 非移动端不显示
  if (!isMobile) return null;

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-t border-border z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
    >
      <div className="flex items-center justify-around h-16">
        {navItems.map((item: any) => {
          const isActive = location === item.path || 
            (item.path !== "/" && location.startsWith(item.path));
          
          return (
            <button
              key={item.path}
              onClick={() => setLocation(item.path)}
              className={`flex flex-col items-center justify-center flex-1 h-full gap-1 transition-colors ${
                isActive 
                  ? "text-primary" 
                  : "text-muted-foreground active:text-foreground"
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? "text-primary" : ""}`} />
              <span className={`text-xs ${isActive ? "font-medium" : ""}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * 移动端底部间距组件
 * 用于在页面底部添加间距，防止内容被底部导航栏遮挡
 */
export function MobileBottomSpacer() {
  const isMobile = useIsMobile();
  
  if (!isMobile) return null;
  
  return <div className="h-20" />;
}
