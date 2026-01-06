import { useState, useEffect, useCallback } from "react";
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
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Store,
  ChevronDown,
  Check,
  Plus,
  Settings,
  RefreshCw,
  Globe,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useLocation } from "wouter";
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

// 存储当前选中账号的key
const CURRENT_ACCOUNT_KEY = "current-ad-account-id";

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

  // 获取账号列表
  const { data: accounts, isLoading, refetch } = trpc.adAccount.list.useQuery();

  // 获取账号统计
  const { data: stats } = trpc.adAccount.getStats.useQuery();

  // 设置默认账号mutation
  const setDefaultMutation = trpc.adAccount.setDefault.useMutation({
    onSuccess: () => {
      toast.success("已设为默认账号");
      refetch();
    },
  });

  // 当前选中的账号
  const currentAccount = accounts?.find(a => a.id === currentAccountId);

  // 如果没有选中账号但有账号列表，自动选择默认账号或第一个
  useEffect(() => {
    if (!currentAccountId && accounts && accounts.length > 0) {
      const defaultAccount = accounts.find(a => a.isDefault) || accounts[0];
      setCurrentAccountId(defaultAccount.id);
    }
  }, [currentAccountId, accounts]);

  // 切换账号
  const handleSwitchAccount = useCallback((accountId: number) => {
    setCurrentAccountId(accountId);
    setIsOpen(false);
    toast.success("已切换账号");
  }, []);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt + 1-9 快速切换账号
      if (e.altKey && e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;
        if (accounts && accounts[index]) {
          e.preventDefault();
          handleSwitchAccount(accounts[index].id);
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
  }, [accounts, handleSwitchAccount]);

  const getConnectionStatusColor = (status: string | null) => {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      case 'disconnected': return 'bg-gray-500';
      default: return 'bg-yellow-500';
    }
  };

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
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>店铺账号</span>
          {stats && (
            <Badge variant="secondary" className="text-xs">
              {stats.connected}/{stats.total} 已连接
            </Badge>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        <div className="max-h-[300px] overflow-y-auto">
          {accounts.map((account, index) => {
            const isSelected = account.id === currentAccountId;
            const flag = MARKETPLACE_FLAGS[account.marketplace] || '🌐';
            
            return (
              <DropdownMenuItem
                key={account.id}
                className={`flex items-center gap-3 py-2.5 cursor-pointer ${isSelected ? 'bg-accent' : ''}`}
                onClick={() => handleSwitchAccount(account.id)}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0"
                  style={{ backgroundColor: account.storeColor || '#3B82F6' }}
                >
                  {(account.storeName || account.accountName).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">
                      {account.storeName || account.accountName}
                    </span>
                    {account.isDefault && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0">默认</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{flag} {account.marketplace}</span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${getConnectionStatusColor(account.connectionStatus)}`}
                    />
                  </div>
                </div>
                {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                {index < 9 && (
                  <DropdownMenuShortcut>Alt+{index + 1}</DropdownMenuShortcut>
                )}
              </DropdownMenuItem>
            );
          })}
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
