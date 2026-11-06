"use server";

import type { ConceptDto, ConceptPatchInput } from "@veenix/shared";
import { apiActionData } from "@/lib/api";

export const updateConcept = async (id: string, patch: ConceptPatchInput) =>
  apiActionData<ConceptDto>(`/concepts/${id}`, { method: "PATCH", body: patch });

export const renderConcept = async (id: string) => apiActionData<ConceptDto>(`/concepts/${id}/render`, { method: "POST" });
export const matchRender = async (id: string) => apiActionData<ConceptDto>(`/concepts/${id}/match-render`, { method: "POST" });
export const restoreRoom = async (id: string) => apiActionData<ConceptDto>(`/concepts/${id}/restore-room`, { method: "POST" });
