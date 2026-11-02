import { apiToken, requireOrg } from "@/lib/session";

export const runtime = "nodejs";

// Old URL /api/documents/rfqs/<projectId> is the bundle.
const TYPES: Record<string, string> = { quotation: "quotation", invoice: "invoice", po: "po", rfq: "rfq", rfqs: "rfq-bundle" };

export async function GET(req: Request, props: { params: Promise<{ type: string; id: string }> }) {
  const params = await props.params;
  const type = TYPES[params.type];
  if (!type) return new Response("Not found", { status: 404 });
  const { orgId } = await requireOrg();
  const search = new URL(req.url).search;
  const res = await fetch(`${process.env.API_URL}/v1/documents/${type}/${params.id}/pdf${search}`, {
    headers: { authorization: `Bearer ${await apiToken()}`, "x-org-id": orgId },
    cache: "no-store",
  });
  if (!res.ok) return new Response("Not found", { status: res.status === 404 ? 404 : 502 });
  return new Response(res.body, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": res.headers.get("content-disposition") ?? "inline" },
  });
}
