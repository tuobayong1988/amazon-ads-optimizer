import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        // 即使未授权错误也继续执行跳转
      } else {
        console.error("Logout error:", error);
      }
    }
    
    // 清除本地状态
    utils.auth.me.setData(undefined, null);
    
    // v268: 彻底清除所有认证凭据
    // 修复: 之前只清除了 ads-optimizer-user-info，但未清除 authToken 和 localUser
    // 导致退出后 authenticatedFetch 仍然在请求头中附带 Bearer token，
    // 后端验证通过后返回用户信息，造成自动重新登录
    localStorage.removeItem("authToken");       // JWT token（本地登录）
    localStorage.removeItem("localUser");       // 本地用户信息缓存
    localStorage.removeItem("ads-optimizer-user-info"); // auth.me 查询缓存副本
    
    // 清除所有可能的缓存
    try {
      await utils.auth.me.invalidate();
    } catch (e) {
      // 忽略 invalidate 错误
    }
    
    // 清除所有 React Query 缓存，确保不会残留任何用户数据
    try {
      utils.auth.me.setData(undefined, null);
    } catch (e) {
      // 忽略错误
    }
    
    // 跳转到前台首页（LandingPage）
    // 使用 window.location.href 强制完全重新加载页面
    // 确保所有内存中的状态（React state、tRPC cache）都被清除
    window.location.href = "/";
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    localStorage.setItem(
      "ads-optimizer-user-info",
      JSON.stringify(meQuery.data)
    );
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
