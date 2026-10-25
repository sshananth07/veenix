/** Makes user input safe inside a $regex. */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const contains = (s: string) => ({ $regex: escapeRegex(s), $options: "i" });
