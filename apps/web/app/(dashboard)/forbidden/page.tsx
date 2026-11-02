import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-md rounded-xl border bg-card px-6 py-14 text-center shadow-xs">
      <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
      <h1 className="mt-3 font-semibold">Your role cannot do this</h1>
      <p className="mt-1 text-sm text-muted-foreground">Ask an owner or admin of your organization if you need access.</p>
      <Link href="/" className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        Back to home
      </Link>
    </div>
  );
}
