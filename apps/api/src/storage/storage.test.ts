import { beforeAll, describe, expect, it } from "vitest";
import { claim, ensureBucket, newKey, putObject } from "./storage";
import { asOrg, newId } from "../../test/ctx";

const org = newId();

describe("storage claim", () => {
  beforeAll(() => ensureBucket());

  it("accepts a real PDF in this org's folder", async () => {
    const key = await asOrg(org, async () => newKey("quotes", ".pdf"));
    await putObject(key, Buffer.from("%PDF-1.7 test"), "application/pdf");
    const r = await asOrg(org, () => claim({ key, name: "quote.pdf" }, "quotes"));
    expect(r).toMatchObject({ path: key, name: "quote.pdf", contentType: "application/pdf" });
  });

  it("rejects a fake PDF and deletes it", async () => {
    const key = await asOrg(org, async () => newKey("quotes", ".pdf"));
    await putObject(key, Buffer.from("MZ not a pdf"), "application/pdf");
    await expect(asOrg(org, () => claim({ key, name: "evil.pdf" }, "quotes"))).rejects.toThrow('"evil.pdf" is not a real PDF file');
    await expect(asOrg(org, () => claim({ key, name: "evil.pdf" }, "quotes"))).rejects.toThrow("The upload didn't finish");
  });

  it("rejects another organization's key", async () => {
    const key = await asOrg(newId(), async () => newKey("quotes", ".pdf"));
    await expect(asOrg(org, () => claim({ key, name: "x.pdf" }, "quotes"))).rejects.toThrow("Upload a PDF");
  });
});
