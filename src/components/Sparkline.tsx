interface Props {
  data: number[];
  positive?: boolean;
  width?: number;
  height?: number;
}

export const Sparkline = ({ data, positive, width = 80, height = 24 }: Props) => {
  if (!data || data.length < 2) {
    return <div className="text-muted-foreground text-xs">—</div>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(" ");

  const up = positive ?? data[data.length - 1] >= data[0];
  const stroke = up ? "hsl(var(--success))" : "hsl(var(--destructive))";

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};
