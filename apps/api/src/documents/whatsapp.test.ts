import { describe, expect, it } from "vitest";
import { waNumber, whatsappLink } from "./whatsapp";

describe("whatsapp", () => {
  it("turns Malaysian numbers into international format", () => {
    expect(waNumber("012-345 6789")).toBe("60123456789");
    expect(waNumber("+60 12 345 6789")).toBe("60123456789");
    expect(waNumber(null)).toBe("");
  });
  it("builds a wa.me link with the message", () => {
    expect(whatsappLink("0123456789", "Hi https://x")).toBe("https://wa.me/60123456789?text=Hi%20https%3A%2F%2Fx");
  });
});
