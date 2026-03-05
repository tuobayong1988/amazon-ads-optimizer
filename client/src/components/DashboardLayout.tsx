import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard, 
  LogOut, 
  PanelLeft, 
  Target, 
  Megaphone, 
  FileText, 
  Settings, 
  Zap,
  Cloud,
  Activity,
  Bell,
  Clock,
  Layers,
  FileSearch,
  BarChart3,
  Users,
  Mail,
  Shield,
  MessageSquare,
  DollarSign,
  AlertTriangle,
  LineChart,
  CalendarDays,
  RefreshCw,
  Home,
  ChevronDown,
  ChevronRight,
  MapPin,
  Brain,
  History,
  FlaskConical,
  Bot,
  UserPlus,
  Rocket,
  Search,
  Command,
} from "lucide-react";
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import GlobalAccountSelector from "./GlobalAccountSelector";
import { MobileBottomNav } from "./MobileBottomNav";

// ==================== 重构后的菜单分组配置 ====================
// 按照优化方案重新组织：清晰的两级结构，消除冗余

const baseMenuGroups = [
  {
    title: "数据概览",
    description: "多账户数据一览",
    directPath: "/",  // 直接跳转，不展开子菜单
    items: [
      { icon: LayoutDashboard, label: "数据概览", path: "/" },
    ]
  },
  {
    title: "优化中心",
    description: "优化目标、广告活动管理",
    items: [
      { icon: Target, label: "策略管理", path: "/strategy-center" },
      { icon: Megaphone, label: "广告活动", path: "/campaigns" },
      { icon: FlaskConical, label: "A/B测试", path: "/ab-test" },
    ]
  },
  {
    title: "系统设置",
    description: "系统配置与连接管理",
    items: [
      { icon: Cloud, label: "Amazon API", path: "/amazon-api" },
      { icon: Settings, label: "优化设置", path: "/settings" },
      { icon: Bell, label: "通知设置", path: "/notifications" },
    ]
  },
  {
    title: "团队与安全",
    description: "团队协作与安全审计",
    items: [
      { icon: Users, label: "团队管理", path: "/team" },
      { icon: UserPlus, label: "邀请码管理", path: "/invite-codes" },
      { icon: Shield, label: "审计日志", path: "/audit-logs" },
    ]
  },
  {
    title: "系统监控",
    description: "系统运行状态监控",
    items: [
      { icon: Activity, label: "纠错监控", path: "/auto-correction" },
    ]
  },
];

// 预发布引擎菜单 — 直接跳转，不再有冗余子菜单
const prelaunchMenuGroup = {
  title: "预发布引擎",
  description: "智能预发布引擎",
  directPath: "/prelaunch",  // 直接跳转
  items: [
    { icon: Rocket, label: "预发布引擎", path: "/prelaunch" },
  ]
};

// 默认菜单（不含发布引擎，在组件内根据角色动态添加）
const menuGroups = baseMenuGroups;

// 扁平化菜单项用于路由匹配（包含发布引擎路由，确保admin访问时标题正确显示）
const allMenuItems = [...baseMenuGroups, prelaunchMenuGroup].flatMap(group => group.items);
const menuItems = allMenuItems;

/**
 * 完整的路由路径到页面标题映射表
 * 用于顶部导航栏显示当前页面标题（仅移动端显示）
 * 包含所有有效路由，避免fallback到"菜单"等无意义文本
 */
