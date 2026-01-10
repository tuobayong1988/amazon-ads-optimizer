import { useState, useRef, useCallback, ReactNode, TouchEvent } from "react";
import { RefreshCw, ArrowDown } from "lucide-react";
import { useIsMobile } from "@/hooks/useMobile";

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  threshold?: number;
  className?: string;
}

type RefreshState = "idle" | "pulling" | "ready" | "refreshing";

/**
 * 下拉刷新组件
 * 仅在移动端启用，支持触摸下拉手势刷新数据
 */
export function PullToRefresh({
  children,
  onRefresh,
  disabled = false,
  threshold = 80,
  className = "",
}: PullToRefreshProps) {
  const isMobile = useIsMobile();
  const [state, setState] = useState<RefreshState>("idle");
  const [pullDistance, setPullDistance] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled || state === "refreshing") return;
    
    const container = containerRef.current;
    if (!container) return;
    
    // 只有在顶部时才启用下拉刷新
    if (container.scrollTop > 0) return;
    
    startY.current = e.touches[0].clientY;
    setState("pulling");
  }, [disabled, state]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (state !== "pulling" && state !== "ready") return;
    
    const container = containerRef.current;
    if (!container || container.scrollTop > 0) {
      setState("idle");
      setPullDistance(0);
      return;
    }
    
    currentY.current = e.touches[0].clientY;
    const distance = Math.max(0, currentY.current - startY.current);
    
    // 使用阻尼效果，拉得越远阻力越大
    const dampedDistance = Math.min(distance * 0.5, threshold * 1.5);
    setPullDistance(dampedDistance);
    
    if (dampedDistance >= threshold) {
      setState("ready");
    } else {
      setState("pulling");
    }
  }, [state, threshold]);

  const handleTouchEnd = useCallback(async () => {
    if (state === "ready") {
      setState("refreshing");
      setPullDistance(threshold);
      
      try {
        await onRefresh();
      } finally {
        setState("idle");
        setPullDistance(0);
      }
    } else {
      setState("idle");
      setPullDistance(0);
    }
  }, [state, threshold, onRefresh]);

  // 非移动端直接渲染子元素
  if (!isMobile) {
    return <>{children}</>;
  }

  const getIndicatorContent = () => {
    switch (state) {
      case "pulling":
        return (
          <>
            <ArrowDown 
              className="w-5 h-5 text-muted-foreground transition-transform"
              style={{ transform: `rotate(${Math.min(pullDistance / threshold * 180, 180)}deg)` }}
            />
            <span className="text-sm text-muted-foreground">下拉刷新</span>
          </>
        );
      case "ready":
        return (
          <>
            <ArrowDown className="w-5 h-5 text-primary rotate-180" />
            <span className="text-sm text-primary">释放刷新</span>
          </>
        );
      case "refreshing":
        return (
          <>
            <RefreshCw className="w-5 h-5 text-primary animate-spin" />
            <span className="text-sm text-primary">刷新中...</span>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-auto ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {/* 刷新指示器 */}
      <div
        className="absolute left-0 right-0 flex items-center justify-center gap-2 transition-all duration-200 overflow-hidden"
        style={{
          top: 0,
          height: pullDistance,
          opacity: pullDistance > 20 ? 1 : 0,
        }}
      >
        {getIndicatorContent()}
      </div>
      
      {/* 内容区域 */}
      <div
        className="transition-transform duration-200"
        style={{
          transform: `translateY(${pullDistance}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 简化版下拉刷新Hook
 * 用于需要自定义UI的场景
 */
export function usePullToRefresh(onRefresh: () => Promise<void>, threshold = 80) {
  const [state, setState] = useState<RefreshState>("idle");
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);

  const handlers = {
    onTouchStart: (e: TouchEvent) => {
      if (state === "refreshing") return;
      startY.current = e.touches[0].clientY;
      setState("pulling");
    },
    onTouchMove: (e: TouchEvent) => {
      if (state !== "pulling" && state !== "ready") return;
      const distance = Math.max(0, e.touches[0].clientY - startY.current);
      const dampedDistance = Math.min(distance * 0.5, threshold * 1.5);
      setPullDistance(dampedDistance);
      setState(dampedDistance >= threshold ? "ready" : "pulling");
    },
    onTouchEnd: async () => {
      if (state === "ready") {
        setState("refreshing");
        try {
          await onRefresh();
        } finally {
          setState("idle");
          setPullDistance(0);
        }
      } else {
        setState("idle");
        setPullDistance(0);
      }
    },
  };

  return {
    state,
    pullDistance,
    isRefreshing: state === "refreshing",
    handlers,
  };
}
