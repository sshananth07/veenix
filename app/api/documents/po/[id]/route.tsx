import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { PoPdf } from "@/lib/pdf/PoPdf";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const [po, settings] = await Promise.all([
    prisma.purchaseOrder.findUnique({
      where: { id: params.id },
      include: { vendor: true, project: true, rfq: true, milestones: { orderBy: { seq: "asc" } } },
    }),
    getSettings(),
  ]);
  if (!po) return new Response("Not found", { status: 404 });

  const buffer = await renderToBuffer(
    <PoPdf company={settings} po={po} milestones={po.milestones} vendorName={po.vendor.name} project={po.project} rfqCode={po.rfq?.code ?? null} />
  );

  return new Response(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${po.code}.pdf"`,
    },
  });
}
