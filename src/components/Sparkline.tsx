import { cn } from "@/lib/cn";

interface SparklineProps {
  series: number[];
  positive: boolean;
  className?: string;
  filled?: boolean;
  height?: number;
  /**
   * A price to draw as a dashed rule, used for the locked snapshot on the
   * detail sheet. Included in the vertical scale so it is always on screen —
   * a reference line the chart has moved off the top of is worse than none.
   */
  baseline?: number | null;
}

const WIDTH = 100;
const PAD = 2;

interface Scale {
  min: number;
  span: number;
}

function scaleFor(series: number[], baseline: number | null): Scale {
  const values = baseline === null ? series : [...series, baseline];
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, span: max - min || 1 };
}

function yFor(value: number, scale: Scale, height: number): number {
  return PAD + (1 - (value - scale.min) / scale.span) * (height - PAD * 2);
}

function toPath(series: number[], scale: Scale, height: number) {
  if (series.length < 2) return "";

  return series
    .map((value, i) => {
      const x = (i / (series.length - 1)) * WIDTH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${yFor(value, scale, height).toFixed(2)}`;
    })
    .join(" ");
}

export function Sparkline({
  series,
  positive,
  className,
  filled = false,
  height = 30,
  baseline = null,
}: SparklineProps) {
  const scale = scaleFor(series, baseline);
  const path = toPath(series, scale, height);
  if (!path) return null;

  const color = positive ? "#00C805" : "#FF5A52";
  const gradientId = `spark-${positive ? "up" : "dn"}-${series.length}`;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
      className={cn("block", className)}
    >
      {filled && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.22" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d={`${path} L${WIDTH},${height} L0,${height} Z`}
            fill={`url(#${gradientId})`}
          />
        </>
      )}
      {baseline !== null && (
        <line
          x1="0"
          x2={WIDTH}
          y1={yFor(baseline, scale, height)}
          y2={yFor(baseline, scale, height)}
          stroke="#8A938C"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <path
        d={path}
        stroke={color}
        strokeWidth={filled ? 1 : 2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
