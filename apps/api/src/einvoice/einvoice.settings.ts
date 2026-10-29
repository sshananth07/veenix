import type { EinvoiceSettingsInput } from "@veenix/shared";
import { ctx } from "../common/context";
import { decrypt, encrypt } from "../common/crypto";
import { rule } from "../common/errors";
import { afterCommit, tx } from "../common/tx";
import { audit } from "../audit/audit";
import { changed } from "../live/live";
import { OrgModel, loadOrg } from "../orgs/org.model";
import { distinguishedName, readP12, type SigningKey } from "./sign";

type Fields = Omit<EinvoiceSettingsInput, "clientSecret" | "certificateBase64" | "certificatePassword">;
export type EinvoiceSettings = Fields & {
  clientSecretEnc: string | null;
  /** The signing key as PEM, encrypted. The .p12 and its password are not kept. */
  privateKeyEnc: string | null;
  /** The signing certificate, DER as base64 (public, so not encrypted). */
  certificate: string | null;
  certificateSubject: string | null;
  certificateExpiresAt: Date | null;
};

/** The stored settings, still encrypted. Null until the organization saves them once. */
export async function einvoiceSettings(): Promise<EinvoiceSettings | null> {
  return ((await loadOrg()).einvoice as EinvoiceSettings | null) ?? null;
}

export async function einvoiceSecrets(): Promise<{ clientSecret: string } & SigningKey> {
  const s = await einvoiceSettings();
  if (!s?.clientSecretEnc || !s.privateKeyEnc || !s.certificate) throw rule("E-invoice credentials are not set up");
  return { clientSecret: decrypt(s.clientSecretEnc), privateKeyPem: decrypt(s.privateKeyEnc), certificate: Buffer.from(s.certificate, "base64") };
}

/** What GET returns: never a secret, only whether one is stored. */
export async function einvoiceSettingsView() {
  const s = await einvoiceSettings();
  if (!s) return null;
  const { clientSecretEnc, privateKeyEnc, certificate: _c, ...rest } = s;
  return { ...rest, hasClientSecret: !!clientSecretEnc, hasCertificate: !!privateKeyEnc };
}

export async function saveEinvoiceSettings(input: EinvoiceSettingsInput) {
  const { clientSecret, certificateBase64, certificatePassword, ...fields } = input;
  const current = await einvoiceSettings();
  const key = certificateBase64 ? readP12(certificateBase64, certificatePassword!) : null;
  if (key && new Date(key.cert.validTo) < new Date()) throw rule(`This certificate expired on ${key.cert.validTo}`);
  const next: EinvoiceSettings = {
    ...fields,
    clientSecretEnc: clientSecret ? encrypt(clientSecret) : current?.clientSecretEnc ?? null,
    privateKeyEnc: key ? encrypt(key.privateKeyPem) : current?.privateKeyEnc ?? null,
    certificate: key ? key.certificate.toString("base64") : current?.certificate ?? null,
    certificateSubject: key ? distinguishedName(key.cert.subject) : current?.certificateSubject ?? null,
    certificateExpiresAt: key ? new Date(key.cert.validTo) : current?.certificateExpiresAt ?? null,
  };
  if (next.enabled && (!next.clientSecretEnc || !next.privateKeyEnc)) {
    throw rule("Add the client secret and the signing certificate before turning e-invoicing on");
  }
  await tx(async () => {
    await OrgModel.updateOne({ _id: ctx().orgId }, { $set: { einvoice: next } });
    await audit("org.einvoice_changed", "organization", ctx().orgId, { enabled: next.enabled, environment: next.environment, certificateChanged: !!key });
    afterCommit(() => changed({ kind: "org" }));
  });
}
