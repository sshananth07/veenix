import "reflect-metadata";
import { createApp } from "./app.factory";
import { env } from "./config/env";

async function bootstrap() {
  const app = await createApp();
  await app.listen(env.PORT);
}
void bootstrap();
