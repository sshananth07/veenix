import { can, type ConceptDto } from "@veenix/shared";
import { api } from "@/lib/api";
import { requireOrg } from "@/lib/session";
import { ConceptViewer } from "@/components/concepts/ConceptViewer";

// The link (from the chat or WhatsApp) grants nothing: the API checks login, project scope and lead:read, and answers 404 otherwise.
export default async function ConceptPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { role } = await requireOrg();
  const concept = await api<ConceptDto>(`/concepts/${id}`);
  return <ConceptViewer concept={concept} canEdit={can(role, "concept:generate")} />;
}
