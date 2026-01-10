import { useState, useEffect, useCallback } from 'react';

/**
 * 筛选预设类型
 */
export interface FilterPreset {
  id: string;
  name: string;
  filters: Record<string, string>;
  createdAt: number;
}

/**
 * 筛选预设管理Hook
 */
export function useFilterPresets(storageKey: string) {
  const [presets, setPresets] = useState<FilterPreset[]>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [];
  });

  // 保存到localStorage
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(presets));
  }, [presets, storageKey]);

  // 添加预设
  const addPreset = useCallback((name: string, filters: Record<string, string>) => {
    const newPreset: FilterPreset = {
      id: `preset_${Date.now()}`,
      name,
      filters,
      createdAt: Date.now(),
    };
    setPresets(prev => [...prev, newPreset]);
    return newPreset;
  }, []);

  // 更新预设
  const updatePreset = useCallback((id: string, updates: Partial<Omit<FilterPreset, 'id' | 'createdAt'>>) => {
    setPresets(prev => prev.map(preset => 
      preset.id === id ? { ...preset, ...updates } : preset
    ));
  }, []);

  // 删除预设
  const deletePreset = useCallback((id: string) => {
    setPresets(prev => prev.filter(preset => preset.id !== id));
  }, []);

  // 获取预设
  const getPreset = useCallback((id: string) => {
    return presets.find(preset => preset.id === id);
  }, [presets]);

  return {
    presets,
    addPreset,
    updatePreset,
    deletePreset,
    getPreset,
  };
}
