import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPairSync, verify, X509Certificate } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import forge from "node-forge";
import { readP12, signDocument } from "./sign";
import { runDue, enqueue } from "../jobs/jobs";
import { tx } from "../common/tx";
import { OrgModel } from "../orgs/org.model";
import { ProjectModel } from "../projects/project.model";
import { InvoiceModel } from "../billing/invoice.model";
import { asOrg, newId } from "../../test/ctx";
import * as myinvois from "./myinvois";
import "./einvoice.jobs";
import "../documents/stored";

// LHDN mocked: no network, no real credentials.
vi.mock("./einvoice.settings", () => ({
  einvoiceSettings: async () => ({ enabled: true, environment: "preprod", clientId: "c", sstNo: "W10-1808-32000001", tin: "C1", brn: "B1", msicCode: "43301", businessActivity: "Renovation", phone: "+60123456789", addressLine1: "1 Jalan", city: "Petaling Jaya", state: "Selangor", postcode: "47300" }),
  einvoiceSecrets: async () => ({ clientSecret: "s", ...signingKey() }),
}));
vi.mock("./myinvois", async (original) => ({
  ...(await original<typeof import("./myinvois")>()),
  token: vi.fn(async () => "t"),
  submit: vi.fn(async () => ({ submissionUid: "S1", uuid: "U1" })),
  getSubmission: vi.fn(),
  documentDetails: vi.fn(),
}));

let key: { privateKeyPem: string; certificate: Buffer } | null = null;
/** A throwaway self-signed RSA certificate, as LHDN's pre-production would accept for testing. */
function signingKey() {
  if (key) return key;
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: "spki", format: "pem" }).toString());
  cert.serialNumber = "0a1b";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  cert.setSubject([{ name: "commonName", value: "Wawasan Interior" }, { name: "countryName", value: "MY" }]);
  cert.setIssuer([{ name: "commonName", value: "Test CA" }, { name: "countryName", value: "MY" }]);
  cert.sign(forge.pki.privateKeyFromPem(privateKeyPem), forge.md.sha256.create());
  key = { privateKeyPem, certificate: Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary") };
  return key;
}

describe("signing (SDK 'Signing a JSON document')", () => {
  // The SDK's signed sample. Signing its content with the SDK's certificate and signing time must reproduce its digests.
  const sample = JSON.parse(readFileSync(join(__dirname, "sdk-signed-sample.json"), "utf8"));
  const sig = (d: typeof sample) => d.Invoice[0].UBLExtensions[0].UBLExtension[0].ExtensionContent[0].UBLDocumentSignatures[0].SignatureInformation[0].Signature[0];
  const sdkCert = Buffer.from(sig(sample).KeyInfo[0].X509Data[0].X509Certificate[0]._, "base64");

  it("reproduces the SDK sample's digests and structure", () => {
    const signed = signDocument(sample, { privateKeyPem: signingKey().privateKeyPem, certificate: sdkCert }, new Date("2024-07-23T15:14:54Z"));
    const ours = sig(signed), theirs = sig(sample);
    expect(ours.SignedInfo[0].Reference[1].DigestValue[0]._).toBe("vMs/IdnS7isftqrBDr4F1LK/CkvBkW5Gb3Wn6OVzAxo="); // DocDigest
    expect(ours.SignedInfo[0].Reference[0].DigestValue[0]._).toBe("Rzuzz+70GSnGBF1YxhHnjSzFpQ1MW4vyX/Q9bTHkE2c="); // PropsDigest
    expect(ours.Object).toEqual(theirs.Object); // CertDigest, issuer name, decimal serial number
    // Same document byte for byte, apart from our key's signature and the subject name (the sample repeats the issuer there).
    const strip = (d: typeof sample) => JSON.stringify(d).replace(/"SignatureValue":\[\{"_":"[^"]+"\}\]/, "").replace(/"X509SubjectName":\[\{"_":"[^"]+"\}\]/, "");
    expect(strip(signed)).toBe(strip(sample));
  });

  it("signs with RSA-SHA256 over the document without its signature parts", () => {
    const signed = signDocument(sample, signingKey());
    const { UBLExtensions: _x, Signature: _s, ...invoice } = signed.Invoice[0];
    const body = Buffer.from(JSON.stringify({ ...signed, Invoice: [invoice] }));
    expect(verify("sha256", body, new X509Certificate(signingKey().certificate).publicKey, Buffer.from(sig(signed).SignatureValue[0]._, "base64"))).toBe(true);
  });

  it("opens a .p12 and refuses a wrong password", () => {
    const k = signingKey();
    const p12 = forge.pkcs12.toPkcs12Asn1(forge.pki.privateKeyFromPem(k.privateKeyPem), [forge.pki.certificateFromAsn1(forge.asn1.fromDer(k.certificate.toString("binary")))], "pw", { algorithm: "aes256" });
    const base64 = forge.util.encode64(forge.asn1.toDer(p12).getBytes());
    expect(readP12(base64, "pw").certificate.equals(k.certificate)).toBe(true);
    expect(() => readP12(base64, "nope")).toThrow("Couldn't open the certificate");
  });
});

