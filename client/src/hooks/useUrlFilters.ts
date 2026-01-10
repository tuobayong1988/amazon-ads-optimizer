import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * 筛选条件URL持久化Hook
 * 将筛选条件同步到URL参数，支持分享链接和浏览器前进后退
 */
export interface FilterConfig<T> {
  key: string;
  defaultValue: T;
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
}

export function useUrlFilters<T extends Record<string, any>>(
  configs: FilterConfig<T[keyof T]>[],
  options?: {
    debounceMs?: number;
    replaceState?: boolean;
  }
) {
  const { debounceMs = 300, replaceState = true } = options || {};

  // 从URL读取初始值
  const getInitialValues = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const values: Record<string, any> = {};
    configs.forEach(config => {
      const urlValue = params.get(config.key);
      if (urlValue !== null) {
        values[config.key] = config.deserialize 
          ? config.deserialize(urlValue) 
          : urlValue;
      } else {
        values[config.key] = config.defaultValue;
      }
    });
    return values as T;
  }, [configs]);

  const [filters, setFiltersState] = useState<T>(getInitialValues);
  const [pendingUpdate, setPendingUpdate] = useState<T | null>(null);

  // 监听浏览器前进后退
  useEffect(() => {
    const handlePopState = () => {
      const newValues = getInitialValues();
      setFiltersState(newValues);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [getInitialValues]);

  // 防抖更新URL
  useEffect(() => {
    if (pendingUpdate === null) return;

    const timer = setTimeout(() => {
      const newParams = new URLSearchParams(window.location.search);
      
      configs.forEach(config => {
        const value = pendingUpdate[config.key as keyof T];
        const serialized = config.serialize 
          ? config.serialize(value) 
          : String(value);
        
        // 如果是默认值，从URL中移除
        const defaultSerialized = config.serialize 
          ? config.serialize(config.defaultValue) 
          : String(config.defaultValue);
        
        if (serialized === defaultSerialized) {
          newParams.delete(config.key);
        } else {
          newParams.set(config.key, serialized);
        }
      });

      const newUrl = `${window.location.pathname}${newParams.toString() ? '?' + newParams.toString() : ''}`;
      
      if (replaceState) {
        window.history.replaceState(null, '', newUrl);
      } else {
        window.history.pushState(null, '', newUrl);
      }
      
      setPendingUpdate(null);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [pendingUpdate, configs, debounceMs, replaceState]);

  // 更新单个筛选条件
  const setFilter = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setFiltersState(prev => {
      const newFilters = { ...prev, [key]: value };
      setPendingUpdate(newFilters);
      return newFilters;
    });
  }, []);

  // 批量更新筛选条件
  const setFilters = useCallback((newFilters: Partial<T>) => {
    setFiltersState(prev => {
      const updated = { ...prev, ...newFilters };
      setPendingUpdate(updated);
      return updated;
    });
  }, []);

  // 重置所有筛选条件
  const resetFilters = useCallback(() => {
    const defaultValues: Record<string, any> = {};
    configs.forEach(config => {
      defaultValues[config.key] = config.defaultValue;
    });
    setFiltersState(defaultValues as T);
    setPendingUpdate(defaultValues as T);
  }, [configs]);

  // 获取可分享的URL
  const getShareableUrl = useCallback(() => {
    const url = new URL(window.location.href);
    configs.forEach(config => {
      const value = filters[config.key as keyof T];
      const serialized = config.serialize 
        ? config.serialize(value) 
        : String(value);
      const defaultSerialized = config.serialize 
        ? config.serialize(config.defaultValue) 
        : String(config.defaultValue);
      
      if (serialized !== defaultSerialized) {
        url.searchParams.set(config.key, serialized);
      } else {
        url.searchParams.delete(config.key);
      }
    });
    return url.toString();
  }, [filters, configs]);

  return {
    filters,
    setFilter,
    setFilters,
    resetFilters,
    getShareableUrl,
  };
}

// 常用的序列化/反序列化函数
export const serializers = {
  string: {
    serialize: (v: string) => v,
    deserialize: (v: string) => v,
  },
  number: {
    serialize: (v: number) => String(v),
    deserialize: (v: string) => Number(v),
  },
  boolean: {
    serialize: (v: boolean) => v ? '1' : '0',
    deserialize: (v: string) => v === '1',
  },
  array: {
    serialize: (v: string[]) => v.join(','),
    deserialize: (v: string) => v ? v.split(',') : [],
  },
  date: {
    serialize: (v: Date) => v.toISOString().split('T')[0],
    deserialize: (v: string) => new Date(v),
  },
};
