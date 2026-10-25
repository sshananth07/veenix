import "./mail/mail"; // registers the mail.send job handler
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

// One module for the whole API. Later tasks append to `controllers` and `providers`.
@Module({
  imports: [ClsModule.forRoot({ global: true, middleware: { mount: true } })],
  controllers: [HealthController, OrgsController, UploadsController, JobsController, LiveController, SearchController, VendorsController, LeadsController, ProjectsController],
  providers: [{ provide: APP_GUARD, useClass: AccessGuard }, { provide: APP_FILTER, useClass: ErrorFilter }, OrgsService, VendorsService, LeadsService, ProjectsService],
})
export class AppModule {}
