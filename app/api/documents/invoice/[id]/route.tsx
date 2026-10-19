import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { InvoicePdf } from "@/lib/pdf/InvoicePdf";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: params.id },
      include: { milestone: { include: { project: true } } },
    }),
    getSettings(),
  ]);
  if (!invoice) return new Response("Not found", { status: 404 });

  const buffer = await renderToBuffer(
    <InvoicePdf
      company={settings}
      invoice={invoice}
      milestoneName={invoice.milestone.name}
      project={invoice.milestone.project}
    />
  );

  return new Response(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.code}.pdf"`,
    },
  });
}
