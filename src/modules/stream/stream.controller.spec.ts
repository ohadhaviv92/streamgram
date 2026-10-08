import express from "express";
import { AddressInfo } from "net";
import { get, request, Server } from "http";
import { StreamController } from "./stream.controller";

// Exercise real HTTP framing, stream completion, and IncomingMessage lifecycle.
describe("Telegram video HTTP streaming", () => {
  const fileSize = 12 * 1024 * 1024 + 123;
  let server: Server;
  let url: string;
  let telegram: {
    createStreamSession: jest.Mock;
    releaseStreamSession: jest.Mock;
    getClientForUser: jest.Mock;
    getMessageWithCache: jest.Mock;
    hasStreamableMedia: jest.Mock;
    getFileSize: jest.Mock;
    getContentType: jest.Mock;
    streamMessageRange: jest.Mock;
  };

  beforeEach(async () => {
    telegram = {
      createStreamSession: jest.fn(() => new AbortController()),
      releaseStreamSession: jest.fn(async (controller: AbortController) => controller.abort()),
      getClientForUser: jest.fn(async () => ({})),
      getMessageWithCache: jest.fn(async () => ({})),
      hasStreamableMedia: jest.fn(() => true),
      getFileSize: jest.fn(() => fileSize),
      getContentType: jest.fn(() => "video/mp4"),
      streamMessageRange: jest.fn(async function* (
        _client: unknown, _message: unknown, start: number, end: number,
      ) {
        for (let position = start; position <= end; position += 1024 * 1024) {
          yield Buffer.alloc(Math.min(1024 * 1024, end - position + 1), position % 251);
        }
      }),
    };
    const controller: StreamController = Reflect.construct(StreamController, [
      {}, telegram, {}, {}, {}, {},
    ]);
    const app = express();
    app.get("/watch", (req, res) => {
      req.user = { token: "test", session_string: "test" } as typeof req.user;
      void controller.watchVideo({ chatId: "1", messageId: "1" }, req, res);
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/watch`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function fetchVideo(range?: string, method = "GET", ifRange?: string) {
    return new Promise<{ status: number; headers: import("http").IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (range) headers.Range = range;
      if (ifRange) headers["If-Range"] = ifRange;
      const req = request(url, { method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it.each([undefined, "bytes=0-"])("streams beyond 10 MiB for %s", async (range) => {
    const result = await fetchVideo(range);
    expect(result.status).toBe(range ? 206 : 200);
    expect(result.body.length).toBe(fileSize);
    expect(result.headers["content-length"]).toBe(String(fileSize));
    expect(result.headers["accept-ranges"]).toBe("bytes");
    expect(result.headers["content-range"]).toBe(range ? `bytes 0-${fileSize - 1}/${fileSize}` : undefined);
    expect(telegram.releaseStreamSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["bytes=1048577-2097159", 1048577, 2097159],
    ["bytes=-4096", fileSize - 4096, fileSize - 1],
    [`bytes=${fileSize - 7}-${fileSize + 100}`, fileSize - 7, fileSize - 1],
  ])("serves exact range %s", async (range, start, end) => {
    const result = await fetchVideo(String(range));
    expect(result.status).toBe(206);
    expect(result.body.length).toBe(Number(end) - Number(start) + 1);
    expect(result.headers["content-range"]).toBe(`bytes ${start}-${end}/${fileSize}`);
    expect(result.headers["content-length"]).toBe(String(result.body.length));
  });

  it.each([`bytes=${fileSize}-`, "bytes=99-1", "bytes=-0"])("rejects unsatisfiable range %s", async (range) => {
    const result = await fetchVideo(range);
    expect(result.status).toBe(416);
    expect(result.headers["content-range"]).toBe(`bytes */${fileSize}`);
    expect(result.body.length).toBe(0);
    expect(telegram.streamMessageRange).not.toHaveBeenCalled();
  });

  it.each(["garbage", "bytes=0-9,20-29", "items=0-9"])("ignores unsupported range %s", async (range) => {
    const result = await fetchVideo(range);
    expect(result.status).toBe(200);
    expect(result.body.length).toBe(fileSize);
  });

  it("answers HEAD without downloading media", async () => {
    const result = await fetchVideo("bytes=0-9", "HEAD");
    expect(result.status).toBe(200);
    expect(result.headers["content-length"]).toBe(String(fileSize));
    expect(result.body.length).toBe(0);
    expect(telegram.streamMessageRange).not.toHaveBeenCalled();
  });

  it("returns the full representation for unvalidated If-Range", async () => {
    const result = await fetchVideo("bytes=0-9", "GET", '"old-etag"');
    expect(result.status).toBe(200);
    expect(result.body.length).toBe(fileSize);
  });

  it("aborts and releases the session when the player disconnects", async () => {
    const released = new Promise<void>((resolve) => {
      telegram.releaseStreamSession.mockImplementation(async (controller: AbortController) => {
        controller.abort();
        resolve();
      });
    });
    telegram.streamMessageRange.mockImplementation(async function* (
      _client: unknown, _message: unknown, _start: number, _end: number, controller: AbortController,
    ) {
      while (!controller.signal.aborted) {
        yield Buffer.alloc(65536);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    });
    await new Promise<void>((resolve, reject) => {
      const req = get(url, (res) => res.once("data", () => {
        res.destroy();
        resolve();
      }));
      req.on("error", reject);
    });
    await released;
    expect(telegram.createStreamSession.mock.results[0].value.signal.aborted).toBe(true);
    expect(telegram.releaseStreamSession).toHaveBeenCalledTimes(1);
  });

  it("fails the connection on an upstream error after headers", async () => {
    const released = new Promise<void>((resolve) => {
      telegram.releaseStreamSession.mockImplementation(async (controller: AbortController) => {
        controller.abort();
        resolve();
      });
    });
    telegram.streamMessageRange.mockImplementation(async function* () {
      yield Buffer.alloc(65536);
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error("Telegram failure");
    });
    await expect(fetchVideo()).rejects.toThrow();
    await released;
    expect(telegram.releaseStreamSession).toHaveBeenCalledTimes(1);
  });

  it("releases the session if metadata lookup fails", async () => {
    telegram.getMessageWithCache.mockRejectedValue(new Error("lookup failure"));
    const result = await fetchVideo();
    expect(result.status).toBe(500);
    expect(telegram.releaseStreamSession).toHaveBeenCalledTimes(1);
  });
});
