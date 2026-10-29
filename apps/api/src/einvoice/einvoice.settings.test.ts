import { describe, expect, it } from "vitest";
import { OrgModel } from "../orgs/org.model";
import { asOrg, newId } from "../../test/ctx";
import { einvoiceSecrets, einvoiceSettingsView, saveEinvoiceSettings } from "./einvoice.settings";

const base = { environment: "preprod", tin: "C1234567890", brn: "202001000001", sstNo: null, msicCode: "43301", businessActivity: "Interior renovation", clientId: "cid" } as const;

describe("e-invoice settings", () => {
  it("keeps stored secrets when omitted and never returns them", async () => {
    const orgId = newId();
    await OrgModel.create({ _id: orgId, companyName: "Wawasan", createdBy: newId() });
    await asOrg(orgId, async () => {
      await expect(saveEinvoiceSettings({ ...base, enabled: true, clientSecret: "s1" })).rejects.toThrow("before turning e-invoicing on");
      await saveEinvoiceSettings({ ...base, enabled: true, clientSecret: "s1", certificateBase64: Buffer.from("p12").toString("base64"), certificatePassword: "pw" });
      await saveEinvoiceSettings({ ...base, enabled: true, clientId: "cid2" });

      expect(await einvoiceSecrets()).toEqual({ clientSecret: "s1", certificate: Buffer.from("p12"), certificatePassword: "pw" });
      const view = await einvoiceSettingsView();
      expect(view).toMatchObject({ clientId: "cid2", hasClientSecret: true, hasCertificate: true });
      expect(JSON.stringify(view)).not.toMatch(/Enc|v1\./);
    });
  });
});
