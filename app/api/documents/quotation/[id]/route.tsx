import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { QuotationPdf } from "@/lib/pdf/QuotationPdf";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const [quotation, settings] = await Promise.all([
    prisma.quotation.findUnique({
      where: { id: params.id },
      include: { lineItems: { orderBy: { seq: "asc" } }, terms: { orderBy: { seq: "asc" } }, project: true },
    }),
    getSettings(),
  ]);
  if (!quotation) return new Response("Not found", { status: 404 });

  const buffer = await renderToBuffer(
    <QuotationPdf
      company={settings}
      quotation={quotation}
      project={quotation.project}
      lineItems={quotation.lineItems}
      terms={quotation.terms}
    />
  );

  return new Response(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${quotation.code}.pdf"`,
    },
  });
}
