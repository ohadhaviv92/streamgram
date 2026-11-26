import { readFileSync } from "fs";
import { join } from "path";
import { createFile } from "mp4box";
import { remuxLivePart, unwrapLivePart, UnsupportedLiveMediaError } from "./live-remux";

// Synthetic black video + silence, generated locally, containing no user media.
const mp4 = readFileSync(join(__dirname, "fixtures/live-synthetic.mp4"));
const header = Buffer.from("0d812ea1036d7034000000000100000000000000000000000000000000000000", "hex");
const part = () => Buffer.concat([header, mp4]);

describe("Telegram live MP4 remuxing", () => {
  it("unwraps Telegram's header without searching for container signatures in arbitrary data", () => {
    expect(unwrapLivePart(part())).toEqual(mp4);
    expect(() => unwrapLivePart(mp4)).toThrow(UnsupportedLiveMediaError);
    expect(() => unwrapLivePart(Buffer.concat([Buffer.alloc(100), mp4]))).toThrow(UnsupportedLiveMediaError);
    for (const size of [0, 4, 7, 12, 16, 30, 35]) expect(() => unwrapLivePart(part().subarray(0, size))).toThrow(UnsupportedLiveMediaError);
    const oversizedEvents = part(); oversizedEvents.writeUInt32LE(0xffffffff, 12);
    expect(() => unwrapLivePart(oversizedEvents)).toThrow(UnsupportedLiveMediaError);
  });

  it("creates a two-track fMP4 initialization and a continuous, one-second timeline without transcoding", () => {
    const outputs = [0, 1, 2].map(sequence => remuxLivePart(part(), sequence));
    expect(outputs.every(output => output.startsWithKeyframe)).toBe(true);
    expect(new Set(outputs.map(output => output.signature)).size).toBe(1);
    const combined = Buffer.concat([outputs[0].init, ...outputs.map(output => output.media)]);
    const file = createFile();
    const buffer = combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.length) as ArrayBuffer & { fileStart: number };
    buffer.fileStart = 0;
    file.appendBuffer(buffer);
    file.flush();
    const tracks = file.getInfo().tracks;
    expect(tracks.map(track => track.codec)).toEqual([expect.stringMatching(/^avc1\./), "mp4a.40.2"]);
    for (const track of tracks) {
      const samples = file.getTrackSamplesInfo(track.id);
      expect(samples[0].dts).toBe(0);
      expect((samples.at(-1)?.dts ?? 0) + (samples.at(-1)?.duration ?? 0)).toBe(3 * track.timescale);
      expect(samples.every((sample, index) => !index || sample.dts === samples[index - 1].dts + samples[index - 1].duration)).toBe(true);
    }
  });

  it("ignores bitrate-only changes but detects decoder configuration changes", () => {
    const changed = part();
    // btrt boxes describe bandwidth rather than decoder configuration.
    let offset = changed.indexOf("btrt");
    while (offset !== -1) { changed.writeUInt32BE(999999, offset + 8); offset = changed.indexOf("btrt", offset + 4); }
    expect(remuxLivePart(changed, 0).signature).toBe(remuxLivePart(part(), 0).signature);
    const changedCodec = part();
    const avc = changedCodec.indexOf("avcC");
    changedCodec[avc + 7] ^= 1; // AVCLevelIndication
    expect(remuxLivePart(changedCodec, 0).signature).not.toBe(remuxLivePart(part(), 0).signature);
  });

  it("rejects unsupported codecs and malformed media instead of advertising a broken stream", () => {
    const unsupported = part();
    unsupported.write("hvc1", unsupported.lastIndexOf("avc1"));
    expect(() => remuxLivePart(unsupported, 0)).toThrow(UnsupportedLiveMediaError);
    expect(() => remuxLivePart(part().subarray(0, 200), 0)).toThrow(UnsupportedLiveMediaError);
  });
});
