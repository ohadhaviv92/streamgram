import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { logger } from "./logger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: true,
      credentials: true,
    },
    logger: ["error", "warn", "log"],
  });
  app.enableShutdownHooks();

  // Enable validation globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Setup Swagger
  const config = new DocumentBuilder()
    .setTitle("TG2Stream API")
    .setDescription("Search and stream movies/series directly from Telegram")
    .setVersion("1.0.0")
    .addTag("Stream", "Stream operations for movies and series")
    .addTag("Health & Cache", "Health checks and cache management")
    .addTag("Channels", "Telegram channel management")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, document);

  const host = "0.0.0.0";
  const port = parseInt(process.env.PORT || "3000", 10);

  await app.listen(port, host);

  logger.info(
    {
      port,
      host,
      swagger: `http://${host === "0.0.0.0" ? "localhost" : host}:${port}/api`,
    },
    "NestJS server started",
  );
}

bootstrap().catch((error) => {
  logger.error({ err: error }, "Failed to start server");
  process.exit(1);
});
