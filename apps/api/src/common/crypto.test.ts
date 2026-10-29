import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

describe("field encryption", () => {
  it("round-trips and never repeats a ciphertext", () => {
    const a = encrypt("client-secret"), b = encrypt("client-secret");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("client-secret");
  });
  it("refuses a tampered value", () => {
    const t = encrypt("x").split(".");
    t[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(t.join("."))).toThrow();
  });
});
