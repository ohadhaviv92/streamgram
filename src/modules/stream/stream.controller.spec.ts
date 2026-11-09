import express from "express";
import { AddressInfo } from "net";
import { get, request, Server } from "http";
import { StreamController } from "./stream.controller";
import { Request, Response } from "express";
import { ServiceUnavailableException } from "@nestjs/common";

describe("Tag instruction screen", () => {
  function setup(alreadySent = false) {
    const telegram = {
      getClientForUser: jest.fn(async () => ({})),
      sendMessage: jest.fn(async () => undefined),
    };
    const cache = {
      get: jest.fn(async () => alreadySent ? "sent" : undefined),
      set: jest.fn(async () => undefined),
      deleteSearchResults: jest.fn(),
      del: jest.fn(),
      clearAll: jest.fn(),
    };
    const controller: StreamController = Reflect.construct(StreamController, [
      {}, telegram, { get: () => undefined }, {}, cache,
      { getConfig: () => ({ publicUrl: "https://test.example.com/streamgram/" }) },
    ]);
    const response = { redirect: jest.fn(), setHeader: jest.fn() };
    return { controller, telegram, cache, response };
  }

  it.each(["en", "he", "ru", "ar", "es"])("shows the %s video after sending the account's tag", async (language) => {
    const { controller, telegram, cache, response } = setup();
    const req = { user: { token: "account-1", session_string: "session", language } } as Request;
    await controller.sendTag("tt1234567:1:2", req, response as unknown as Response);
    expect(telegram.getClientForUser).toHaveBeenCalledWith("account-1", "session");
    expect(telegram.sendMessage).toHaveBeenCalledWith({}, "/tag tt1234567:1:2");
    expect(cache.set).toHaveBeenCalledWith("tag-sent:account-1:tt1234567:1:2", "sent", 300);
    expect(cache.deleteSearchResults).not.toHaveBeenCalled();
    expect(cache.del).not.toHaveBeenCalled();
    expect(cache.clearAll).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(response.redirect).toHaveBeenCalledWith(302, `https://test.example.com/streamgram/assets/tag-assistant/instructions-${language}.mp4`);
  });

  it("reopens the video without resending a recent tag", async () => {
    const { controller, telegram, response } = setup(true);
    await controller.sendTag("tt1234567", { user: { token: "account-1", language: "he" } } as Request, response as unknown as Response);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledWith(302, "https://test.example.com/streamgram/assets/tag-assistant/instructions-he.mp4");
  });

  it.each([undefined, "unknown", "../../private"])("falls back to English for language %s", async (language) => {
    const { controller, response } = setup(true);
    await controller.sendTag("tt1234567", { user: { token: "account-1", language } } as Request, response as unknown as Response);
    expect(response.redirect).toHaveBeenCalledWith(302, "https://test.example.com/streamgram/assets/tag-assistant/instructions-en.mp4");
  });

  it("does not show a success screen when Telegram rejects the message", async () => {
    const { controller, telegram, cache, response } = setup();
    telegram.sendMessage.mockRejectedValueOnce(new Error("Telegram unavailable"));
    await expect(controller.sendTag("tt1234567", { user: { token: "account-1" } } as Request, response as unknown as Response))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(response.redirect).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });
});

describe("Stremio result language", () => {
  it.each([
    ["movie", "tt1234567"],
    ["movie", "tg_channel_123"],
    ["series", "tg_folder_1:1:1"],
  ])("uses the resolved account language for %s %s", async (type, id) => {
    const videos = [{
      peer: { kind: "channel" as const, id: "123", accessHash: "456" }, chatId: "123", messageId: 456,
      fileName: "Movie.1080p.mkv", caption: "תרגום מובנה מדובב",
    }];
    const handler = {
      handleMovieRequest: jest.fn(async () => ({
        imdb_id: id, title: "Movie", type: "movie", results: videos,
      })),
      getChannelVideos: jest.fn(async () => videos),
      getFolderChannelVideos: jest.fn(async () => videos),
    };
    const controller: StreamController = Reflect.construct(StreamController, [
      handler, {}, { get: () => undefined }, {}, {},
      { getConfig: () => ({ publicUrl: "https://test.example.com" }) },
    ]);
    for (const [language, subtitles, dubbed] of [
      ["he", "תרגום מובנה", "מדובב"],
      ["en", "Built-in Subtitles", "Dubbed"],
    ]) {
      const req = { user: { token: "test", language } } as Request;
      const result = await controller.getStream(req, type, id);
      expect(result.streams[0].name).toBe(`StreamGram\n1080p\n${subtitles}\n${dubbed}`);
      expect(result.streams[0].url).toBe("https://test.example.com/test/watch/channel/123/456/456");
    }
  });
});

// Exercise real HTTP framing, stream completion, and IncomingMessage lifecycle.
describe("Telegram video HTTP streaming", () => {
  const fileSize = 12 * 1024 * 1024 + 123;
  let server: Server;
  let url: string;
  let releaseClient: jest.Mock;
  let telegram: {
    createStreamSession: jest.Mock;
    releaseStreamSession: jest.Mock;
    preparePlayback: jest.Mock;
    hasStreamableMedia: jest.Mock;
    getFileSize: jest.Mock;
    getContentType: jest.Mock;
    streamMessageRange: jest.Mock;
  };

  beforeEach(async () => {
    releaseClient = jest.fn();
    telegram = {
      createStreamSession: jest.fn(() => new AbortController()),
      releaseStreamSession: jest.fn(async (controller: AbortController) => controller.abort()),
      preparePlayback: jest.fn(async () => ({ client: {}, message: {}, release: releaseClient })),
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
    expect(releaseClient).toHaveBeenCalledTimes(1);
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
    expect(releaseClient).toHaveBeenCalledTimes(1);
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
    expect(releaseClient).toHaveBeenCalledTimes(1);
  });

  it("releases the session if metadata lookup fails", async () => {
    telegram.preparePlayback.mockRejectedValue(new Error("lookup failure"));
    const result = await fetchVideo();
    expect(result.status).toBe(500);
    expect(telegram.releaseStreamSession).toHaveBeenCalledTimes(1);
    expect(releaseClient).not.toHaveBeenCalled();
  });
});
