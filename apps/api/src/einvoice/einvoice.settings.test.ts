import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import forge from "node-forge";
import { OrgModel } from "../orgs/org.model";
import { asOrg, newId } from "../../test/ctx";
import { einvoiceSecrets, einvoiceSettingsView, saveEinvoiceSettings } from "./einvoice.settings";

const base = {
  environment: "preprod", tin: "C1234567890", brn: "202001000001", sstNo: null, msicCode: "43301", businessActivity: "Interior renovation", clientId: "cid",
  phone: "+60123456789", addressLine1: "1 Jalan SS 2/24", addressLine2: null, addressLine3: null, postcode: "47300", city: "Petaling Jaya", state: "Selangor",
} as const;

/** A .p12 like the one a CA issues: RSA key plus certificate, password-protected. */
function p12(password: string) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs1", format: "pem" }).toString());
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: "commonName", value: "Wawasan" }]);
  cert.setIssuer([{ name: "commonName", value: "Wawasan" }]);
  cert.sign(key, forge.md.sha256.create());
  return forge.util.encode64(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(key, [cert], password, { algorithm: "aes256" })).getBytes());
}

describe("e-invoice settings", () => {
  it("keeps stored secrets when omitted and never returns them", async () => {
    const orgId = newId();
    await OrgModel.create({ _id: orgId, companyName: "Wawasan", createdBy: newId() });
    await asOrg(orgId, async () => {
      await expect(saveEinvoiceSettings({ ...base, enabled: true, clientSecret: "s1" })).rejects.toThrow("before turning e-invoicing on");
      await expect(saveEinvoiceSettings({ ...base, enabled: false, certificateBase64: p12("pw"), certificatePassword: "wrong" })).rejects.toThrow("Couldn't open the certificate");
      await saveEinvoiceSettings({ ...base, enabled: true, clientSecret: "s1", certificateBase64: p12("pw"), certificatePassword: "pw" });
      await saveEinvoiceSettings({ ...base, enabled: true, clientId: "cid2" });

      const secrets = await einvoiceSecrets();
      expect(secrets.clientSecret).toBe("s1");
      expect(secrets.privateKeyPem).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);
      const view = await einvoiceSettingsView();
      expect(view).toMatchObject({ clientId: "cid2", hasClientSecret: true, hasCertificate: true, certificateSubject: "CN=Wawasan" });
      expect(JSON.stringify(view)).not.toMatch(/Enc|PRIVATE|v1\./);
    });
  });
});
