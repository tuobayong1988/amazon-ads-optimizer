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
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Store,
  ChevronDown,
  Check,
  Plus,
  Settings,
  Globe,
  Loader2,
  Filter,
  X,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

// 区域定义
const REGIONS = [
  { 
    id: 'NA', 
    name: '北美区域', 
    flag: '🇺🇸',
    marketplaces: ['US', 'CA', 'MX', 'BR']
  },
  { 
    id: 'EU', 
    name: '欧洲区域', 
    flag: '🇪🇺',
    marketplaces: ['UK', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'PL', 'AE', 'SA', 'IN']
  },
  { 
    id: 'FE', 
    name: '远东区域', 
    flag: '🌏',
    marketplaces: ['JP', 'AU', 'SG']
  },
];

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

// 存储当前选中账号的key
const CURRENT_ACCOUNT_KEY = "current-ad-account-id";
const FILTER_REGION_KEY = "account-filter-region";
const FILTER_MARKETPLACE_KEY = "account-filter-marketplace";

// 创建一个简单的事件系统用于账号切换通知
type AccountChangeListener = (accountId: number | null) => void;
const listeners: Set<AccountChangeListener> = new Set();

export const onAccountChange = (listener: AccountChangeListener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notifyAccountChange = (accountId: number | null) => {
  listeners.forEach(listener => listener(accountId));
};

// 获取当前账号ID的hook
export function useCurrentAccountId() {
  const [accountId, setAccountId] = useState<number | null>(() => {
    const saved = localStorage.getItem(CURRENT_ACCOUNT_KEY);
    return saved ? parseInt(saved, 10) : null;
  });

  useEffect(() => {
    const unsubscribe = onAccountChange((newId) => {
      setAccountId(newId);
    });
    return () => { unsubscribe(); };
  }, []);

  return accountId;
}

// 设置当前账号ID
export function setCurrentAccountId(accountId: number | null) {
  if (accountId) {
    localStorage.setItem(CURRENT_ACCOUNT_KEY, accountId.toString());
  } else {
    localStorage.removeItem(CURRENT_ACCOUNT_KEY);
  }
  notifyAccountChange(accountId);
}

interface AccountSwitcherProps {
  compact?: boolean;
  showStatus?: boolean;
}

export default function AccountSwitcher({ compact = false, showStatus = true }: AccountSwitcherProps) {
  const [, setLocation] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const currentAccountId = useCurrentAccountId();
  
  // 筛选状态
  const [filterRegion, setFilterRegion] = useState<string | null>(() => {
    return localStorage.getItem(FILTER_REGION_KEY);
  });
  const [filterMarketplace, setFilterMarketplace] = useState<string | null>(() => {
    return localStorage.getItem(FILTER_MARKETPLACE_KEY);
  });

  // 获取账号列表
  // @ts-ignore
  const { data: accounts, isLoading, refetch } = trpc.adAccount.list.useQuery() as unknown;

  // 获取账号统计
  // @ts-ignore
  const { data: stats } = trpc.adAccount.getStats.useQuery() as unknown;

  // 设置默认账号mutation
  const setDefaultMutation = trpc.adAccount.setDefault.useMutation({
    onSuccess: () => {
      toast.success("已设为默认账号");
      refetch();
    },
  });

  // 保存筛选状态到localStorage
  useEffect(() => {
    if (filterRegion) {
      localStorage.setItem(FILTER_REGION_KEY, filterRegion);
    } else {
      localStorage.removeItem(FILTER_REGION_KEY);
    }
  }, [filterRegion]);

  useEffect(() => {
    if (filterMarketplace) {
      localStorage.setItem(FILTER_MARKETPLACE_KEY, filterMarketplace);
    } else {
      localStorage.removeItem(FILTER_MARKETPLACE_KEY);
    }
  }, [filterMarketplace]);

  // 根据区域获取可用的站点
  const availableMarketplaces = useMemo(() => {
    if (!filterRegion) return Object.keys(MARKETPLACE_FLAGS);
    const region = REGIONS.find(r => r.id === filterRegion);
    return region ? region.marketplaces : Object.keys(MARKETPLACE_FLAGS);
  }, [filterRegion]);

  // 筛选后的账号列表
  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];
    
    // @ts-expect-error - array method type inference
    return accounts.filter(account => {
      // 按区域筛选
      if (filterRegion) {
        const region = REGIONS.find(r => r.id === filterRegion);
        if (region && !region.marketplaces.includes(account.marketplace)) {
          return false;
        }
      }
      
      // 按站点筛选
      if (filterMarketplace && account.marketplace !== filterMarketplace) {
        return false;
      }
      
      return true;
    });
  }, [accounts, filterRegion, filterMarketplace]);

  // 当前选中的账号
  // @ts-expect-error - array method type inference
  const currentAccount = accounts?.find(a => a.id === currentAccountId);

  // 如果没有选中账号或选中的账号无效，自动选择默认账号或第一个
  useEffect(() => {
    if (accounts && accounts.length > 0) {
      // 检查当前选中的账号是否有效（存在于账号列表中）
      // @ts-expect-error - runtime type mismatch
      const isCurrentAccountValid = currentAccountId && accounts.some(a => a.id === currentAccountId);
      
      if (!isCurrentAccountValid) {
        // 选择默认账号或第一个账号
        // @ts-expect-error - array method type inference
        const defaultAccount = accounts.find(a => a.isDefault) || accounts[0];
        setCurrentAccountId(defaultAccount.id);
        // console.log('[AccountSwitcher] Auto-selected account:', defaultAccount.id, defaultAccount.storeName);
      }
    }
  }, [currentAccountId, accounts]);

  // 切换账号
  const handleSwitchAccount = useCallback((accountId: number) => {
    setCurrentAccountId(accountId);
    setIsOpen(false);
    toast.success("已切换账号");
  }, []);

  // 清除筛选
  const clearFilters = useCallback(() => {
    setFilterRegion(null);
    setFilterMarketplace(null);
    toast.success("已清除筛选");
  }, []);

  // 设置区域筛选
  const handleRegionFilter = useCallback((regionId: string | null) => {
    setFilterRegion(regionId);
    // 如果切换区域，清除站点筛选
    if (regionId !== filterRegion) {
      setFilterMarketplace(null);
    }
  }, [filterRegion]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt + 1-9 快速切换账号
      if (e.altKey && e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;
        if (filteredAccounts && filteredAccounts[index]) {
          e.preventDefault();
          handleSwitchAccount(filteredAccounts[index].id);
        }
      }
      // Alt + A 打开账号切换器
      if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredAccounts, handleSwitchAccount]);

  const getConnectionStatusColor = (status: string | null) => {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      case 'disconnected': return 'bg-gray-500';
      default: return 'bg-yellow-500';
    }
  };

  // 获取当前筛选的区域名称
  const currentRegionName = filterRegion 
    ? REGIONS.find(r => r.id === filterRegion)?.name 
    : null;

  // 获取当前筛选的站点名称
  const currentMarketplaceName = filterMarketplace 
    ? `${MARKETPLACE_FLAGS[filterMarketplace]} ${MARKETPLACE_NAMES[filterMarketplace]}`
    : null;

  // 是否有筛选条件
  const hasFilters = filterRegion || filterMarketplace;

  if (isLoading) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="hidden sm:inline">加载中...</span>
      </Button>
    );
  }

  if (!accounts || accounts.length === 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => setLocation('/amazon-api')}
      >
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">添加店铺</span>
      </Button>
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          className={`gap-2 ${compact ? 'h-8' : 'h-9'} max-w-[200px]`}
        >
          {currentAccount ? (
            <>
              <div
                className="w-5 h-5 rounded flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: currentAccount.storeColor || '#3B82F6' }}
              >
                {(currentAccount.storeName || currentAccount.accountName).charAt(0).toUpperCase()}
              </div>
              <span className="truncate hidden sm:inline">
                {currentAccount.storeName || currentAccount.accountName}
              </span>
              {showStatus && (
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${getConnectionStatusColor(currentAccount.connectionStatus)}`}
                />
              )}
            </>
          ) : (
            <>
              <Store className="h-4 w-4" />
              <span className="hidden sm:inline">选择账号</span>
            </>
          )}
          <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>店铺账号</span>
          {stats && (
            <Badge variant="secondary" className="text-xs">
              {stats.connected}/{stats.total} 已连接
            </Badge>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {/* 筛选区域 */}
        <div className="px-2 py-2 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Filter className="h-3 w-3" />
            <span>快速筛选</span>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-xs ml-auto"
                onClick={clearFilters}
              >
                <X className="h-3 w-3 mr-1" />
                清除
              </Button>
            )}
          </div>
          
          {/* 区域筛选按钮和站点筛选按钮 - 选择区域后自动展开站点 */}
          <div className="space-y-2">
            {/* 全部账号按钮 */}
            <div className="flex flex-wrap gap-1">
              <Button
                variant={!filterRegion ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs px-3"
                onClick={() => handleRegionFilter(null)}
              >
                🌐 全部账号
              </Button>
            </div>
            
            {/* 每个区域及其站点 */}
            {REGIONS.map(region => (
              <div key={region.id} className="space-y-1">
                {/* 区域标题按钮 */}
                <Button
                  variant={filterRegion === region.id && !filterMarketplace ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-3 w-full justify-start"
                  onClick={() => {
                    setFilterRegion(region.id);
                    setFilterMarketplace(null);
                  }}
                >
                  {region.flag} {region.name} ({region.marketplaces.length}个站点)
                </Button>
                
                {/* 该区域下的站点按钮 - 选中区域后自动展开 */}
                {filterRegion === region.id && (
                  <div className="flex flex-wrap gap-1 pl-4">
                    {region.marketplaces.map(mp => (
                      <Button
                        key={mp}
                        variant={filterMarketplace === mp ? "secondary" : "ghost"}
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={() => setFilterMarketplace(mp)}
                      >
                        {MARKETPLACE_FLAGS[mp]} {MARKETPLACE_NAMES[mp]}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {/* 当前筛选状态 */}
          {hasFilters && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
              筛选: {currentRegionName || '全部区域'}
              {currentMarketplaceName && ` → ${currentMarketplaceName}`}
              {' '}({filteredAccounts.length} 个账号)
            </div>
          )}
        </div>
        
        <DropdownMenuSeparator />
        
        {/* 账号列表 */}
        <div className="max-h-[250px] overflow-y-auto">
          {filteredAccounts.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              没有符合筛选条件的账号
            </div>
          ) : (
            filteredAccounts.map((account: unknown, index: unknown) => {
              const isSelected = (account as any).id === currentAccountId;
              const flag = MARKETPLACE_FLAGS[(account as any).marketplace] || '🌐';
              
              return (
                <DropdownMenuItem
                  // @ts-ignore
                  key={account.id}
                  className={`flex items-center gap-3 py-2.5 cursor-pointer ${isSelected ? 'bg-accent' : ''}`}
                  onClick={() => handleSwitchAccount((account as any).id)}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0"
                    // @ts-ignore
                    style={{ backgroundColor: account.storeColor || '#3B82F6' }}
                  >
                    {/* @ts-ignore */}
                    {/* @ts-ignore */}
                    {(account.storeName || account.accountName).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {/* @ts-ignore */}
                      <span className="font-medium truncate">
                        {/* @ts-ignore */}
                        {account.storeName || account.accountName}
                      </span>
                      {/* @ts-ignore */}
                      {!!account.isDefault && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">默认</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {/* @ts-ignore */}
                      <span>{flag} {MARKETPLACE_NAMES[account.marketplace] || account.marketplace}</span>
                      <span
                        // @ts-ignore
                        className={`w-1.5 h-1.5 rounded-full ${getConnectionStatusColor(account.connectionStatus)}`}
                      />
                    </div>
                  </div>
                  {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                  {(index as any) < 9 && (
                    <DropdownMenuShortcut>Alt+{(index as any) + 1}</DropdownMenuShortcut>
                  )}
                </DropdownMenuItem>
              );
            })
          )}
        </div>

        <DropdownMenuSeparator />
        
        <DropdownMenuItem
          className="gap-2 cursor-pointer"
          onClick={() => {
            setIsOpen(false);
            setLocation('/amazon-api');
          }}
        >
          <Plus className="h-4 w-4" />
          添加新店铺
        </DropdownMenuItem>
        
        <DropdownMenuItem
          className="gap-2 cursor-pointer"
          onClick={() => {
            setIsOpen(false);
            setLocation('/accounts-summary');
          }}
        >
          <Globe className="h-4 w-4" />
          跨账号汇总
        </DropdownMenuItem>
        
        <DropdownMenuItem
          className="gap-2 cursor-pointer"
          onClick={() => {
            setIsOpen(false);
            setLocation('/amazon-api');
          }}
        >
          <Settings className="h-4 w-4" />
          管理账号
          <DropdownMenuShortcut>Alt+A</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
