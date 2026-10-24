/** Mongo document → DTO-shaped object: _id → id, ObjectIds → hex strings, orgId and __v dropped. */
export function plain<T = unknown>(value: unknown): T {
  if (value === null || typeof value !== "object" || value instanceof Date) return value as T;
  if ((value as { _bsontype?: string })._bsontype === "ObjectId") return (value as { toHexString(): string }).toHexString() as T;
  if (Array.isArray(value)) return value.map((v) => plain(v)) as T;
  const source = typeof (value as { toObject?: unknown }).toObject === "function" ? (value as { toObject(): object }).toObject() : value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    if (k === "orgId" || k === "__v") continue;
    out[k === "_id" ? "id" : k] = plain(v);
  }
  return out as T;
}
