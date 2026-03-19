import { useState, useEffect, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  Check,
  Loader2,
  Store,
  Globe,
} from "lucide-react";
import { toast } from "sonner";

// 市场标志映射
const MARKETPLACE_FLAGS: Record<string, string> = {
  US: "🇺🇸",
  CA: "🇨🇦",
  MX: "🇲🇽",
  BR: "🇧🇷",
  UK: "🇬🇧",
  DE: "🇩🇪",
  FR: "🇫🇷",
  IT: "🇮🇹",
  ES: "🇪🇸",
  NL: "🇳🇱",
  SE: "🇸🇪",
  PL: "🇵🇱",
  JP: "🇯🇵",
  AU: "🇦🇺",
  SG: "🇸🇬",
  AE: "🇦🇪",
  SA: "🇸🇦",
  IN: "🇮🇳",
};

// 市场名称映射
const MARKETPLACE_NAMES: Record<string, string> = {
  US: "美国",
  CA: "加拿大",
  MX: "墨西哥",
  BR: "巴西",
  UK: "英国",
  DE: "德国",
  FR: "法国",
  IT: "意大利",
  ES: "西班牙",
  NL: "荷兰",
  SE: "瑞典",
  PL: "波兰",
  JP: "日本",
  AU: "澳大利亚",
  SG: "新加坡",
  AE: "阿联酋",
  SA: "沙特",
  IN: "印度",
};

// 存储keys
const CURRENT_STORE_KEY = "global-selected-store";
const CURRENT_MARKETPLACE_KEY = "global-selected-marketplace";

// 事件系统
type SelectionChangeListener = () => void;
const listeners: Set<SelectionChangeListener> = new Set();

