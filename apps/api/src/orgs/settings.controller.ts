import { Controller, Get, Patch } from "@nestjs/common";
import { bankInput, letterheadInput, pricingInput, taxInput } from "@veenix/shared";
import { Can } from "../common/decorators";
import { ZBody } from "../common/zod";
import { SettingsService } from "./settings.service";

type Svc = SettingsService;

@Controller("org")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Can() @Get() get() { return this.settings.get(); }
  @Can("org:manage") @Patch("letterhead") letterhead(@ZBody(letterheadInput) b: Parameters<Svc["letterhead"]>[0]) { return this.settings.letterhead(b); }
  @Can("org:manage") @Patch("bank") bank(@ZBody(bankInput) b: Parameters<Svc["bank"]>[0]) { return this.settings.bank(b); }
  @Can("org:manage") @Patch("pricing") pricing(@ZBody(pricingInput) b: Parameters<Svc["pricing"]>[0]) { return this.settings.pricing(b); }
  @Can("org:manage") @Patch("tax") tax(@ZBody(taxInput) b: Parameters<Svc["tax"]>[0]) { return this.settings.tax(b); }
}
