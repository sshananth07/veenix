"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import type { WhatsAppLinkDto } from "@veenix/shared";
import { startWhatsAppLink, unlinkWhatsApp } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

/** The signed-in user's own WhatsApp link: staff message Veenix's number and the assistant acts as them. */
export function WhatsAppLink({ link }: { link: WhatsAppLinkDto }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [started, setStarted] = useState<{ code: string; waUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = () =>
    startTransition(async () => {
      setError(null);
      const r = await startWhatsAppLink();
      if (r.ok) setStarted(r.data);
      else setError(r.error);
    });
  const unlink = () =>
    startTransition(async () => {
      const r = await unlinkWhatsApp();
      if (!r.ok) setError(r.error);
    });

  return (
    <section id="whatsapp" className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <MessageCircle className="h-4 w-4 text-primary" />
          WhatsApp assistant
        </h2>
        {link.phone && (
          <Button variant="outline" size="sm" onClick={unlink} disabled={pending}>
            Unlink
          </Button>
        )}
      </div>

      {!link.available ? (
        <p className="text-sm text-muted-foreground">Not available yet. Veenix&apos;s WhatsApp number hasn&apos;t been set up.</p>
      ) : link.phone ? (
        <p className="text-sm">
          Linked to <span className="font-medium">+{link.phone}</span>
          {link.verifiedAt && <span className="text-muted-foreground"> since {formatDate(link.verifiedAt)}</span>}. Text, voice notes and photos you send act with
          your permissions.
        </p>
      ) : started ? (
        <div className="space-y-3 text-sm">
          <p>
            Send <span className="font-mono font-semibold">LINK {started.code}</span> from your phone&apos;s WhatsApp. The code works once, for 10 minutes.
          </p>
          <div className="flex gap-2">
            <Button asChild>
              <a href={started.waUrl} target="_blank" rel="noreferrer">Open WhatsApp</a>
            </Button>
            <Button variant="outline" onClick={() => router.refresh()}>
              I&apos;ve sent it
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">Send site updates, voice notes and photos to Veenix on WhatsApp. Changes that need approval come with an Approve button.</p>
          <Button onClick={start} disabled={pending}>
            {pending ? "Starting..." : "Link WhatsApp"}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
