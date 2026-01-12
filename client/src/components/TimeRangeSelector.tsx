import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, ChevronDown, Check, X, ChevronLeft, ChevronRight } from "lucide-react";
import { format, subDays, startOfDay, endOfDay, addMonths, subMonths } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn } from "@/lib/utils";

// 预设时间范围类型
export type PresetTimeRange = 'today' | 'yesterday' | '7days' | '14days' | '30days' | '60days' | '90days' | 'custom';

// 时间范围配置 - 按显示顺序排列
export const TIME_RANGE_PRESETS: Record<Exclude<PresetTimeRange, 'custom'>, { label: string; days: number }> = {
  'today': { label: '今天', days: 0 },
  'yesterday': { label: '昨天', days: 1 },
  '7days': { label: '近7天', days: 7 },
  '14days': { label: '近14天', days: 14 },
  '30days': { label: '近30天', days: 30 },
  '60days': { label: '近60天', days: 60 },
  '90days': { label: '近90天', days: 90 },
};

// 时间范围显示顺序
const TIME_RANGE_ORDER: Exclude<PresetTimeRange, 'custom'>[] = [
  'today',
  'yesterday',
  '7days',
  '14days',
  '30days',
  '60days',
  '90days',
];

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

// 检测是否为移动端
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  return isMobile;
}

