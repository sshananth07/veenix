import { createHash, createPrivateKey, sign, X509Certificate } from "node:crypto";
import forge from "node-forge";
import { rule } from "../common/errors";

// LHDN's JSON signing (SDK "Signing a JSON document", Invoice v1.1). Checked against the SDK's signed
// sample: the same steps reproduce its DocDigest, CertDigest and PropsDigest exactly (einvoice.test.ts).

type Json = Record<string, unknown>;
export type SigningKey = { privateKeyPem: string; certificate: Buffer };

const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("base64");
const v = (value: string, attrs: Record<string, string> = {}) => [{ _: value, ...attrs }];

/** Node prints "C=MY\nO=LHDNM\nCN=…"; LHDN's sample writes "CN=…, O=LHDNM, C=MY". */
export const distinguishedName = (dn: string) => dn.split("\n").reverse().join(", ");

export function signDocument(doc: Json & { Invoice: Json[] }, key: SigningKey, signingTime = new Date()) {
  // Step 1-2: the digest covers the minified document without UBLExtensions and Signature.
  const { UBLExtensions: _x, Signature: _s, ...invoice } = doc.Invoice[0];
  const body = Buffer.from(JSON.stringify({ ...doc, Invoice: [invoice] }), "utf8");
  // Step 3: RSA PKCS#1 v1.5 over SHA-256 of those bytes (the SDK's SignHash of the digest).
  const signatureValue = sign("sha256", body, createPrivateKey(key.privateKeyPem)).toString("base64");

  // Steps 4-6: the signed properties, digested exactly as they appear inside QualifyingProperties.
  const cert = new X509Certificate(key.certificate);
  const issuerSerial = { X509IssuerName: v(distinguishedName(cert.issuer)), X509SerialNumber: v(BigInt(`0x${cert.serialNumber}`).toString()) };
  const qualifying = {
    Target: "signature",
    SignedProperties: [{
      Id: "id-xades-signed-props",
      SignedSignatureProperties: [{
        SigningTime: v(signingTime.toISOString().replace(/\.\d{3}Z$/, "Z")),
        SigningCertificate: [{ Cert: [{ CertDigest: [{ DigestMethod: v("", { Algorithm: SHA256 }), DigestValue: v(digest(key.certificate)) }], IssuerSerial: [issuerSerial] }] }],
      }],
    }],
  };

  // Step 7: the signed document, minified when serialized.
  const signature = {
    Id: "signature",
    Object: [{ QualifyingProperties: [qualifying] }],
    KeyInfo: [{ X509Data: [{ X509Certificate: v(key.certificate.toString("base64")), X509SubjectName: v(distinguishedName(cert.subject)), X509IssuerSerial: [issuerSerial] }] }],
    SignatureValue: v(signatureValue),
    SignedInfo: [{
      SignatureMethod: v("", { Algorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" }),
      Reference: [
        { Type: "http://uri.etsi.org/01903/v1.3.2#SignedProperties", URI: "#id-xades-signed-props", DigestMethod: v("", { Algorithm: SHA256 }), DigestValue: v(digest(JSON.stringify(qualifying))) },
        { Type: "", URI: "", DigestMethod: v("", { Algorithm: SHA256 }), DigestValue: v(digest(body)) },
      ],
    }],
  };
  const extensions = [{
    UBLExtension: [{
      ExtensionURI: v("urn:oasis:names:specification:ubl:dsig:enveloped:xades"),
      ExtensionContent: [{ UBLDocumentSignatures: [{ SignatureInformation: [{ ID: v("urn:oasis:names:specification:ubl:signature:1"), ReferencedSignatureID: v("urn:oasis:names:specification:ubl:signature:Invoice"), Signature: [signature] }] }] }],
    }],
  }];
  return {
    ...doc,
    Invoice: [{ ...invoice, UBLExtensions: extensions, Signature: [{ ID: v("urn:oasis:names:specification:ubl:signature:Invoice"), SignatureMethod: v("urn:oasis:names:specification:ubl:dsig:enveloped:xades") }] }],
  };
}

/**
 * Opens a .p12/.pfx once, when the settings are saved. node:crypto can't read PKCS#12, so node-forge does;
 * everything after this uses the PEM key and DER certificate with node:crypto.
 */
export function readP12(base64: string, password: string): SigningKey & { cert: X509Certificate } {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(base64)), password);
  } catch {
    throw rule("Couldn't open the certificate. Check it is the .p12 or .pfx file and the password is right");
  }
  const { pkcs8ShroudedKeyBag, keyBag, certBag } = forge.pki.oids;
  const keys = [pkcs8ShroudedKeyBag, keyBag].flatMap((type) => p12.getBags({ bagType: type })[type] ?? []).filter((b) => b.key);
  if (keys.length === 0) throw rule("The certificate file has no RSA private key in it");
  const privateKeyPem = forge.pki.privateKeyToPem(keys[0].key!);
  const privateKey = createPrivateKey(privateKeyPem);
  // The file may carry the CA chain too; the signing certificate is the one that matches the key.
  for (const bag of p12.getBags({ bagType: certBag })[certBag] ?? []) {
    if (!bag.cert) continue;
    const certificate = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(bag.cert)).getBytes(), "binary");
    const cert = new X509Certificate(certificate);
    if (cert.checkPrivateKey(privateKey)) return { privateKeyPem, certificate, cert };
  }
  throw rule("The certificate file has no certificate matching its private key");
}
