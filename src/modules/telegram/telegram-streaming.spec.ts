import { Api, TelegramClient } from "teleproto";
import bigInt from "big-integer";
import { TelegramNestService } from "./telegram.service";

jest.mock("../../logger", () => ({ logger: { warn: jest.fn(), info: jest.fn() } }));

describe("Telegram byte range downloads", () => {
  const requestSize = 1024 * 1024;
  const document = new Api.Document({
    id: bigInt(1), accessHash: bigInt(2), fileReference: Buffer.alloc(0),
    date: 0, mimeType: "video/mp4", size: bigInt(4 * requestSize), dcId: 1,
    attributes: [],
  });
  const message = {
    id: 1, media: new Api.MessageMediaDocument({ document }),
  } as unknown as Api.Message;
  let service: TelegramNestService;
  const file = (bytes: Buffer) => new Api.upload.File({
    type: new Api.storage.FileUnknown(), mtime: 0, bytes,
  });
  beforeEach(() => {
    service = Reflect.construct(TelegramNestService, [
      {}, { get: (key: string) => key === "streaming" ? { maxRequestSize: requestSize } : {} }, {},
    ]);
  });
  afterEach(() => jest.useRealTimers());

  async function collect(iterator: AsyncIterable<Buffer>) {
    const chunks: Buffer[] = [];
    for await (const chunk of iterator) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  it("aligns Telegram offsets and slices the exact requested bytes across chunks", async () => {
    const source = Buffer.alloc(3 * requestSize);
    for (let i = 0; i < source.length; i++) source[i] = i % 251;
    const start = requestSize + 5000;
    const end = 2 * requestSize + 100;
    const invoke = jest.fn(async (request: Api.upload.GetFile) => {
      const offset = request.offset.toJSNumber();
      return file(source.subarray(offset, offset + request.limit));
    });
    const client = { invoke } as unknown as TelegramClient;
    const controller = new AbortController();
    const result = await collect(service.streamMessageRange(client, message, start, end, controller));
    expect(result).toEqual(source.subarray(start, end + 1));
    expect(invoke.mock.calls[0]).toEqual([
      expect.objectContaining({ offset: bigInt(requestSize), limit: requestSize }),
      1, { abortSignal: controller.signal, floodSleepThreshold: 0 },
    ]);
  });

  it("uses a 4KB request for a tiny player probe", async () => {
    const invoke = jest.fn().mockResolvedValue(file(Buffer.alloc(4096, 7)));
    const result = await collect(service.streamMessageRange(
      { invoke } as unknown as TelegramClient, message, 5000, 5010, new AbortController(),
    ));
    expect(result).toEqual(Buffer.alloc(11, 7));
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ offset: bigInt(4096), limit: 4096 }), 1, expect.anything(),
    );
  });

  it("throws if Telegram reaches EOF before the advertised range is complete", async () => {
    const client = { invoke: jest.fn().mockResolvedValue(file(Buffer.alloc(100))) } as unknown as TelegramClient;
    await expect(collect(service.streamMessageRange(
      client, message, 0, 199, new AbortController(),
    ))).rejects.toThrow("expected 200 bytes, received 100");
  });

  it("does not start a download after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const invoke = jest.fn();
    await expect(collect(service.streamMessageRange(
      { invoke } as unknown as TelegramClient, message, 0, 999, controller,
    ))).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("retries a premium flood wait at the same offset and shares the cooldown", async () => {
    jest.useFakeTimers();
    const invoke = jest.fn()
      .mockRejectedValueOnce({ errorMessage: "FLOOD_PREMIUM_WAIT_9", seconds: 9 })
      .mockResolvedValue(file(Buffer.alloc(4096)));
    const client = { invoke } as unknown as TelegramClient;
    const first = collect(service.streamMessageRange(client, message, 0, 99, new AbortController()));
    await jest.advanceTimersByTimeAsync(0);
    const second = collect(service.streamMessageRange(client, message, 0, 99, new AbortController()));
    await jest.advanceTimersByTimeAsync(8999);
    expect(invoke).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect((await first).length).toBe(100);
    expect((await second).length).toBe(100);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls.every(([request]) => request.offset.equals(0))).toBe(true);
  });

  it("cancels a flood wait immediately without retrying", async () => {
    jest.useFakeTimers();
    const invoke = jest.fn().mockRejectedValue({ errorMessage: "FLOOD_WAIT_10", seconds: 10 });
    const controller = new AbortController();
    const pending = collect(service.streamMessageRange(
      { invoke } as unknown as TelegramClient, message, 0, 99, controller,
    ));
    const rejected = expect(pending).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("cancels an in-flight RPC through its abort signal", async () => {
    const controller = new AbortController();
    const invoke = jest.fn((_request, _dcId, options: Api.ApiCallOptions) =>
      new Promise((_resolve, reject) => {
        options.abortSignal?.addEventListener("abort", () => reject(options.abortSignal?.reason), { once: true });
      }),
    );
    const pending = collect(service.streamMessageRange(
      { invoke } as unknown as TelegramClient, message, 0, 99, controller,
    ));
    const rejected = expect(pending).rejects.toThrow();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);
    controller.abort();
    await rejected;
  });

  it("bounds repeated flood retries instead of waiting forever", async () => {
    jest.useFakeTimers();
    const error = { errorMessage: "FLOOD_WAIT_1", seconds: 1 };
    const invoke = jest.fn().mockRejectedValue(error);
    const pending = collect(service.streamMessageRange(
      { invoke } as unknown as TelegramClient, message, 0, 99, new AbortController(),
    ));
    const rejected = expect(pending).rejects.toBe(error);
    await jest.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(invoke).toHaveBeenCalledTimes(6);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("routes a migrated file to its new DC", async () => {
    const invoke = jest.fn()
      .mockRejectedValueOnce({ errorMessage: "FILE_MIGRATE_2", newDc: 2 })
      .mockResolvedValue(file(Buffer.alloc(4096)));
    await collect(service.streamMessageRange(
      { invoke } as unknown as TelegramClient, message, 0, 99, new AbortController(),
    ));
    expect(invoke.mock.calls[1][1]).toBe(2);
  });
});
