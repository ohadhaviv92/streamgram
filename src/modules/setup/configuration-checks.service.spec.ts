import { TelegramClientManager } from "../telegram/telegram-client.manager";
import { EventEmitter } from "events";
import * as https from "https";
import { ConfigurationChecksService } from "./configuration-checks.service";
import { InstanceConfigService } from "../user/instance-config.service";

jest.mock("https", () => ({ get: jest.fn() }));

const config = () => ({
  publicUrl: "https://stream.example/prefix/",
  telegram: { apiId: 12345, apiHash: "a".repeat(32) },
  tmdb: { bearerToken: "private-token" },
  preferredLanguage: "en" as const,
});

describe("Configuration checks", () => {
  let saved: ReturnType<typeof config>;
  let service: ConfigurationChecksService;
  let checkApiCredentials: jest.Mock;
  let responses: Map<string, { status?: number; body?: unknown; error?: string; raw?: string; hang?: boolean }>;
  beforeEach(() => {
    saved = config();
    checkApiCredentials = jest.fn().mockResolvedValue(undefined);
    service = new ConfigurationChecksService(
      { getConfig: () => saved } as InstanceConfigService,
      { checkApiCredentials } as unknown as TelegramClientManager,
    );
    responses = new Map([
      ["api.themoviedb.org", { status: 200, body: { id: 11 } }],
      ["stream.example", { status: 200, body: service.probe() }],
    ]);
    (https.get as jest.Mock).mockReset().mockImplementation((url: URL, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & { destroy: (error?: Error) => void };
      request.destroy = (error) => {
        if (error) request.emit("error", error);
        request.emit("close");
      };
      process.nextTick(() => {
        const result = responses.get(url.hostname);
        if (!result) throw new Error("Missing test response");
        if (result.hang) return;
        if (result.error) { request.destroy(new Error(result.error)); return; }
        const response = new EventEmitter() as EventEmitter & { statusCode: number; destroy: () => void };
        response.statusCode = result.status ?? 200;
        response.destroy = () => request.emit("close");
        callback(response);
        if (response.statusCode !== 200) return;
        response.emit("data", Buffer.from(result.raw ?? JSON.stringify(result.body)));
        response.emit("end");
        request.emit("close");
      });
      return request;
    });
  });
  afterEach(() => jest.useRealTimers());

  it("checks APIs concurrently, preserves URL prefixes, and returns only safe results", async () => {
    const pending = service.check();
    expect(https.get).toHaveBeenCalledTimes(2);
    expect(service.check()).toBe(pending);
    const result = await pending;
    expect(result.telegram.status).toBe("passed");
    expect(checkApiCredentials).toHaveBeenCalledWith(12345, "a".repeat(32));
    expect(result.tmdb.status).toBe("passed");
    expect(result.streamingHttps.status).toBe("passed");
    expect(new Date(result.checkedAt).toISOString()).toBe(result.checkedAt);
    expect((https.get as jest.Mock).mock.calls[1][0].href).toBe("https://stream.example/prefix/setup/probe");
    expect((https.get as jest.Mock).mock.calls[1][1]).toMatchObject({ rejectUnauthorized: true });
    expect(JSON.stringify(result)).not.toMatch(/private-token|aaaaaaaa|12345|instanceId/);
    await service.check();
    expect(https.get).toHaveBeenCalledTimes(4);
  });
  it("does not share checks across changed saved configuration", async () => {
    const first = service.check();
    saved = { ...saved, tmdb: { bearerToken: "new-token" } };
    const second = service.check();
    expect(second).not.toBe(first);
    await Promise.all([first, second]);
    expect(https.get).toHaveBeenCalledTimes(4);
  });
  it.each([0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1])("rejects malformed API ID %s", async (id) => {
    saved.telegram.apiId = id;
    expect((await service.check()).telegram.status).toBe("failed");
    expect(checkApiCredentials).not.toHaveBeenCalled();
  });
  it.each(["", "not-a-hash", "g".repeat(32)])("rejects malformed hash %s", async (hash) => {
    saved.telegram.apiHash = hash;
    expect((await service.check()).telegram.status).toBe("failed");
    expect(checkApiCredentials).not.toHaveBeenCalled();
  });
  it.each(["API_ID_INVALID", "API_HASH_INVALID", "CONNECTION_API_ID_INVALID", "API_ID_PUBLISHED_FLOOD"])("reports rejected Telegram credentials (%s)", async (errorMessage) => {
    checkApiCredentials.mockRejectedValue({ errorMessage, message: "private-token" });
    const result = await service.check();
    expect(result.telegram.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("private-token");
  });
  it.each(["FLOOD_WAIT_60", "AUTH_RESTART", "NETWORK_ERROR"])("leaves Telegram inconclusive for %s", async (errorMessage) => {
    checkApiCredentials.mockRejectedValue({ errorMessage });
    expect((await service.check()).telegram.status).toBe("unverified");
  });
  it("reports missing TMDB tokens without a request", async () => {
    saved.tmdb.bearerToken = "";
    expect((await service.check()).tmdb.status).toBe("failed");
    expect(https.get).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 429, 500, 302])("distinguishes TMDB status %s", async (status) => {
    responses.set("api.themoviedb.org", { status });
    const result = await service.check();
    expect(result.tmdb.status).toBe([401, 403].includes(status) ? "failed" : "unverified");
  });
  it.each(["http://stream.example", "https://user:password@stream.example", "", "https://stream.example?q=1", "https://stream.example/#fragment"])("rejects unsuitable URL %s", async (url) => {
    saved.publicUrl = url;
    expect((await service.check()).streamingHttps.status).toBe("failed");
    expect(https.get).toHaveBeenCalledTimes(1);
  });
  it.each([301, 302, 404])("rejects streaming response %s without following redirects", async (status) => {
    responses.set("stream.example", { status });
    expect((await service.check()).streamingHttps.status).toBe("failed");
    expect(https.get).toHaveBeenCalledTimes(2);
  });
  it("rejects a different instance", async () => {
    responses.set("stream.example", { body: { instanceId: "other" } });
    expect((await service.check()).streamingHttps.status).toBe("failed");
  });
  it.each(["CERT_HAS_EXPIRED", "ENOTFOUND", "ECONNREFUSED"])("handles network/TLS failure %s without leaking errors", async (error) => {
    responses.set("stream.example", { error });
    responses.set("api.themoviedb.org", { error });
    const result = await service.check();
    expect(result.streamingHttps.status).toBe("unverified");
    expect(result.tmdb.status).toBe("unverified");
    expect(JSON.stringify(result)).not.toContain(error);
  });
  it.each(["not json", "[]", "x".repeat(65537)])("bounds and validates responses", async (raw) => {
    responses.set("stream.example", { raw });
    expect((await service.check()).streamingHttps.status).toBe("unverified");
  });
  it("times out both requests after ten seconds and allows retry", async () => {
    jest.useFakeTimers();
    responses.set("stream.example", { hang: true });
    responses.set("api.themoviedb.org", { hang: true });
    const pending = service.check();
    await jest.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result.tmdb.status).toBe("unverified");
    expect(result.streamingHttps.status).toBe("unverified");
    expect(jest.getTimerCount()).toBe(0);
  });
  it("exposes only a process identifier through the probe", () => {
    expect(Object.keys(service.probe())).toEqual(["instanceId"]);
    expect(service.probe()).toEqual(service.probe());
  });
});
