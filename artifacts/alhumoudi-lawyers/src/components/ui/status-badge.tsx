import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = status.toLowerCase().replace('_', ' ');
  
  let variant = "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
  
  // Cases / Contracts
  if (["active", "open", "approved", "paid"].includes(normalized)) {
    variant = "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-400 dark:border-teal-800";
  } else if (["closed", "finished", "archived", "done"].includes(normalized)) {
    variant = "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700";
  } else if (["on hold", "pending", "pending approval", "draft", "in progress"].includes(normalized)) {
    variant = "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800";
  } else if (["rejected", "cancelled", "overdue", "failed"].includes(normalized)) {
    variant = "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800";
  }

  // Priority
  if (normalized === "urgent" || normalized === "high") {
    variant = "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800";
  } else if (normalized === "medium") {
    variant = "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800";
  } else if (normalized === "low") {
    variant = "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800";
  }

  return (
    <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium border uppercase tracking-wider", variant, className)}>
      {normalized}
    </span>
  );
}

export function AmountFormatter({ amount, currency = "SAR" }: { amount?: number | null, currency?: string }) {
  if (amount == null) return <span className="text-muted-foreground">-</span>;
  
  return (
    <span className="font-mono font-medium">
      {new Intl.NumberFormat('en-SA', { style: 'currency', currency }).format(amount)}
    </span>
  );
}
