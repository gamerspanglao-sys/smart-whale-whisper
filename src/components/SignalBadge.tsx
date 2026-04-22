import { cn } from "@/lib/utils";

interface Props {
  signal: string;
}

export const SignalBadge = ({ signal }: Props) => {
  const map: Record<string, string> = {
    Strong: "bg-primary/15 text-primary border-primary/30",
    Watchlist: "bg-accent/15 text-accent border-accent/30",
    Neutral: "bg-muted text-muted-foreground border-border",
    Avoid: "bg-destructive/15 text-destructive border-destructive/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider",
        map[signal] ?? map.Neutral,
      )}
    >
      {signal}
    </span>
  );
};