const routeTitleMap: Record<string, string> = {
  '/': '数据概览',
  '/strategy-center': '策略管理',
  '/campaigns': '广告活动',
  '/ab-test': 'A/B测试',
  '/amazon-api': 'Amazon API',
  '/settings': '优化设置',
  '/notifications': '通知设置',
  '/team': '团队管理',
  '/invite-codes': '邀请码管理',
  '/audit-logs': '审计日志',
  '/auto-correction': '纠错监控',
  '/prelaunch': '预发布引擎',
  '/optimization-targets': '优化目标',
  '/health': '系统健康',
  '/automation': '自动化',
  '/batch-operations': '批量操作',
  '/correction-review': '纠错审查',
  '/accounts-summary': '账户汇总',
  '/email-reports': '邮件报告',
  '/collaboration': '协作通知',
  '/budget-alerts': '预算警报',
  '/budget-tracking': '预算追踪',
  '/seasonal-budget': '季节预算',
  '/dayparting': '分时策略',
  '/placement-optimization': '位置优化',
  '/advanced-placement': '高级位置优化',
  '/api-security': 'API安全',
  '/special-scenario': '特殊场景分析',
  '/sync-logs': '同步日志',
  '/data-validation': '数据验证',
  '/auto-optimization-dashboard': '自动优化面板',
  '/batch-authorization': '批量授权',
  '/holiday-calendar': '节日日历',
  '/amazon-api-auth-status': 'API授权状态',
  '/onboarding': '卖家引导',
  '/seller-onboarding': '卖家引导',
  '/blog': '博客',
};

/**
 * 面包屑导航配置 — 定义每个路由的层级关系
 */
