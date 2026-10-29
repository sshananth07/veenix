import type { EinvoiceSettingsInput } from "@veenix/shared";
import { ctx } from "../common/context";
import { decrypt, encrypt } from "../common/crypto";
import { rule } from "../common/errors";
import { afterCommit, tx } from "../common/tx";
import { audit } from "../audit/audit";
import { changed } from "../live/live";
import { OrgModel, loadOrg } from "../orgs/org.model";

export type EinvoiceSettings = {
  enabled: boolean; environment: "preprod" | "prod"; tin: string; brn: string; sstNo: string | null; msicCode: string;
  businessActivity: string; clientId: string; clientSecretEnc: string | null; certificateEnc: string | null; certificatePasswordEnc: string | null;
};

/** The stored settings, still encrypted. Null until the organization saves them once. */
export async function einvoiceSettings(): Promise<EinvoiceSettings | null> {
  return ((await loadOrg()).einvoice as EinvoiceSettings | null) ?? null;
}

export async function einvoiceSecrets() {
  const s = await einvoiceSettings();
  if (!s?.clientSecretEnc || !s.certificateEnc || !s.certificatePasswordEnc) throw rule("E-invoice credentials are not set up");
  return { clientSecret: decrypt(s.clientSecretEnc), certificate: Buffer.from(decrypt(s.certificateEnc), "base64"), certificatePassword: decrypt(s.certificatePasswordEnc) };
}

/** What GET returns: never a secret, only whether one is stored. */
export async function einvoiceSettingsView() {
  const s = await einvoiceSettings();
  if (!s) return null;
  const { clientSecretEnc, certificateEnc, certificatePasswordEnc: _p, ...rest } = s;
  return { ...rest, hasClientSecret: !!clientSecretEnc, hasCertificate: !!certificateEnc };
}

export async function saveEinvoiceSettings(input: EinvoiceSettingsInput) {
  const { clientSecret, certificateBase64, certificatePassword, ...fields } = input;
  const current = await einvoiceSettings();
  const next: EinvoiceSettings = {
    ...fields,
    clientSecretEnc: clientSecret ? encrypt(clientSecret) : current?.clientSecretEnc ?? null,
    certificateEnc: certificateBase64 ? encrypt(certificateBase64) : current?.certificateEnc ?? null,
    certificatePasswordEnc: certificatePassword ? encrypt(certificatePassword) : current?.certificatePasswordEnc ?? null,
  };
  if (next.enabled && (!next.clientSecretEnc || !next.certificateEnc || !next.certificatePasswordEnc)) {
    throw rule("Add the client secret, signing certificate and its password before turning e-invoicing on");
  }
  await tx(async () => {
    await OrgModel.updateOne({ _id: ctx().orgId }, { $set: { einvoice: next } });
    await audit("org.einvoice_changed", "organization", ctx().orgId, { enabled: next.enabled, environment: next.environment });
    afterCommit(() => changed({ kind: "org" }));
  });
}
