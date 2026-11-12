import Link from "next/link";
import { EmptyState } from "@/components/shared/page";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState
      className="mt-16"
      title="Not found"
      description="This record does not exist or you do not have access to it."
      action={<Button asChild size="sm" variant="outline"><Link href="/">Back to overview</Link></Button>}
    />
  );
}
