export default function VerifyEmailPage({ searchParams }: { searchParams: { email?: string } }) {
  return (
    <div className="w-full max-w-sm space-y-2 rounded-xl border bg-card p-6 shadow-sm">
      <h1 className="text-xl font-semibold">Check your email</h1>
      <p className="text-sm text-muted-foreground">We sent a link to {searchParams.email ?? "your email"}. Open it to continue.</p>
    </div>
  );
}
