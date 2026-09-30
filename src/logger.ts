import pino from "pino";

export const logger = pino({
  name: "tg-to-stream",
  level: "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty" }
      : undefined,
});
