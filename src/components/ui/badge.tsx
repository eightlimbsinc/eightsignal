import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap border",
  {
    variants: {
      variant: {
        default: "border-primary/30 bg-primary/15 text-blue-300",
        secondary: "border-border bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        critical: "border-sev-critical/40 bg-sev-critical/15 text-rose-300",
        high: "border-sev-high/40 bg-sev-high/15 text-orange-300",
        medium: "border-sev-medium/40 bg-sev-medium/15 text-yellow-200",
        low: "border-sev-low/40 bg-sev-low/15 text-sky-300",
        info: "border-sev-info/40 bg-sev-info/15 text-slate-300",
        ok: "border-ok/40 bg-ok/15 text-green-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { Badge, badgeVariants };
