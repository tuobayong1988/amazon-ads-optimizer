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
  ChevronRight
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import AccountSwitcher from "./AccountSwitcher";

// 菜单分组配置 - 按运营工作流程优先级排序
const menuGroups = [
  {
    title: "核心监控",
    items: [
      { icon: LayoutDashboard, label: "监控仪表盘", path: "/dashboard" },
      { icon: Activity, label: "健康度监控", path: "/health" },
      { icon: AlertTriangle, label: "预算预警", path: "/budget-alerts" },
    ]
  },
  {
    title: "广告管理",
    items: [
      { icon: Megaphone, label: "广告活动", path: "/campaigns" },
      { icon: Target, label: "绩效组管理", path: "/performance-groups" },
      { icon: DollarSign, label: "预算分配", path: "/budget-allocation" },
    ]
  },
  {
    title: "智能优化",
    items: [
      { icon: Zap, label: "广告自动化", path: "/automation" },
      { icon: Layers, label: "批量操作", path: "/batch-operations" },
      { icon: FileSearch, label: "纠错复盘", path: "/correction-review" },
      { icon: CalendarDays, label: "季节性建议", path: "/seasonal-budget" },
    ]
  },
  {
    title: "数据与报告",
    items: [
      { icon: FileText, label: "竞价日志", path: "/bidding-logs" },
      { icon: LineChart, label: "效果追踪", path: "/budget-tracking" },
      { icon: BarChart3, label: "跨账号汇总", path: "/accounts-summary" },
      { icon: Shield, label: "审计日志", path: "/audit-logs" },
    ]
  },
  {
    title: "自动化任务",
    items: [
      { icon: Clock, label: "定时任务", path: "/scheduler" },
      { icon: RefreshCw, label: "数据同步", path: "/data-sync" },
    ]
  },
  {
    title: "系统设置",
    items: [
      { icon: Cloud, label: "Amazon API", path: "/amazon-api" },
      { icon: Settings, label: "优化设置", path: "/settings" },
      { icon: Bell, label: "通知设置", path: "/notifications" },
      // 数据导入已移除，改为使用数据同步
    ]
  },
  {
    title: "团队协作",
    items: [
      { icon: Users, label: "团队管理", path: "/team" },
      { icon: MessageSquare, label: "协作通知", path: "/collaboration" },
      { icon: Mail, label: "邮件报表", path: "/email-reports" },
    ]
  },
];

// 扁平化菜单项用于路由匹配
const menuItems = menuGroups.flatMap(group => group.items);

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
  const activeMenuItem = menuItems.find(item => item.path === location);
  const isMobile = useIsMobile();

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
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4 text-primary-foreground" />
                  </div>
                  <span className="font-semibold tracking-tight truncate text-sm">
                    Ads Optimizer
                  </span>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 overflow-y-auto">
            {/* 返回主界面按钮 - 始终显示在顶部 */}
            <div className="px-2 py-2 border-b border-border/50">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={location === "/dashboard"}
                    onClick={() => setLocation("/dashboard")}
                    tooltip="返回主界面"
                    className="h-10 transition-all font-medium bg-primary/10 hover:bg-primary/20"
                  >
                    <Home className={`h-4 w-4 ${location === "/dashboard" ? "text-primary" : "text-primary"}`} />
                    <span className="text-primary">返回主界面</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </div>

            {/* 菜单分组 */}
            {menuGroups.map((group, groupIndex) => (
              <MenuGroup 
                key={group.title} 
                group={group} 
                groupIndex={groupIndex}
                location={location}
                setLocation={setLocation}
                isCollapsed={isCollapsed}
              />
            ))}
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
        {/* 顶部导航栏 - 包含账号切换器 */}
        <div className="flex border-b h-14 items-center justify-between bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
          <div className="flex items-center gap-2">
            {isMobile && <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />}
            <div className="flex items-center gap-3">
              <span className="tracking-tight text-foreground font-medium">
                {activeMenuItem?.label ?? "菜单"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <AccountSwitcher compact />
          </div>
        </div>
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </>
  );
}

// 菜单分组组件 - 支持展开/收起
function MenuGroup({
  group,
  groupIndex,
  location,
  setLocation,
  isCollapsed,
}: {
  group: typeof menuGroups[0];
  groupIndex: number;
  location: string;
  setLocation: (path: string) => void;
  isCollapsed: boolean;
}) {
  // 检查当前分组是否有活动项
  const hasActiveItem = group.items.some(item => item.path === location);
  // 默认展开有活动项的分组，或者前三个分组
  const [isExpanded, setIsExpanded] = useState(hasActiveItem || groupIndex < 3);

  // 当活动项变化时，自动展开包含活动项的分组
  useEffect(() => {
    if (hasActiveItem && !isExpanded) {
      setIsExpanded(true);
    }
  }, [hasActiveItem]);

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