export const onSelectionChange = (listener: SelectionChangeListener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notifySelectionChange = () => {
  listeners.forEach(listener => listener());
};

// 获取当前选中的店铺名
export function useCurrentStore() {
  const [store, setStore] = useState<string | null>(() => {
    return localStorage.getItem(CURRENT_STORE_KEY);
  });

  useEffect(() => {
    const unsubscribe = onSelectionChange(() => {
      setStore(localStorage.getItem(CURRENT_STORE_KEY));
    });
    return () => { unsubscribe(); };
  }, []);

  return store;
}

// 获取当前选中的站点
export function useCurrentMarketplace() {
  const [marketplace, setMarketplace] = useState<string | null>(() => {
    return localStorage.getItem(CURRENT_MARKETPLACE_KEY);
  });

  useEffect(() => {
    const unsubscribe = onSelectionChange(() => {
      setMarketplace(localStorage.getItem(CURRENT_MARKETPLACE_KEY));
    });
    return () => { unsubscribe(); };
  }, []);

  return marketplace;
}

// 设置当前选中的店铺和站点
export function setCurrentSelection(store: string | null, marketplace: string | null) {
  if (store) {
    localStorage.setItem(CURRENT_STORE_KEY, store);
  } else {
    localStorage.removeItem(CURRENT_STORE_KEY);
  }
  
  if (marketplace) {
    localStorage.setItem(CURRENT_MARKETPLACE_KEY, marketplace);
  } else {
    localStorage.removeItem(CURRENT_MARKETPLACE_KEY);
  }
  
  notifySelectionChange();
}

interface GlobalAccountSelectorProps {
  compact?: boolean;
}

export default function GlobalAccountSelector({ compact = false }: GlobalAccountSelectorProps) {
  const [isStoreOpen, setIsStoreOpen] = useState(false);
  const [isMarketplaceOpen, setIsMarketplaceOpen] = useState(false);
  
  const currentStore = useCurrentStore();
  const currentMarketplace = useCurrentMarketplace();

  // 获取账号列表
  const { data: accounts, isLoading } = trpc.adAccount.list.useQuery() as unknown;

  // 获取唯一的店铺列表（trim空格避免匹配问题）
  const stores = useMemo(() => {
    if (!accounts) return [];
    const uniqueStores = new Set<string>();
    // @ts-expect-error - runtime type mismatch
    accounts.forEach(account => {
      const storeName = (account.storeName || account.accountName).trim();
      uniqueStores.add(storeName);
    });
    return Array.from(uniqueStores).sort();
  }, [accounts]);

  // 获取当前店铺的站点列表（trim空格避免匹配问题）
  const marketplaces = useMemo(() => {
    if (!accounts || !currentStore) return [];
    const uniqueMarketplaces = new Set<string>();
    // @ts-expect-error - runtime type mismatch
    accounts.forEach(account => {
      const storeName = (account.storeName || account.accountName).trim();
      if (storeName === currentStore) {
        uniqueMarketplaces.add(account.marketplace);
      }
    });
    return Array.from(uniqueMarketplaces).sort();
  }, [accounts, currentStore]);

  // 自动选择默认店铺和站点
  useEffect(() => {
    if (accounts && accounts.length > 0) {
      // 如果没有选中店铺，选择第一个（trim空格）
      if (!currentStore || !stores.includes(currentStore)) {
        const firstAccount = accounts[0] as unknown;
        const firstStore = (firstAccount.storeName || firstAccount.accountName).trim();
        const firstMarketplace = firstAccount.marketplace;
        setCurrentSelection(firstStore, firstMarketplace);
        // console.log('[GlobalAccountSelector] Auto-selected:', firstStore, firstMarketplace);
      }
      // 如果选中了店铺但没有选中站点，或者站点不属于当前店铺
      else if (!currentMarketplace) {
        // 没有选中站点，优先选US，否则选第一个
        if (marketplaces.length > 0) {
          const target = marketplaces.includes('US') ? 'US' : marketplaces[0];
          setCurrentSelection(currentStore, target);
          // console.log('[GlobalAccountSelector] Auto-selected marketplace:', target);
        }
      }
      else if (!marketplaces.includes(currentMarketplace)) {
        // 当前站点不属于当前店铺，直接从accounts重新计算确认（避免竞态条件）
        const currentStoreMarketplaces = accounts
          // @ts-expect-error - array method type inference
          .filter(a => (a.storeName || a.accountName).trim() === currentStore)
          // @ts-expect-error - array method type inference
          .map(a => a.marketplace);
        if (!currentStoreMarketplaces.includes(currentMarketplace)) {
          // 确实不属于当前店铺，才重置
          const target = currentStoreMarketplaces.includes('US') ? 'US' : (currentStoreMarketplaces[0] || null);
          if (target) {
            setCurrentSelection(currentStore, target);
            // console.log('[GlobalAccountSelector] Marketplace not in store, reset to:', target);
          }
        }
      }
    }
  }, [accounts, currentStore, currentMarketplace, stores, marketplaces]);

  // 切换店铺 - 优先保持当前站点不变
  const handleStoreChange = useCallback((store: string) => {
    // 获取该店铺的所有站点
    // @ts-expect-error - array method type inference
    const storeAccounts = accounts?.filter(a => 
      (a.storeName || a.accountName).trim() === store
    );
    // @ts-expect-error - array method type inference
    const storeMarketplaces = storeAccounts?.map(a => a.marketplace) || [];
    
    // 如果新店铺也有当前选中的站点，则保持不变
    let targetMarketplace: string | null;
    if (currentMarketplace && storeMarketplaces.includes(currentMarketplace)) {
      targetMarketplace = currentMarketplace;
    } else {
      // 否则按优先级选择：US > 第一个可用站点
      targetMarketplace = storeMarketplaces.includes('US') 
        ? 'US' 
        : (storeMarketplaces[0] || null);
    }
    
    setCurrentSelection(store, targetMarketplace);
    setIsStoreOpen(false);
    const marketplaceName = targetMarketplace ? (MARKETPLACE_NAMES[targetMarketplace] || targetMarketplace) : '';
    toast.success(`已切换到店铺: ${store}${marketplaceName ? ` (${marketplaceName})` : ''}`);
  }, [accounts, currentMarketplace]);

  // 切换站点
  const handleMarketplaceChange = useCallback((marketplace: string) => {
    setCurrentSelection(currentStore, marketplace);
    setIsMarketplaceOpen(false);
    toast.success(`已切换到站点: ${MARKETPLACE_NAMES[marketplace] || marketplace}`);
  }, [currentStore]);

  if (isLoading) {
    return (
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled className="gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="hidden sm:inline">加载中...</span>
        </Button>
      </div>
    );
  }

  if (!accounts || accounts.length === 0) {
    return (
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled>
          <Store className="h-4 w-4 mr-2" />
          <span className="hidden sm:inline">无店铺</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {/* 店铺选择器 */}
      <DropdownMenu open={isStoreOpen} onOpenChange={setIsStoreOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size={compact ? "sm" : "default"}
            className={`gap-2 ${compact ? 'h-8' : 'h-9'} min-w-[120px]`}
          >
            <Store className="h-4 w-4 shrink-0" />
            <span className="truncate max-w-[100px] sm:max-w-[150px]">
              {currentStore || "选择店铺"}
            </span>
            <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>选择店铺</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {stores.map((store: unknown) => (
            <DropdownMenuItem
              key={store}
              onClick={() => handleStoreChange(store)}
              className="flex items-center justify-between cursor-pointer"
            >
              <span className="truncate">{store}</span>
              {currentStore === store && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 站点选择器 */}
      <DropdownMenu open={isMarketplaceOpen} onOpenChange={setIsMarketplaceOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size={compact ? "sm" : "default"}
            className={`gap-2 ${compact ? 'h-8' : 'h-9'} min-w-[120px]`}
            disabled={!currentStore}
          >
            <Globe className="h-4 w-4 shrink-0" />
            <span className="truncate max-w-[100px] sm:max-w-[150px]">
              {currentMarketplace 
                ? `${MARKETPLACE_FLAGS[currentMarketplace] || ''} ${MARKETPLACE_NAMES[currentMarketplace] || currentMarketplace}`
                : "选择站点"
              }
            </span>
            <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>选择站点</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {marketplaces.map((marketplace: unknown) => (
            <DropdownMenuItem
              key={marketplace}
              onClick={() => handleMarketplaceChange(marketplace)}
              className="flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <span>{MARKETPLACE_FLAGS[marketplace] || ''}</span>
                <span>{MARKETPLACE_NAMES[marketplace] || marketplace}</span>
              </span>
              {currentMarketplace === marketplace && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
