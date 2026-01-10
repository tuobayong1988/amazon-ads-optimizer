import { useState, useRef, useCallback, useEffect } from 'react';
import { GripVertical, Pin, PinOff } from 'lucide-react';

export interface ColumnDef {
  key: string;
  label: string;
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
  resizable?: boolean;
  pinnable?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface ResizableTableProps {
  columns: ColumnDef[];
  storageKey?: string;
  onColumnWidthChange?: (key: string, width: number) => void;
  onColumnPinChange?: (key: string, pinned: boolean) => void;
}

// 列宽和固定状态管理hook
export function useResizableColumns(
  columns: ColumnDef[],
  storageKey?: string
) {
  // 从localStorage读取保存的列宽
  const getInitialWidths = useCallback(() => {
    if (storageKey) {
      const saved = localStorage.getItem(`${storageKey}_widths`);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          // ignore
        }
      }
    }
    const widths: Record<string, number> = {};
    columns.forEach(col => {
      widths[col.key] = col.defaultWidth || 150;
    });
    return widths;
  }, [columns, storageKey]);

  // 从localStorage读取保存的固定列
  const getInitialPinned = useCallback(() => {
    if (storageKey) {
      const saved = localStorage.getItem(`${storageKey}_pinned`);
      if (saved) {
        try {
          return new Set<string>(JSON.parse(saved));
        } catch {
          // ignore
        }
      }
    }
    return new Set<string>();
  }, [storageKey]);

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(getInitialWidths);
  const [pinnedColumns, setPinnedColumns] = useState<Set<string>>(getInitialPinned);
  const [resizing, setResizing] = useState<string | null>(null);

  // 保存到localStorage
  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(`${storageKey}_widths`, JSON.stringify(columnWidths));
    }
  }, [columnWidths, storageKey]);

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(`${storageKey}_pinned`, JSON.stringify(Array.from(pinnedColumns)));
    }
  }, [pinnedColumns, storageKey]);

  // 调整列宽
  const handleResize = useCallback((key: string, delta: number) => {
    setColumnWidths(prev => {
      const col = columns.find(c => c.key === key);
      const currentWidth = prev[key] || col?.defaultWidth || 150;
      const minWidth = col?.minWidth || 50;
      const maxWidth = col?.maxWidth || 500;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, currentWidth + delta));
      return { ...prev, [key]: newWidth };
    });
  }, [columns]);

  // 开始调整
  const startResize = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(key);
    
    const startX = e.clientX;
    const startWidth = columnWidths[key] || columns.find(c => c.key === key)?.defaultWidth || 150;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      handleResize(key, delta - (columnWidths[key] - startWidth));
    };

    const handleMouseUp = () => {
      setResizing(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [columnWidths, columns, handleResize]);

  // 切换固定状态
  const togglePin = useCallback((key: string) => {
    setPinnedColumns(prev => {
      const newPinned = new Set(prev);
      if (newPinned.has(key)) {
        newPinned.delete(key);
      } else {
        newPinned.add(key);
      }
      return newPinned;
    });
  }, []);

  // 重置列宽
  const resetWidths = useCallback(() => {
    const widths: Record<string, number> = {};
    columns.forEach(col => {
      widths[col.key] = col.defaultWidth || 150;
    });
    setColumnWidths(widths);
  }, [columns]);

  // 重置固定列
  const resetPinned = useCallback(() => {
    setPinnedColumns(new Set());
  }, []);

  // 计算固定列的左偏移量
  const getPinnedOffset = useCallback((key: string) => {
    let offset = 0;
    for (const col of columns) {
      if (col.key === key) break;
      if (pinnedColumns.has(col.key)) {
        offset += columnWidths[col.key] || col.defaultWidth || 150;
      }
    }
    return offset;
  }, [columns, pinnedColumns, columnWidths]);

  return {
    columnWidths,
    pinnedColumns,
    resizing,
    startResize,
    togglePin,
    resetWidths,
    resetPinned,
    getPinnedOffset,
    isPinned: (key: string) => pinnedColumns.has(key),
    getWidth: (key: string) => columnWidths[key] || columns.find(c => c.key === key)?.defaultWidth || 150,
  };
}

// 列头调整手柄组件
export function ResizeHandle({
  onMouseDown,
  isResizing,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  isResizing: boolean;
}) {
  return (
    <div
      className={`absolute right-0 top-0 h-full w-1 cursor-col-resize group hover:bg-primary/50 ${
        isResizing ? 'bg-primary' : ''
      }`}
      onMouseDown={onMouseDown}
    >
      <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="w-3 h-3 text-muted-foreground" />
      </div>
    </div>
  );
}

// 固定列按钮组件
export function PinButton({
  isPinned,
  onClick,
}: {
  isPinned: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`p-1 rounded hover:bg-muted/50 transition-colors ${
        isPinned ? 'text-primary' : 'text-muted-foreground'
      }`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={isPinned ? '取消固定' : '固定列'}
    >
      {isPinned ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
    </button>
  );
}
