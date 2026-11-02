import "./mail/mail"; // registers the mail.send job handler
import "./documents/stored"; // registers the document.snapshot job handler
import "./einvoice/einvoice.jobs"; // registers the einvoice.submit and einvoice.poll job handlers
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ClsModule } from "nestjs-cls";
import { HealthController } from "./health.controller";
import { AccessGuard } from "./auth/access.guard";
import { ErrorFilter } from "./common/error.filter";
import { OrgsController } from "./orgs/orgs.controller";
import { OrgsService } from "./orgs/orgs.service";
import { UploadsController } from "./storage/uploads.controller";
import { JobsController } from "./jobs/jobs.controller";
import { LiveController } from "./live/live.controller";
import { SearchController } from "./search/search.controller";
import { VendorsController } from "./vendors/vendors.controller";
import { VendorsService } from "./vendors/vendors.service";
import { LeadsController } from "./leads/leads.controller";
import { LeadsService } from "./leads/leads.service";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectsService } from "./projects/projects.service";
import { BomController } from "./projects/bom.controller";
import { BomService } from "./projects/bom.service";
import { QuotationsController } from "./quotations/quotations.controller";
import { QuotationsService } from "./quotations/quotations.service";
import { ProcurementController } from "./procurement/procurement.controller";
import { ProcurementService } from "./procurement/procurement.service";
import { VariationsController } from "./variations/variations.controller";
import { VariationsService } from "./variations/variations.service";
import { BillingController } from "./billing/billing.controller";
import { BillingService } from "./billing/billing.service";
import { FilesController } from "./files/files.controller";
import { FilesService } from "./files/files.service";
import { SettingsController } from "./orgs/settings.controller";
import { SettingsService } from "./orgs/settings.service";
import { DashboardController } from "./dashboard/dashboard.controller";
import { DashboardService } from "./dashboard/dashboard.service";
import { DocumentsController } from "./documents/documents.controller";
import { DocumentsService } from "./documents/documents.service";
import { UpdatesController } from "./updates/updates.controller";
import { UpdatesService } from "./updates/updates.service";
import { TasksController } from "./tasks/tasks.controller";
import { TasksService } from "./tasks/tasks.service";

// One module for the whole API. Later tasks append to `controllers` and `providers`.
@Module({
  imports: [ClsModule.forRoot({ global: true, middleware: { mount: true } })],
  controllers: [HealthController, OrgsController, UploadsController, JobsController, LiveController, SearchController, VendorsController, LeadsController, ProjectsController, BomController, QuotationsController, ProcurementController, VariationsController, BillingController, FilesController, SettingsController, DashboardController, DocumentsController, UpdatesController, TasksController],
  providers: [{ provide: APP_GUARD, useClass: AccessGuard }, { provide: APP_FILTER, useClass: ErrorFilter }, OrgsService, VendorsService, LeadsService, ProjectsService, BomService, QuotationsService, ProcurementService, VariationsService, BillingService, FilesService, SettingsService, DashboardService, DocumentsService, UpdatesService, TasksService],
})
export class AppModule {}
