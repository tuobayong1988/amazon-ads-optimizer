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
  const { data: accounts, isLoading } = trpc.adAccount.list.useQuery();

  // 获取唯一的店铺列表
  const stores = useMemo(() => {
    if (!accounts) return [];
    const uniqueStores = new Set<string>();
    accounts.forEach(account => {
      const storeName = account.storeName || account.accountName;
      uniqueStores.add(storeName);
    });
    return Array.from(uniqueStores).sort();
  }, [accounts]);

  // 获取当前店铺的站点列表
  const marketplaces = useMemo(() => {
    if (!accounts || !currentStore) return [];
    const uniqueMarketplaces = new Set<string>();
    accounts.forEach(account => {
      const storeName = account.storeName || account.accountName;
      if (storeName === currentStore) {
        uniqueMarketplaces.add(account.marketplace);
      }
    });
    return Array.from(uniqueMarketplaces).sort();
  }, [accounts, currentStore]);

  // 自动选择默认店铺和站点
  useEffect(() => {
    if (accounts && accounts.length > 0) {
      // 如果没有选中店铺，选择第一个
      if (!currentStore || !stores.includes(currentStore)) {
        const firstAccount = accounts[0];
        const firstStore = firstAccount.storeName || firstAccount.accountName;
        const firstMarketplace = firstAccount.marketplace;
        setCurrentSelection(firstStore, firstMarketplace);
        console.log('[GlobalAccountSelector] Auto-selected:', firstStore, firstMarketplace);
      }
      // 如果选中了店铺但没有选中站点，或者站点不在当前店铺的站点列表中
      else if (!currentMarketplace || !marketplaces.includes(currentMarketplace)) {
        if (marketplaces.length > 0) {
          setCurrentSelection(currentStore, marketplaces[0]);
          console.log('[GlobalAccountSelector] Auto-selected marketplace:', marketplaces[0]);
        }
      }
    }
  }, [accounts, currentStore, currentMarketplace, stores, marketplaces]);

  // 切换店铺
  const handleStoreChange = useCallback((store: string) => {
    // 获取该店铺的第一个站点
    const storeAccounts = accounts?.filter(a => 
      (a.storeName || a.accountName) === store
    );
    const firstMarketplace = storeAccounts?.[0]?.marketplace || null;
    
    setCurrentSelection(store, firstMarketplace);
    setIsStoreOpen(false);
    toast.success(`已切换到店铺: ${store}`);
  }, [accounts]);

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
            <span className="truncate hidden sm:inline">
              {currentStore || "选择店铺"}
            </span>
            <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>选择店铺</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {stores.map((store) => (
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
            <span className="truncate hidden sm:inline">
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
          {marketplaces.map((marketplace) => (
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