describe("e-invoice jobs", () => {
  const org = newId();
  const run = <T>(fn: () => Promise<T>) => asOrg(org, fn);
  beforeEach(() => vi.mocked(myinvois.submit).mockClear());

  async function invoiceFor(project: Record<string, unknown>, einvoice: object = {}) {
    if (!(await OrgModel.exists({ _id: org }))) await OrgModel.create({ _id: org, companyName: "Wawasan", createdBy: newId() });
    const milestoneId = newId();
    const [p] = await run(() => ProjectModel.create([{ code: `PRJ-${milestoneId}`, name: "Bangsar condo", clientName: "Aisha", milestones: [{ _id: milestoneId, seq: 1, name: "Deposit", amount: 108_000 }], ...project }]));
    const [inv] = await run(() => InvoiceModel.create([{ code: `INV-${milestoneId}`, projectId: p._id, milestoneId, amount: 100_000, sstAmount: 8_000, einvoice }]));
    return inv._id;
  }
  const einvoiceOf = async (id: unknown) => (await run(() => InvoiceModel.findById(id).lean()))!.einvoice;
  const complete = { clientPhone: "+60123456789", addressLine1: "2 Jalan Telawi", city: "Kuala Lumpur", state: "W.P. Kuala Lumpur", postcode: "59100", clientIdType: "NRIC", clientIdNo: "900101145678" };

  it("submits, polls, and stores LHDN's validation with its public link", async () => {
    vi.mocked(myinvois.getSubmission).mockResolvedValueOnce({ status: "Valid", documents: [{ uuid: "U1", status: "Valid", longId: "L1", dateTimeValidated: "2026-10-29T02:00:00Z" }] });
    const id = await invoiceFor(complete);
    await run(() => tx(() => enqueue("einvoice.submit", { invoiceId: String(id) })));
    await runDue();

    const doc = JSON.parse(Buffer.from(vi.mocked(myinvois.submit).mock.calls[0][2].json).toString());
    const party = doc.Invoice[0].AccountingCustomerParty[0].Party[0];
    expect(party.PartyIdentification.slice(0, 2)).toEqual([{ ID: [{ _: "EI00000000010", schemeID: "TIN" }] }, { ID: [{ _: "900101145678", schemeID: "NRIC" }] }]);
    expect(party.PostalAddress[0].CountrySubentityCode[0]._).toBe("14");
    expect(doc.Invoice[0].LegalMonetaryTotal[0].PayableAmount[0]._).toBe(1080);
    expect(await einvoiceOf(id)).toMatchObject({ status: "VALID", uuid: "U1", longId: "L1", environment: "preprod" });
    // The PDF is re-rendered with the QR code once valid.
    expect((await run(() => InvoiceModel.findById(id).lean()))!.snapshot?.key).toBeTruthy();
  });

  it("stores LHDN's validation errors as readable lines", async () => {
    vi.mocked(myinvois.getSubmission).mockResolvedValueOnce({ status: "Invalid", documents: [{ uuid: "U1", status: "Invalid" }] });
    vi.mocked(myinvois.documentDetails).mockResolvedValueOnce({ validationResults: { validationSteps: [
      { name: "Step03-Structure", status: "Valid" },
      { name: "Step04-Code Field Validator", status: "Invalid", error: { errorCode: "Error04", error: "Code validation failed", innerError: [{ errorCode: "CV317", error: "Invalid state code" }] } },
    ] } });
    const id = await invoiceFor(complete, { status: "SUBMITTED", submissionUid: "S1", uuid: "U1" });
    await run(() => tx(() => enqueue("einvoice.poll", { invoiceId: String(id) })));
    await runDue();
    expect(await einvoiceOf(id)).toMatchObject({ status: "INVALID", errors: ["Step04-Code Field Validator CV317: Invalid state code"] });
  });

  it("stops before LHDN when the client's details are missing", async () => {
    const id = await invoiceFor({});
    await run(() => tx(() => enqueue("einvoice.submit", { invoiceId: String(id) })));
    await runDue();
    expect(myinvois.submit).not.toHaveBeenCalled();
    expect((await einvoiceOf(id)).errors).toContain("Add the client's phone number to the project");
  });
});
