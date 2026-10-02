import pino from "pino";

export const logger = pino({
  name: "tg2stream",
  level: "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty" }
      : undefined,
});
