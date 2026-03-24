/**
 * v399: 通用全局账户ID Hook
 * 
 * 将全局店铺/站点选择器的选中状态转换为对应的 accountId。
 * 所有需要根据当前选中店铺加载数据的页面都应使用此 Hook，
 * 以确保全局选择器切换时数据能正确联动。
 * 
 * 替代了之前各页面中独立的 useState<number | null>(null) + 本地下拉选择器模式。
 */
import { useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useCurrentStore, useCurrentMarketplace, setCurrentSelection } from "@/components/GlobalAccountSelector";

export interface GlobalAccountIdResult {
  /** 当前选中的 accountId，null 表示尚未确定 */
  accountId: number | null;
  /** 账户列表是否正在加载 */
  isLoading: boolean;
  /** 账户列表 */
  accounts: unknown[] | undefined;
  /** 当前选中的店铺名 */
  currentStore: string | null;
  /** 当前选中的站点 */
  currentMarketplace: string | null;
}

export function useGlobalAccountId(): GlobalAccountIdResult {
  const currentStore = useCurrentStore();
  const currentMarketplace = useCurrentMarketplace();
  // @ts-ignore
  const { data: accounts, isLoading } = trpc.adAccount.list.useQuery() as unknown;

  // 根据全局选择器的店铺+站点查找对应的 accountId
  const accountId = useMemo(() => {
    if (!accounts || accounts.length === 0) return null;

    // 1. 精确匹配：店铺 + 站点
    if (currentStore && currentMarketplace) {
      // @ts-ignore
      const account = accounts.find((a: unknown) =>
        // @ts-ignore
        (a.storeName || a.accountName || '').trim() === currentStore &&
        // @ts-ignore
        a.marketplace === currentMarketplace
      );
      if (account) return account.id;
    }

    // 2. 模糊匹配：仅店铺
    if (currentStore) {
      const account = accounts.find((a: unknown) =>
        // @ts-ignore
        (a.storeName || a.accountName || '').trim() === currentStore
      );
      if (account) return account.id;
    }

    // 3. 兜底：使用第一个账号
    return accounts[0]?.id || null;
  }, [accounts, currentStore, currentMarketplace]);

  // 当账号列表加载完成但 localStorage 中没有选中的店铺时，自动选择第一个账号
  useEffect(() => {
    // @ts-ignore
    if (accounts && accounts.length > 0 && !currentStore) {
      const firstAccount = accounts[0] as unknown;
      // @ts-ignore
      const storeName = (firstAccount.storeName || firstAccount.accountName || '').trim();
      if (storeName) {
        // @ts-ignore
        setCurrentSelection(storeName, firstAccount.marketplace || null);
      }
    }
  }, [accounts, currentStore]);

  return {
    accountId,
    isLoading,
    accounts,
    currentStore,
    currentMarketplace,
  };
}
