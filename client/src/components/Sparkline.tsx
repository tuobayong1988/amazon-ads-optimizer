/**
 * Sparkline - 迷你趋势图组件
 * 用于在表格单元格或卡片中显示数据趋势
 */

import { useMemo } from "react";

interface SparklineProps {
  data: Array<{ value: number }>;
  color?: string;
  height?: number;
  width?: number;
  showArea?: boolean;
  strokeWidth?: number;
}

export function Sparkline({
  data,
  color = "#22c55e",
  height = 24,
  width = 60,
  showArea = true,
  strokeWidth = 1.5,
}: SparklineProps) {
  const { path, areaPath, minY, maxY } = useMemo(() => {
    if (!data || data.length === 0) {
      return { path: "", areaPath: "", minY: 0, maxY: 0 };
    }

    const values = data.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const points = values.map((value, index) => {
      const x = padding + (index / (values.length - 1)) * chartWidth;
      const y = padding + chartHeight - ((value - min) / range) * chartHeight;
      return { x, y };
    });

    const linePath = points
      .map((point, index) => (index === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`))
      .join(" ");

    const areaPathStr = showArea
      ? `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${padding} ${height - padding} Z`
      : "";

    return { path: linePath, areaPath: areaPathStr, minY: min, maxY: max };
  }, [data, width, height, showArea]);

  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-xs"
        style={{ width, height }}
      >
        --
      </div>
    );
  }

  return (
    <svg width={width} height={height} className="overflow-visible">
      {showArea && areaPath && (
        <path d={areaPath} fill={color} fillOpacity={0.1} />
      )}
      {path && (
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {data.length > 0 && (
        <circle
          cx={width - 2}
          cy={
            2 +
            (height - 4) -
            ((data[data.length - 1].value - minY) / (maxY - minY || 1)) *
              (height - 4)
          }
          r={2}
          fill={color}
        />
      )}
    </svg>
  );
}

interface MiniSparklineProps {
  data: number[];
  trend?: "up" | "down" | "flat";
  size?: "sm" | "md";
}

export function MiniSparkline({ data, trend, size = "sm" }: MiniSparklineProps) {
  const dimensions = size === "sm" ? { width: 40, height: 16 } : { width: 60, height: 24 };
  const color = trend === "up" ? "#22c55e" : trend === "down" ? "#ef4444" : "#94a3b8";

  return (
    <Sparkline
      data={data.map((value) => ({ value }))}
      color={color}
      width={dimensions.width}
      height={dimensions.height}
      strokeWidth={1}
      showArea={false}
    />
  );
}

export default Sparkline;
