import { createHash } from "crypto";
import { createFile, DataStream } from "mp4box";

export class UnsupportedLiveMediaError extends Error {}

/** Telegram's VideoStreamingPart header, followed by a complete MP4 file.
 * Reference: tgcalls/group/VideoStreamingPart.cpp, consumeVideoStreamInfo.
 */
export function unwrapLivePart(data: Buffer): Buffer {
  let offset = 0;
  const fail = (): never => { throw new UnsupportedLiveMediaError("Unsupported Telegram live container"); };
  const int = () => {
    if (offset + 4 > data.length) return fail();
    const value = data.readUInt32LE(offset); offset += 4; return value;
  };
  const string = () => {
    if (offset >= data.length) return fail();
    const start = offset;
    let size = data[offset++];
    if (size === 254) {
      if (offset + 3 > data.length) return fail();
      size = data.readUIntLE(offset, 3); offset += 3;
    } else if (size === 255) return fail();
    const end = offset + size;
    if (end > data.length) return fail();
    const value = data.toString("utf8", offset, end);
    offset = start + Math.ceil((end - start) / 4) * 4;
    if (offset > data.length) return fail();
    return value;
  };
  if (int() !== 0xa12e810d || string() !== "mp4") return fail();
  int(); // active mask
  const events = int();
  if (events > 100) return fail();
  for (let i = 0; i < events; i++) { int(); string(); int(); int(); }
  if (offset + 8 > data.length || data.toString("ascii", offset + 4, offset + 8) !== "ftyp") return fail();
  return data.subarray(offset);
}

export interface RemuxedLivePart {
  init: Buffer;
  media: Buffer;
  signature: string;
  startsWithKeyframe: boolean;
}

/** Remux H.264/AAC samples into HLS fMP4 without decoding or transcoding.
 * Each Telegram RTMP part represents one second, with a fresh MP4 timeline.
 */
export function remuxLivePart(bytes: Buffer, sequence: number): RemuxedLivePart {
  const mp4 = unwrapLivePart(bytes);
  const file = createFile();
  let result: RemuxedLivePart | undefined;
  let parseError = false;
  const fragments: Buffer[] = [];
  file.onError = () => { parseError = true; };
  file.onSegment = (_id, _user, buffer) => { fragments.push(Buffer.from(buffer)); };
  file.onReady = info => {
    if (info.tracks.length !== 2 || info.videoTracks.length !== 1 || info.audioTracks.length !== 1
      || !info.videoTracks[0].codec.startsWith("avc1.") || info.audioTracks[0].codec !== "mp4a.40.2") {
      throw new UnsupportedLiveMediaError("Live playback requires H.264 video and AAC audio");
    }
    const hash = createHash("sha256");
    for (const track of info.tracks) {
      const samples = file.getTrackSamplesInfo(track.id);
      if (!samples.length || samples.length > 500 || !track.timescale || samples[0].dts !== 0) {
        throw new UnsupportedLiveMediaError("Unsupported live sample timeline");
      }
      // Match configuration bytes, not only codec names: dimensions, SPS/PPS,
      // AAC configuration and timescales must trigger a new initialization map.
      hash.update(JSON.stringify({ id: track.id, timescale: track.timescale, codec: track.codec, video: track.video, audio: track.audio }));
      const entries = file.getTrackById(track.id).mdia.minf.stbl.stsd.entries;
      if (entries.length !== 1) throw new UnsupportedLiveMediaError("Multiple live sample descriptions");
      const entry = entries[0] as unknown as {
        avcC?: { write(stream: DataStream): void };
        esds?: { esd: { descs: Array<{ tag: number; descs: Array<{ tag: number; data?: Uint8Array }> }> } };
      };
      if (entry.avcC) {
        const stream = new DataStream();
        entry.avcC.write(stream);
        hash.update(Buffer.from(stream.buffer));
      } else {
        const config = entry.esds?.esd.descs.find(desc => desc.tag === 4)?.descs.find(desc => desc.tag === 5)?.data;
        if (!config) throw new UnsupportedLiveMediaError("Missing AAC configuration");
        hash.update(config);
      }
      const last = samples[samples.length - 1];
      if (last.dts >= track.timescale || last.dts < track.timescale * 0.8) {
        throw new UnsupportedLiveMediaError("Unsupported live segment duration");
      }
      // Telegram MP4s can give the final video sample a duration of one tick.
      // Align both tracks to the one-second broadcast clock, avoiding gaps.
      last.duration = track.timescale - last.dts;
      for (const sample of samples) {
        sample.dts += sequence * track.timescale;
        sample.cts += sequence * track.timescale;
      }
      file.setSegmentOptions(track.id, null, { nbSamples: 1000, rapAlignement: false });
    }
    const startsWithKeyframe = file.getTrackSamplesInfo(info.videoTracks[0].id)[0].is_sync;
    const init = file.initializeSegmentation();
    result = { init: Buffer.from(init.buffer), media: Buffer.alloc(0), signature: hash.digest("hex"), startsWithKeyframe };
    file.start();
  };
  const buffer = mp4.buffer.slice(mp4.byteOffset, mp4.byteOffset + mp4.byteLength) as ArrayBuffer & { fileStart: number };
  buffer.fileStart = 0;
  try {
    file.appendBuffer(buffer);
    file.flush();
  } catch (error) {
    if (error instanceof UnsupportedLiveMediaError) throw error;
    throw new UnsupportedLiveMediaError("Invalid live MP4 data");
  }
  if (parseError || !result || !fragments.length) throw new UnsupportedLiveMediaError("Invalid live MP4 data");
  result.media = Buffer.concat(fragments);
  return result;
}