export function TimeRangeSelector({ 
  value, 
  onChange, 
  className,
  minDataDate,
  maxDataDate,
  hasData = true,
}: TimeRangeSelectorProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(value.dateRange);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const isMobile = useIsMobile();

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
    } else {
      days = TIME_RANGE_PRESETS[preset].days;
    }
    onChange({
      preset,
      dateRange,
      days,
    });
    setIsDropdownOpen(false);
  };

  // 打开自定义日期选择器
  const handleOpenCustom = () => {
    setTempDateRange(value.dateRange);
    setCurrentMonth(value.dateRange.from || subDays(new Date(), 30));
    setIsDropdownOpen(false);
    // 延迟打开日历，确保下拉菜单已关闭
    setTimeout(() => {
      setIsCalendarOpen(true);
    }, 100);
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

  // 移动端月份导航
  const goToPreviousMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* 预设时间范围下拉菜单 */}
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="min-w-[100px] sm:min-w-[140px] justify-between">
            <span className="flex items-center gap-1 sm:gap-2">
              <CalendarIcon className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="text-xs sm:text-sm">{getDisplayLabel()}</span>
            </span>
            <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[180px] sm:w-[200px]">
          {TIME_RANGE_ORDER.map((preset) => (
            <DropdownMenuItem
              key={preset}
              onClick={() => handlePresetSelect(preset)}
              className="flex items-center justify-between text-sm"
            >
              <span>{TIME_RANGE_PRESETS[preset].label}</span>
              {value.preset === preset && <Check className="h-4 w-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleOpenCustom}
            className="flex items-center justify-between text-sm"
          >
            <span>自定义日期</span>
            {value.preset === 'custom' && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 日历弹出框 - 移动端全屏，桌面端弹出 */}
      {isCalendarOpen && (
        <div 
          className={cn(
            "fixed inset-0 z-50 bg-black/50",
            isMobile 
              ? "flex items-end justify-center" 
              : "flex items-start justify-end pt-16 pr-4"
          )}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsCalendarOpen(false);
            }
          }}
        >
          <div 
            className={cn(
              "bg-popover border rounded-lg shadow-lg",
              isMobile 
                ? "w-full max-h-[85vh] rounded-b-none animate-in slide-in-from-bottom duration-300" 
                : "max-w-[600px]"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 移动端头部 */}
            {isMobile && (
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="font-semibold text-lg">选择日期范围</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsCalendarOpen(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            )}
            
            <div className="p-3 sm:p-4">
              {/* 数据可用范围提示 */}
              {minDataDate && (
                <div className="mb-3 p-2 bg-blue-500/10 border border-blue-500/20 rounded-md text-xs text-blue-400">
                  <CalendarIcon className="h-3 w-3 inline mr-1" />
                  数据可用范围：{format(minDataDate, 'yyyy/MM/dd', { locale: zhCN })} - {format(maxDataDate || new Date(), 'yyyy/MM/dd', { locale: zhCN })}
                </div>
              )}
              
              {/* 移动端：单月视图 + 月份导航 */}
              {isMobile ? (
                <div className="space-y-3">
                  {/* 月份导航 */}
                  <div className="flex items-center justify-between px-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={goToPreviousMonth}
                      className="h-8 w-8"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-medium">
                      {format(currentMonth, 'yyyy年M月', { locale: zhCN })}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={goToNextMonth}
                      disabled={currentMonth >= new Date()}
                      className="h-8 w-8"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  {/* 单月日历 */}
                  <Calendar
                    mode="range"
                    selected={{
                      from: tempDateRange?.from,
                      to: tempDateRange?.to,
                    }}
                    onSelect={handleCalendarSelect}
                    numberOfMonths={1}
                    locale={zhCN}
                    disabled={isDateDisabled}
                    month={currentMonth}
                    onMonthChange={setCurrentMonth}
                    className="w-full"
                    classNames={{
                      months: "w-full",
                      month: "w-full",
                      table: "w-full",
                      head_row: "flex w-full",
                      head_cell: "flex-1 text-center text-muted-foreground font-normal text-sm",
                      row: "flex w-full",
                      cell: "flex-1 text-center p-0",
                      day: "h-10 w-full rounded-md hover:bg-accent hover:text-accent-foreground",
                      day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                      day_range_middle: "bg-accent text-accent-foreground",
                      day_range_start: "bg-primary text-primary-foreground rounded-l-md",
                      day_range_end: "bg-primary text-primary-foreground rounded-r-md",
                    }}
                  />
                  
                  {/* 快捷选择按钮 */}
                  <div className="grid grid-cols-4 gap-2 pt-2 border-t">
                    {(['7days', '14days', '30days', '60days'] as const).map((preset) => (
                      <Button
                        key={preset}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => {
                          const range = getDateRangeFromPreset(preset, minDataDate);
                          setTempDateRange(range);
                          setCurrentMonth(range.from);
                        }}
                      >
                        {TIME_RANGE_PRESETS[preset].label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                /* 桌面端：双月视图 */
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
              )}
              
              {/* 底部操作栏 */}
              <div className={cn(
                "flex items-center justify-between mt-3 pt-3 border-t",
                isMobile && "flex-col gap-3"
              )}>
                <div className={cn(
                  "text-sm text-muted-foreground",
                  isMobile && "text-center w-full"
                )}>
                  {tempDateRange?.from && tempDateRange?.to ? (
                    <>
                      {format(tempDateRange.from, 'yyyy/MM/dd', { locale: zhCN })} - {format(tempDateRange.to, 'yyyy/MM/dd', { locale: zhCN })}
                      <span className="ml-2 text-blue-400">({getDaysFromDateRange(tempDateRange)}天)</span>
                    </>
                  ) : (
                    '请选择日期范围'
                  )}
                </div>
                <div className={cn(
                  "flex gap-2",
                  isMobile && "w-full"
                )}>
                  <Button
                    variant="outline"
                    size={isMobile ? "default" : "sm"}
                    onClick={() => setIsCalendarOpen(false)}
                    className={isMobile ? "flex-1" : ""}
                  >
                    取消
                  </Button>
                  <Button
                    size={isMobile ? "default" : "sm"}
                    onClick={handleApplyCustomRange}
                    disabled={!tempDateRange?.from || !tempDateRange?.to}
                    className={isMobile ? "flex-1" : ""}
                  >
                    应用
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 默认值生成函数 - 默认为今天
export function getDefaultTimeRangeValue(preset: Exclude<PresetTimeRange, 'custom'> = 'today'): TimeRangeValue {
  const dateRange = getDateRangeFromPreset(preset);
  const days = preset === 'today' || preset === 'yesterday' ? 1 : TIME_RANGE_PRESETS[preset].days;
  return {
    preset,
    dateRange,
    days,
  };
}
