import { Controller, Get } from "@nestjs/common";
import { Can } from "../common/decorators";
import { DashboardService } from "./dashboard.service";

@Controller()
export class DashboardController {
  constructor(private readonly dash: DashboardService) {}

  @Can("project:read") @Get("dashboard") dashboard() { return this.dash.dashboard(); }
  @Can("report:read") @Get("reports") reports() { return this.dash.reports(); }
}
