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

// One module for the whole API. Later tasks append to `controllers` and `providers`.
@Module({
  imports: [ClsModule.forRoot({ global: true, middleware: { mount: true } })],
  controllers: [HealthController, OrgsController, UploadsController, JobsController],
  providers: [{ provide: APP_GUARD, useClass: AccessGuard }, { provide: APP_FILTER, useClass: ErrorFilter }, OrgsService],
})
export class AppModule {}
