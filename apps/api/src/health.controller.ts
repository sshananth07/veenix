import { Controller, Get } from "@nestjs/common";
import mongoose from "mongoose";
import { Public } from "./common/decorators";

@Controller("health")
export class HealthController {
  @Public()
  @Get()
  async get() {
    await mongoose.connection.db!.admin().ping();
    return { ok: true };
  }
}
