"use server";
import type { PresignInput, SearchResultDto } from "@veenix/shared";
import { api } from "@/lib/api";

export const presignUpload = async (input: PresignInput) => api<{ key: string; url: string; contentType: string }>("/uploads", { method: "POST", body: input });
export const liveTicket = async () => (await api<{ ticket: string }>("/live/ticket", { method: "POST" })).ticket;
export const searchAction = async (q: string) => (q.trim().length < 2 ? ([] as SearchResultDto[]) : api<SearchResultDto[]>(`/search?q=${encodeURIComponent(q.trim())}`));