const breadcrumbConfig: Record<string, { label: string; parent?: string }> = {
  '/': { label: '数据概览' },
  '/strategy-center': { label: '策略管理', parent: '/' },
  '/campaigns': { label: '广告活动', parent: '/' },
  '/ab-test': { label: 'A/B测试', parent: '/' },
  '/amazon-api': { label: 'Amazon API', parent: '/' },
  '/settings': { label: '优化设置', parent: '/' },
  '/notifications': { label: '通知设置', parent: '/' },
  '/team': { label: '团队管理', parent: '/' },
  '/invite-codes': { label: '邀请码管理', parent: '/' },
  '/audit-logs': { label: '审计日志', parent: '/' },
  '/auto-correction': { label: '纠错监控', parent: '/' },
  '/prelaunch': { label: '预发布引擎', parent: '/' },
  '/optimization-targets': { label: '优化目标', parent: '/strategy-center' },
  '/health': { label: '系统健康', parent: '/' },
  '/automation': { label: '自动化', parent: '/settings' },
  '/batch-operations': { label: '批量操作', parent: '/campaigns' },
  '/correction-review': { label: '纠错审查', parent: '/auto-correction' },
  '/accounts-summary': { label: '账户汇总', parent: '/' },
  '/email-reports': { label: '邮件报告', parent: '/notifications' },
  '/collaboration': { label: '协作通知', parent: '/team' },
  '/budget-alerts': { label: '预算警报', parent: '/strategy-center' },
  '/budget-tracking': { label: '预算追踪', parent: '/strategy-center' },
  '/seasonal-budget': { label: '季节预算', parent: '/strategy-center' },
  '/dayparting': { label: '分时策略', parent: '/strategy-center' },
  '/placement-optimization': { label: '位置优化', parent: '/strategy-center' },
  '/advanced-placement': { label: '高级位置优化', parent: '/strategy-center' },
  '/sync-logs': { label: '同步日志', parent: '/amazon-api' },
  '/data-validation': { label: '数据验证', parent: '/amazon-api' },
  '/auto-optimization-dashboard': { label: '自动优化面板', parent: '/strategy-center' },
};

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <div className="w-16 h-16 rounded-xl bg-primary flex items-center justify-center">
              <Zap className="w-8 h-8 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              Amazon Ads Optimizer
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              请登录以访问亚马逊广告智能竞价优化系统
            </p>
          </div>
          <Button
            onClick={() => {
              window.location.href = getLoginUrl();
            }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            登录
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  // 全局搜索状态
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // P2优化: 通知中心状态
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications] = useState([
    { id: 1, type: 'warning' as const, title: '同步异常', message: '账户 "Vanesa" 最近一次同步失败，请检查API连接', time: '5分钟前', read: false },
    { id: 2, type: 'info' as const, title: '优化建议', message: '发现 3 个广告活动的ACoS超过目标值，建议调整出价策略', time: '1小时前', read: false },
    { id: 3, type: 'success' as const, title: '流水线完成', message: '预发布项目 "Water Bottle" 的M1-M7流水线已全部完成', time: '2小时前', read: true },
    { id: 4, type: 'warning' as const, title: '预算告警', message: '广告活动 "SP-Auto-B0FNVPZ2BS" 日预算即将耗尽', time: '3小时前', read: true },
  ]);
  // 优先从菜单项匹配，其次从完整路由标题映射中查找
  const activeMenuItem = menuItems.find(item => item.path === location);
  const pageTitle = activeMenuItem?.label || routeTitleMap[location] || '';
  const isMobile = useIsMobile();

  // 全局搜索快捷键 Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 全局搜索结果
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const results: { label: string; path: string; group: string; icon: any }[] = [];
    
    const allGroups = [...baseMenuGroups, prelaunchMenuGroup];
    for (const group of allGroups) {
      for (const item of group.items) {
        if (item.label.toLowerCase().includes(q) || item.path.toLowerCase().includes(q)) {
          results.push({ label: item.label, path: item.path, group: group.title, icon: item.icon });
        }
      }
    }
    
    // 搜索路由标题映射中的额外页面
    for (const [path, title] of Object.entries(routeTitleMap)) {
      if (title.toLowerCase().includes(q) && !results.find(r => r.path === path)) {
        results.push({ label: title, path, group: '其他页面', icon: FileSearch });
      }
    }
    
    return results.slice(0, 10);
  }, [searchQuery]);

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  // 构建面包屑路径
  const breadcrumbs = useMemo(() => {
    const crumbs: { label: string; path: string }[] = [];
    let currentPath = location;
    
    // 处理动态路由（如 /campaigns/:id）
    const basePath = currentPath.replace(/\/\d+$/, '').replace(/\/\d+\/.*$/, '');
    
    // 从当前路径向上追溯
    let config = breadcrumbConfig[basePath] || breadcrumbConfig[currentPath];
    if (config) {
      crumbs.unshift({ label: config.label, path: basePath || currentPath });
      while (config?.parent) {
        const parentConfig = breadcrumbConfig[config.parent];
        if (parentConfig) {
          crumbs.unshift({ label: parentConfig.label, path: config.parent });
          config = parentConfig;
        } else {
          break;
        }
      }
    } else {
      // 未配置的路由，使用routeTitleMap
      const title = routeTitleMap[currentPath];
      if (title && currentPath !== '/') {
        crumbs.push({ label: '首页', path: '/' });
        crumbs.push({ label: title, path: currentPath });
      }
    }
    
    return crumbs;
  }, [location]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <button
                  onClick={() => setLocation("/")}
                  className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
                >
                  <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4 text-primary-foreground" />
                  </div>
                  <span className="font-semibold tracking-tight truncate text-sm">
                    Ads Optimizer
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => setLocation("/")}
                  className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0 hover:opacity-80 transition-opacity"
                >
                  <Zap className="w-4 h-4 text-primary-foreground" />
                </button>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 overflow-y-auto">
            {/* 基础菜单分组（所有角色可见） */}
            {baseMenuGroups.map((group, groupIndex) => (
              <MenuGroup 
                key={group.title} 
                group={group} 
                groupIndex={groupIndex}
                location={location}
                setLocation={setLocation}
                isCollapsed={isCollapsed}
              />
            ))}
            {/* 预发布引擎菜单（仅admin角色可见）— 直接跳转 */}
            {user?.role === 'admin' && (
              <MenuGroup 
                key={prelaunchMenuGroup.title} 
                group={prelaunchMenuGroup} 
                groupIndex={baseMenuGroups.length}
                location={location}
                setLocation={setLocation}
                isCollapsed={isCollapsed}
              />
            )}
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>退出登录</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {/* 顶部导航栏 - 包含面包屑、全局搜索和账号切换器 */}
        <div className="flex border-b h-14 items-center justify-between bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
          <div className="flex items-center gap-2">
            {isMobile && <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />}
            {/* 面包屑导航（PC端显示） */}
            {!isMobile && breadcrumbs.length > 1 && (
              <nav className="flex items-center gap-1 text-sm">
                {breadcrumbs.map((crumb, idx) => (
                  <span key={crumb.path} className="flex items-center gap-1">
                    {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    {idx === breadcrumbs.length - 1 ? (
                      <span className="text-foreground font-medium">{crumb.label}</span>
                    ) : (
                      <button
                        onClick={() => setLocation(crumb.path)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {crumb.label}
                      </button>
                    )}
                  </span>
                ))}
              </nav>
            )}
            {/* 仅在移动端显示页面标题 */}
            {isMobile && pageTitle && (
              <div className="flex items-center gap-3">
                <span className="tracking-tight text-foreground font-medium">
                  {pageTitle}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* 全局搜索按钮 */}
            {!isMobile && (
              <button
                onClick={() => setSearchOpen(true)}
                className="flex items-center gap-2 h-8 px-3 rounded-md border border-input bg-background text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Search className="h-3.5 w-3.5" />
                <span>搜索...</span>
                <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                  <Command className="h-2.5 w-2.5" />K
                </kbd>
              </button>
            )}
            {/* P2优化: 通知中心铃铛 */}
            <div className="relative">
              <button
                onClick={() => setNotificationOpen(!notificationOpen)}
                className="relative flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Bell className="h-4 w-4" />
                {notifications.filter(n => !n.read).length > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {notifications.filter(n => !n.read).length}
                  </span>
                )}
              </button>
              {notificationOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-background border rounded-xl shadow-2xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b">
                    <span className="text-sm font-medium">通知中心</span>
                    <button className="text-xs text-muted-foreground hover:text-foreground">全部已读</button>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto">
                    {notifications.map((n) => {
                      const typeColors = {
                        warning: 'bg-red-500',
                        info: 'bg-blue-500',
                        success: 'bg-green-500',
                      };
                      return (
                        <div key={n.id} className={`flex items-start gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors ${!n.read ? 'bg-muted/10' : ''}`}>
                          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${typeColors[n.type]}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{n.title}</span>
                              {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                            <span className="text-[10px] text-muted-foreground mt-1 block">{n.time}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-4 py-2.5 border-t text-center">
                    <button onClick={() => { setNotificationOpen(false); setLocation('/notifications'); }} className="text-xs text-primary hover:underline">查看全部通知</button>
                  </div>
                </div>
              )}
            </div>
            <GlobalAccountSelector compact />
          </div>
        </div>

        {/* 全局搜索弹窗 */}
        {searchOpen && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
            <div className="fixed inset-0 bg-black/50" onClick={() => setSearchOpen(false)} />
            <div className="relative w-full max-w-lg bg-background border rounded-xl shadow-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 border-b">
                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                <input
                  autoFocus
                  type="text"
                  placeholder="搜索页面、功能..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <kbd className="hidden sm:inline-flex h-5 items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                  ESC
                </kbd>
              </div>
              {searchResults.length > 0 && (
                <div className="max-h-[300px] overflow-y-auto p-2">
                  {searchResults.map((result) => {
                    const Icon = result.icon;
                    return (
                      <button
                        key={result.path}
                        onClick={() => {
                          setLocation(result.path);
                          setSearchOpen(false);
                          setSearchQuery("");
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-accent transition-colors text-left"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{result.label}</span>
                          <span className="text-xs text-muted-foreground ml-2">{result.group}</span>
                        </div>
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              )}
              {searchQuery && searchResults.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  未找到匹配的页面或功能
                </div>
              )}
              {!searchQuery && (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  输入关键词搜索页面、功能模块
                </div>
              )}
            </div>
          </div>
        )}

        <main className={`flex-1 ${isMobile ? 'p-4 pb-20' : 'p-6'}`}>{children}</main>
        
        {/* 网站底部公司信息 */}
        <footer className="border-t bg-background/50 px-6 py-4">
          <div className="flex flex-col gap-2 text-xs text-muted-foreground">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="font-medium text-foreground/70">Shenzhen Yipin Mingxuan Technology Co., Ltd.</span>
                <span>深圳一品名轩科技有限公司</span>
              </div>
              <div className="flex flex-col sm:items-end gap-1">
                <span>深圳市龙岗区坂田街道岗头社区新围仔五和大道4004号名筑大厦608</span>
                <a href="mailto:vip@ppcopt.com" className="hover:text-foreground transition-colors">vip@ppcopt.com</a>
              </div>
            </div>
            <div className="text-center pt-2 border-t border-border/50">
              <span>&copy; {new Date().getFullYear()} Shenzhen Yipin Mingxuan Technology Co., Ltd. All rights reserved.</span>
            </div>
          </div>
        </footer>
      </SidebarInset>
      
      {/* 移动端底部导航栏 */}
      <MobileBottomNav />
    </>
  );
}

// 菜单分组组件 - 支持展开/收起 + 直接跳转
function MenuGroup({
  group,
  groupIndex,
  location,
  setLocation,
  isCollapsed,
}: {
  group: typeof menuGroups[0] & { directPath?: string };
  groupIndex: number;
  location: string;
  setLocation: (path: string) => void;
  isCollapsed: boolean;
}) {
  // 检查当前分组是否有活动项
  const hasActiveItem = group.items.some(item => item.path === location);
  // 对于直接跳转的分组（只有一个子项），不需要展开/收起
  const isDirect = !!group.directPath && group.items.length === 1;
  // 默认展开有活动项的分组，或者前三个分组
  const [isExpanded, setIsExpanded] = useState(hasActiveItem || groupIndex < 3);

  // 当活动项变化时，自动展开包含活动项的分组
  useEffect(() => {
    if (hasActiveItem && !isExpanded) {
      setIsExpanded(true);
    }
  }, [hasActiveItem]);

  // 直接跳转模式：点击分组标题直接导航
  if (isDirect) {
    const item = group.items[0];
    const isActive = location === item.path;
    
    if (isCollapsed) {
      return (
        <div className={groupIndex > 0 ? "mt-1" : "mt-2"}>
          <SidebarMenu className="px-2">
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={isActive}
                onClick={() => setLocation(item.path)}
                tooltip={item.label}
                className="h-9 transition-all font-normal"
              >
                <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      );
    }

    return (
      <div className={groupIndex > 0 ? "mt-1" : "mt-2"}>
        <SidebarMenu className="px-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={isActive}
              onClick={() => setLocation(item.path)}
              tooltip={item.label}
              className="h-9 transition-all font-normal"
            >
              <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : ""}`} />
              <span className="text-xs font-medium uppercase tracking-wider">{group.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    );
  }

  return (
    <div className={groupIndex > 0 ? "mt-1" : "mt-2"}>
      {!isCollapsed && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-4 py-2 hover:bg-accent/50 transition-colors rounded-md mx-2 group"
          style={{ width: 'calc(100% - 16px)' }}
        >
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {group.title}
          </span>
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
      )}
      {(isExpanded || isCollapsed) && (
        <SidebarMenu className="px-2">
          {group.items.map(item => {
            const isActive = location === item.path;
            return (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton
                  isActive={isActive}
                  onClick={() => setLocation(item.path)}
                  tooltip={item.label}
                  className={`h-9 transition-all font-normal`}
                >
                  <item.icon
                    className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                  />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      )}
    </div>
  );
}
