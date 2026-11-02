"use server";

import { revalidatePath } from "next/cache";
import type { AssistantConversationDto, AssistantConversationListItemDto } from "@veenix/shared";
import { apiAction, apiActionData } from "@/lib/api";

export const listAssistantConversations = async (q: string, projectId: string | null) =>
  apiActionData<AssistantConversationListItemDto[]>(`/assistant/conversations?${new URLSearchParams({ ...(q ? { q } : {}), ...(projectId ? { projectId } : {}) })}`);

export const getAssistantConversation = async (id: string) => apiActionData<AssistantConversationDto>(`/assistant/conversations/${id}`);

export const deleteAssistantConversation = async (id: string) => apiAction(`/assistant/conversations/${id}`, { method: "DELETE" });

/** conversationId null starts a new chat, linked to projectId when sent from a project. */
export const sendAssistantMessage = async (input: { conversationId: string | null; projectId: string | null; text: string; photos: { key: string; name: string }[] }) =>
  apiActionData<{ conversationId: string }>("/assistant/messages", { method: "POST", body: input });

// Approving or undoing changes records other screens show, so refresh them.
async function act(path: string, body: object = {}) {
  const r = await apiAction(path, { method: "POST", body });
  revalidatePath("/", "layout");
  return r;
}
/** edits fill the card's inputs, keyed by their path. */
export const approveAssistantAction = async (id: string, edits: Record<string, unknown> = {}) => act(`/assistant/actions/${id}/approve`, { edits });
export const rejectAssistantAction = async (id: string) => act(`/assistant/actions/${id}/reject`);
export const undoAssistantChange = async (toolCallId: string) => act(`/assistant/tool-calls/${toolCallId}/undo`);
