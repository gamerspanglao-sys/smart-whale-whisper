import { cn } from "@/lib/utils";

interface Props {
  buy: string | null;
  sell: string | null;
  className?: string;
}

export function LevelBadge({ buy, sell, className }: Props) {
  if (sell) {
    return (
      <span
        className={cn(
          "inline-flex flex-col gap-0.5 px-2 py-1 rounded-md border text-[10px] font-medium leading-snug max-w-[220px]",
          "bg-destructive/10 text-destructive border-destructive/25",
          className,
        )}
        title={sell}
      >
        <span className="text-[9px] uppercase tracking-wide text-destructive/80">Exit / sell</span>
        <span className="line-clamp-3">{sell}</span>
      </span>
    );
  }
  if (buy) {
    return (
      <span
        className={cn(
          "inline-flex flex-col gap-0.5 px-2 py-1 rounded-md border text-[10px] font-medium leading-snug max-w-[220px]",
          "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
          className,
        )}
        title={buy}
      >
        <span className="text-[9px] uppercase tracking-wide text-emerald-700/80 dark:text-emerald-400/90">Buy / hold</span>
        <span className="line-clamp-3">{buy}</span>
      </span>
    );
  }
  return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
}
