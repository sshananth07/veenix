"use client";

import { useState, useTransition } from "react";
import { Mail, MessageCircle } from "lucide-react";
import { emailDocument, shareDocument } from "@/actions/team";
import { FormDialog } from "@/components/FormDialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type DocType = "quotation" | "invoice" | "po" | "rfq";

/** Email the PDF as an attachment, or open WhatsApp with a 7-day download link. */
export function SendDocumentButtons({ type, id, defaultEmail, defaultPhone }: { type: DocType; id: string; defaultEmail?: string | null; defaultPhone?: string | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const whatsapp = () => {
    // Opened before the request so the browser doesn't treat it as an unprompted popup.
    const tab = window.open("", "_blank");
    startTransition(async () => {
      setError(null);
      const r = await shareDocument(type, id, defaultPhone ?? null);
      if (r.ok && tab) tab.location.href = r.whatsappUrl;
      else {
        tab?.close();
        if (!r.ok) setError(r.error);
      }
    });
  };

  return (
    <>
      <FormDialog
        trigger={
          <Button variant="outline" size="icon" aria-label="Email PDF" title="Email PDF">
            <Mail className="h-4 w-4" />
          </Button>
        }
        title="Email this document"
        description="The PDF is attached. Replies go to your company email."
        submitLabel="Send email"
        pendingLabel="Sending..."
        action={(fd) => emailDocument(type, id, fd)}
      >
        <Field label="To" htmlFor={`to-${id}`} required>
          <Input id={`to-${id}`} name="to" type="email" defaultValue={defaultEmail ?? ""} required />
        </Field>
        <Field label="Message" htmlFor={`message-${id}`}>
          <Textarea id={`message-${id}`} name="message" rows={3} placeholder="Please find the document attached." />
        </Field>
      </FormDialog>
      <Button variant="outline" size="icon" aria-label="Share on WhatsApp" title="Share on WhatsApp" disabled={pending} onClick={whatsapp}>
        <MessageCircle className="h-4 w-4" />
      </Button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </>
  );
}
