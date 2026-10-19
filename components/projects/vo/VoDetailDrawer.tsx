"use client";

import { useState } from "react";
import { CalendarClock, ExternalLink, Paperclip, User, X } from "lucide-react";
import { acceptVariationOrder, sendVariationOrderToClient } from "@/actions/variationOrders";
import { ActionButton } from "@/components/ActionButton";
import { StatusBadge } from "@/components/StatusBadge";
import { Dialog, DialogClose, DialogTitle, DialogTrigger, DrawerContent } from "@/components/ui/dialog";
import { formatCurrency, formatDate } from "@/lib/utils";

export type VoDetail = {
  id: string;
  code: string;
  title: string | null;
  description: string;
  reason: string | null;
  raisedBy: string | null;
  raisedAt: Date;
  amount: number;
  status: string;
  programmeImpact: string | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  bomItem: { workPackage: string } | null;
};

export function VoDetailDrawer({ vo, trigger }: { vo: VoDetail; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DrawerContent>
        <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
          <div>
            <DialogTitle className="text-xl">{vo.title || vo.code}</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">{vo.code}</p>
          </div>
          <DialogClose className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>

        <div className="grid flex-1 content-start gap-5 overflow-y-auto px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={vo.status} />
            <span className="text-2xl font-bold tabular-nums">{formatCurrency(vo.amount)}</span>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</div>
            <p className="mt-1 text-sm">{vo.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            {vo.reason && (
              <div>
                <div className="text-xs text-muted-foreground">Reason</div>
                <div className="font-medium">{vo.reason}</div>
              </div>
            )}
            {vo.bomItem && (
              <div>
                <div className="text-xs text-muted-foreground">Linked BOM line</div>
                <div className="font-medium">{vo.bomItem.workPackage}</div>
              </div>
            )}
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" />
                Raised
              </div>
              <div className="font-medium">{formatDate(vo.raisedAt)}</div>
            </div>
            {vo.raisedBy && (
              <div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <User className="h-3.5 w-3.5" />
                  Raised by
                </div>
                <div className="font-medium">{vo.raisedBy}</div>
              </div>
            )}
            {vo.programmeImpact && (
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Impact on programme</div>
                <div className="font-medium">{vo.programmeImpact}</div>
              </div>
            )}
          </div>

          {vo.attachmentPath && (
            <a href={`/api/uploads/vo/${vo.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm font-medium text-primary hover:underline">
              <Paperclip className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">{vo.attachmentName ?? "Attachment"}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t bg-background px-6 py-4">
          {vo.status === "DRAFT" && (
            <ActionButton action={sendVariationOrderToClient.bind(null, vo.id)} pendingLabel="Sending...">
              Send to client
            </ActionButton>
          )}
          {vo.status === "CLIENT_REVIEW" && (
            <ActionButton action={acceptVariationOrder.bind(null, vo.id)} pendingLabel="Recording...">
              Client signed
            </ActionButton>
          )}
        </div>
      </DrawerContent>
    </Dialog>
  );
}
