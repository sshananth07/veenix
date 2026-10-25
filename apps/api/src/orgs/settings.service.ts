import { Injectable } from "@nestjs/common";
import { ctx } from "../common/context";
import { afterCommit, tx } from "../common/tx";
import { audit } from "../audit/audit";
import { changed } from "../live/live";
import { claim, removeObject } from "../storage/storage";
import { OrgModel, loadOrg } from "./org.model";
import { toOrgDto } from "./orgs.service";

type Letterhead = { companyName: string; companyReg: string; companyAddress: string; companyPhone: string; logo: { key: string; name: string } | "remove" | null };

@Injectable()
export class SettingsService {
  async get() {
    return toOrgDto(await loadOrg());
  }

  async letterhead(input: Letterhead) {
    const { logo, ...fields } = input;
    const current = await loadOrg();
    const logoPath = logo === "remove" ? null : logo ? (await claim(logo, "logos")).path : current.logoPath;
    await OrgModel.updateOne({ _id: ctx().orgId }, { $set: { ...fields, logoPath } });
    if (current.logoPath && current.logoPath !== logoPath) await removeObject(current.logoPath);
    changed({ kind: "org" });
  }

  private async set(action: string, data: object) {
    await tx(async () => {
      await OrgModel.updateOne({ _id: ctx().orgId }, { $set: data });
      await audit(action, "organization", ctx().orgId, data);
      afterCommit(() => changed({ kind: "org" }));
    });
  }

  bank = (input: { bankName: string; bankAccountName: string; bankAccount: string; swiftCode: string | null }) => this.set("org.bank_changed", input);
  pricing = (input: { defaultMarkupPct: number; minMarkupPct: number }) => this.set("org.pricing_changed", input);
  tax = (input: { sstBps: number }) => this.set("org.tax_changed", input);
}
