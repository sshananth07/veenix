import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { RfqBundlePdf } from "@/lib/pdf/RfqPdf";

export const runtime = "nodejs";

// Every RFQ still waiting on a quote for this project, one page per invited
// vendor, in a single PDF.
export async function GET(_req: Request, { params }: { params: { projectId: string } }) {
  const [project, settings] = await Promise.all([
    prisma.project.findUnique({
      where: { id: params.projectId },
      include: {
        rfqs: {
          orderBy: { createdAt: "asc" },
          include: { bomItem: { include: { workItem: true } }, quotes: { include: { vendor: true }, orderBy: { requestedAt: "asc" } }, purchaseOrders: true },
        },
      },
    }),
    getSettings(),
  ]);
  if (!project) return new Response("Not found", { status: 404 });

  const pages = project.rfqs
    .filter((r) => r.purchaseOrders.length === 0)
    .flatMap((r) =>
      r.quotes.map((q) => ({
        company: settings,
        rfq: r,
        bomItem: r.bomItem,
        workItemName: r.bomItem.workItem?.name ?? null,
        project,
        vendorName: q.vendor.name,
      }))
    );
  if (pages.length === 0) return new Response("No open RFQs", { status: 404 });

  const buffer = await renderToBuffer(<RfqBundlePdf pages={pages} />);
  return new Response(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${project.code}-RFQs.pdf"`,
    },
  });
}
