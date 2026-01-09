import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, ChevronDown, Check } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn } from "@/lib/utils";

// 预设时间范围类型
export type PresetTimeRange = 'today' | 'yesterday' | '7days' | '14days' | '30days' | '60days' | '90days' | '180days' | '365days' | 'all' | 'custom';

// 时间范围配置
export const TIME_RANGE_PRESETS: Record<Exclude<PresetTimeRange, 'custom'>, { label: string; days: number }> = {
  'today': { label: '今天', days: 0 },
  'yesterday': { label: '昨天', days: 1 },
  '7days': { label: '近7天', days: 7 },
  '14days': { label: '近14天', days: 14 },
  '30days': { label: '近30天', days: 30 },
  '60days': { label: '近60天', days: 60 },
  '90days': { label: '近90天', days: 90 },
  '180days': { label: '近180天', days: 180 },
  '365days': { label: '近1年', days: 365 },
  'all': { label: '全部数据', days: 9999 }, // 特殊值，表示获取所有可用数据
};

export interface DateRange {
  from: Date;
  to: Date;
}

export interface TimeRangeValue {
  preset: PresetTimeRange;
  dateRange: DateRange;
  days: number;
}

interface TimeRangeSelectorProps {
  value: TimeRangeValue;
  onChange: (value: TimeRangeValue) => void;
  className?: string;
  /** 数据可用的最早日期（用于限制日历选择范围） */
  minDataDate?: Date;
  /** 数据可用的最晚日期（用于限制日历选择范围） */
  maxDataDate?: Date;
  /** 是否有数据 */
  hasData?: boolean;
}

// 根据预设计算日期范围
function getDateRangeFromPreset(preset: Exclude<PresetTimeRange, 'custom'>, minDataDate?: Date): DateRange {
  const now = new Date();
  const config = TIME_RANGE_PRESETS[preset];
  
  if (preset === 'today') {
    return {
      from: startOfDay(now),
      to: endOfDay(now),
    };
  }
  
  if (preset === 'yesterday') {
    const yesterday = subDays(now, 1);
    return {
      from: startOfDay(yesterday),
      to: endOfDay(yesterday),
    };
  }
  
  // 全部数据：从最早可用日期开始
  if (preset === 'all') {
    return {
      from: minDataDate ? startOfDay(minDataDate) : startOfDay(subDays(now, 365)), // 默认1年
      to: endOfDay(now),
    };
  }
  
  return {
    from: startOfDay(subDays(now, config.days)),
    to: endOfDay(now),
  };
}

// 计算日期范围的天数
function getDaysFromDateRange(dateRange: DateRange): number {
  const diffTime = Math.abs(dateRange.to.getTime() - dateRange.from.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

export function TimeRangeSelector({ 
  value, 
  onChange, 
  className,
  minDataDate,
  maxDataDate,
  hasData = true,
}: TimeRangeSelectorProps) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(value.dateRange);

  // 获取显示标签
  const getDisplayLabel = () => {
    if (value.preset === 'custom') {
      return `${format(value.dateRange.from, 'MM/dd', { locale: zhCN })} - ${format(value.dateRange.to, 'MM/dd', { locale: zhCN })}`;
    }
    return TIME_RANGE_PRESETS[value.preset].label;
  };

  // 选择预设时间范围
  const handlePresetSelect = (preset: Exclude<PresetTimeRange, 'custom'>) => {
    const dateRange = getDateRangeFromPreset(preset, minDataDate);
    let days: number;
    if (preset === 'today' || preset === 'yesterday') {
      days = 1;
    } else if (preset === 'all') {
      days = getDaysFromDateRange(dateRange);
    } else {
      days = TIME_RANGE_PRESETS[preset].days;
    }
    onChange({
      preset,
      dateRange,
      days,
    });
  };

  // 应用自定义日期范围
  const handleApplyCustomRange = () => {
    if (tempDateRange?.from && tempDateRange?.to) {
      const days = getDaysFromDateRange(tempDateRange);
      onChange({
        preset: 'custom',
        dateRange: tempDateRange,
        days,
      });
      setIsCalendarOpen(false);
    }
  };

  // 日历选择处理
  const handleCalendarSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (range?.from) {
      setTempDateRange({
        from: range.from,
        to: range.to || range.from,
      });
    }
  };

  // 日期禁用函数
  const isDateDisabled = (date: Date) => {
    const today = new Date();
    // 不能选择未来日期
    if (date > today) return true;
    // 如果有最早数据日期限制
    if (minDataDate && date < minDataDate) return true;
    // 如果有最晚数据日期限制
    if (maxDataDate && date > maxDataDate) return true;
    return false;
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="min-w-[140px] justify-between">
            <span className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4" />
              {getDisplayLabel()}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[200px]">
          {(Object.keys(TIME_RANGE_PRESETS) as Exclude<PresetTimeRange, 'custom'>[]).map((preset) => (
            <DropdownMenuItem
              key={preset}
              onClick={() => handlePresetSelect(preset)}
              className="flex items-center justify-between"
            >
              <span>{TIME_RANGE_PRESETS[preset].label}</span>
              {value.preset === preset && <Check className="h-4 w-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
            <PopoverTrigger asChild>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setIsCalendarOpen(true);
                  setTempDateRange(value.dateRange);
                }}
                className="flex items-center justify-between"
              >
                <span>自定义日期范围</span>
                {value.preset === 'custom' && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end" side="bottom" sideOffset={8}>
              <div className="p-3">
                {/* 数据可用范围提示 */}
                {minDataDate && (
                  <div className="mb-3 p-2 bg-blue-500/10 border border-blue-500/20 rounded-md text-xs text-blue-400">
                    <CalendarIcon className="h-3 w-3 inline mr-1" />
                    数据可用范围：{format(minDataDate, 'yyyy/MM/dd', { locale: zhCN })} - {format(maxDataDate || new Date(), 'yyyy/MM/dd', { locale: zhCN })}
                  </div>
                )}
                <Calendar
                  mode="range"
                  selected={{
                    from: tempDateRange?.from,
                    to: tempDateRange?.to,
                  }}
                  onSelect={handleCalendarSelect}
                  numberOfMonths={2}
                  locale={zhCN}
                  disabled={isDateDisabled}
                  defaultMonth={tempDateRange?.from || subDays(new Date(), 30)}
                />
                <div className="flex items-center justify-between mt-3 pt-3 border-t">
                  <div className="text-sm text-muted-foreground">
                    {tempDateRange?.from && tempDateRange?.to ? (
                      <>
                        {format(tempDateRange.from, 'yyyy/MM/dd', { locale: zhCN })} - {format(tempDateRange.to, 'yyyy/MM/dd', { locale: zhCN })}
                        <span className="ml-2 text-blue-400">({getDaysFromDateRange(tempDateRange)}天)</span>
                      </>
                    ) : (
                      '请选择日期范围'
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsCalendarOpen(false)}
                    >
                      取消
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleApplyCustomRange}
                      disabled={!tempDateRange?.from || !tempDateRange?.to}
                    >
                      应用
                    </Button>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// 默认值生成函数
export function getDefaultTimeRangeValue(preset: Exclude<PresetTimeRange, 'custom'> = '7days'): TimeRangeValue {
  const dateRange = getDateRangeFromPreset(preset);
  const days = preset === 'today' || preset === 'yesterday' ? 1 : TIME_RANGE_PRESETS[preset].days;
  return {
    preset,
    dateRange,
    days,
  };
}
