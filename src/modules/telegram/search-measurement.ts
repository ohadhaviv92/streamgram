import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import { Api } from "teleproto";
import { logger } from "../../logger";

type Counts = { attempts: number; successes: number; failures: number };
export type SearchPhase = "tags" | "primary" | "short-title" | "channel-fallback";
type GlobalCall = Counts & {
  phase: SearchPhase;
  query: string;
  filter: string;
  requestedLimit: number;
  returnedMessageCount?: number;
  reportedTotal?: number;
  videoCandidateCount?: number;
  acceptedVideoCount: number;
  elapsedMs: number;
};
type Measurement = {
  searchId: string;
  ordinaryCacheHit: boolean;
  globalSearch: Counts;
  calls: GlobalCall[];
  otherRpc: Record<string, Counts>;
};
const context = new AsyncLocalStorage<{ measurement: Measurement; phase: SearchPhase }>();
const counts = (): Counts => ({ attempts: 0, successes: 0, failures: 0 });

/** Request-local accounting; never wrap or replace the shared Telegram client. */
export async function measureSearch<T extends unknown[]>(search: () => Promise<T>): Promise<T> {
  const measurement: Measurement = {
    searchId: randomUUID(), ordinaryCacheHit: false, globalSearch: counts(), calls: [], otherRpc: {},
  };
  const started = Date.now();
  return context.run({ measurement, phase: "primary" }, async () => {
    let result: T | undefined;
    try {
      result = await search();
      return result;
    } finally {
      logger.info({
        ...measurement,
        finalUniqueResultCount: result?.length,
        completed: result !== undefined,
        elapsedMs: Date.now() - started,
      }, "Telegram media search completed");
    }
  });
}

export function inSearchPhase<T>(phase: SearchPhase, search: () => Promise<T>): Promise<T> {
  const current = context.getStore();
  return current ? context.run({ ...current, phase }, search) : search();
}

export function recordSearchCacheHit(): void {
  const current = context.getStore();
  if (current) current.measurement.ordinaryCacheHit = true;
}

export async function measureGlobalSearch<T extends Api.messages.TypeMessages>(
  request: Api.messages.SearchGlobal,
  invoke: () => Promise<T>,
  isVideo: (message: Api.Message) => boolean,
): Promise<{ response: T; call: GlobalCall }> {
  const current = context.getStore();
  const call: GlobalCall = {
    ...counts(), attempts: 1, phase: current?.phase || "primary",
    query: request.q, filter: request.filter.className, requestedLimit: request.limit,
    acceptedVideoCount: 0, elapsedMs: 0,
  };
  current?.measurement.calls.push(call);
  if (current) current.measurement.globalSearch.attempts++;
  const started = Date.now();
  try {
    const response = await invoke();
    call.successes++;
    if (current) current.measurement.globalSearch.successes++;
    if ("messages" in response) {
      call.returnedMessageCount = response.messages.length;
      call.videoCandidateCount = response.messages.filter((m) => m instanceof Api.Message && isVideo(m)).length;
    }
    if ("count" in response) call.reportedTotal = response.count;
    return { response, call };
  } catch (error) {
    call.failures++;
    if (current) current.measurement.globalSearch.failures++;
    throw error;
  } finally {
    call.elapsedMs = Date.now() - started;
  }
}

/** Count actual invoke calls, including entity resolution and reply/fallback fetches. */
export async function measureOtherRpc<T>(name: string, invoke: () => Promise<T>): Promise<T> {
  const current = context.getStore();
  if (!current) return invoke();
  const rpc = current.measurement.otherRpc[name] ||= counts();
  rpc.attempts++;
  try {
    const result = await invoke();
    rpc.successes++;
    return result;
  } catch (error) {
    rpc.failures++;
    throw error;
  }
}
