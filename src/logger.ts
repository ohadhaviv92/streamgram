import pino from "pino";

export const logger = pino({
  name: "streamgram",
  level: "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty" }
      : undefined,
});
