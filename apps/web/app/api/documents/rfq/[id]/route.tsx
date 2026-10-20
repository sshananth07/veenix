import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { RfqPdf } from "@/lib/pdf/RfqPdf";

export const runtime = "nodejs";

// ?vendorId= addresses the RFQ to one invited vendor; ?download=1 saves the
// file instead of opening it in the browser.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const vendorId = url.searchParams.get("vendorId");
  const download = url.searchParams.get("download") === "1";

  const [rfq, settings] = await Promise.all([
    prisma.rfq.findUnique({
      where: { id: params.id },
      include: { bomItem: { include: { workItem: true } }, project: true, quotes: { include: { vendor: true } } },
    }),
    getSettings(),
  ]);
  if (!rfq) return new Response("Not found", { status: 404 });

  const targetVendor = vendorId ? rfq.quotes.find((q) => q.vendorId === vendorId)?.vendor : undefined;
  const vendorName = targetVendor?.name ?? (rfq.quotes.map((q) => q.vendor.name).join(", ") || "Invited vendors");

  const buffer = await renderToBuffer(
    <RfqPdf
      company={settings}
      rfq={rfq}
      bomItem={rfq.bomItem}
      workItemName={rfq.bomItem.workItem?.name ?? null}
      project={rfq.project}
      vendorName={vendorName}
    />
  );

  const slug = targetVendor ? `-${targetVendor.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}` : "";
  return new Response(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${rfq.code}${slug}.pdf"`,
    },
  });
}
