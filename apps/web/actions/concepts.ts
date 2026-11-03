"use server";

import type { ConceptDto, ConceptPatchInput } from "@veenix/shared";
import { apiActionData } from "@/lib/api";

export const updateConcept = async (id: string, patch: ConceptPatchInput) =>
  apiActionData<ConceptDto>(`/concepts/${id}`, { method: "PATCH", body: patch });
