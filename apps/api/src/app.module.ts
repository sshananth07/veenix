import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ClsModule } from "nestjs-cls";
import { HealthController } from "./health.controller";
import { ErrorFilter } from "./common/error.filter";
import { OrgsController } from "./orgs/orgs.controller";
import { OrgsService } from "./orgs/orgs.service";

// One module for the whole API. Later tasks append to `controllers` and `providers`.
@Module({
  imports: [ClsModule.forRoot({ global: true, middleware: { mount: true } })],
  controllers: [HealthController, OrgsController],
  providers: [{ provide: APP_FILTER, useClass: ErrorFilter }, OrgsService],
})
export class AppModule {}
