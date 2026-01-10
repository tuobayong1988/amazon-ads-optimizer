import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/useMobile";
import { 
  Plus, 
  X, 
  RefreshCw, 
  Filter, 
  Download, 
  Search,
  Settings,
  ChevronUp,
  LucideIcon
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface FloatingAction {
  id: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost";
  disabled?: boolean;
}

interface FloatingActionButtonProps {
  actions: FloatingAction[];
  mainIcon?: LucideIcon;
  className?: string;
}

export function FloatingActionButton({ 
  actions, 
  mainIcon: MainIcon = Plus,
  className 
}: FloatingActionButtonProps) {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // 监听滚动显示回到顶部按钮
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // 回到顶部
  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".floating-action-button")) {
        setIsOpen(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [isOpen]);

  // 只在移动端显示
  if (!isMobile) return null;

  return (
    <div 
      className={cn(
        "floating-action-button fixed right-4 z-50 flex flex-col items-end gap-2",
        "bottom-20", // 在底部导航栏上方
        className
      )}
    >
      {/* 回到顶部按钮 */}
      {showScrollTop && !isOpen && (
        <Button
          size="icon"
          variant="secondary"
          className="w-10 h-10 rounded-full shadow-lg"
          onClick={scrollToTop}
        >
          <ChevronUp className="w-5 h-5" />
        </Button>
      )}

      {/* 展开的操作按钮 */}
      {isOpen && (
        <div className="flex flex-col items-end gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {actions.map((action, index) => (
            <div 
              key={action.id} 
              className="flex items-center gap-2"
              style={{ 
                animationDelay: `${index * 50}ms`,
                animation: "fadeInUp 0.2s ease-out forwards"
              }}
            >
              <span className="bg-background/95 backdrop-blur-sm text-foreground text-xs px-2 py-1 rounded-md shadow-md whitespace-nowrap">
                {action.label}
              </span>
              <Button
                size="icon"
                variant={action.variant || "secondary"}
                className="w-10 h-10 rounded-full shadow-lg"
                onClick={() => {
                  action.onClick();
                  setIsOpen(false);
                }}
                disabled={action.disabled}
              >
                <action.icon className="w-5 h-5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* 主按钮 */}
      <Button
        size="icon"
        className={cn(
          "w-14 h-14 rounded-full shadow-xl transition-transform duration-200",
          isOpen && "rotate-45 bg-destructive hover:bg-destructive/90"
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <X className="w-6 h-6" />
        ) : (
          <MainIcon className="w-6 h-6" />
        )}
      </Button>

      {/* 背景遮罩 */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-background/50 backdrop-blur-sm -z-10"
          onClick={() => setIsOpen(false)}
        />
      )}

      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

// 预定义的常用操作
export const commonActions = {
  refresh: (onClick: () => void): FloatingAction => ({
    id: "refresh",
    icon: RefreshCw,
    label: "刷新数据",
    onClick,
  }),
  filter: (onClick: () => void): FloatingAction => ({
    id: "filter",
    icon: Filter,
    label: "筛选",
    onClick,
  }),
  search: (onClick: () => void): FloatingAction => ({
    id: "search",
    icon: Search,
    label: "搜索",
    onClick,
  }),
  export: (onClick: () => void): FloatingAction => ({
    id: "export",
    icon: Download,
    label: "导出",
    onClick,
  }),
  settings: (onClick: () => void): FloatingAction => ({
    id: "settings",
    icon: Settings,
    label: "设置",
    onClick,
  }),
};

export default FloatingActionButton;
