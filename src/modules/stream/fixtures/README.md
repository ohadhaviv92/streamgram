`live-synthetic.mp4` contains one second of generated 16×16 black H.264 video
and silent AAC audio. No Telegram/user media is included.

Generated for remuxing tests with:

```sh
ffmpeg -f lavfi -i color=c=black:s=16x16:r=25 -f lavfi -i anullsrc=r=48000:cl=stereo \
  -c:v libx264 -tune zerolatency -bf 0 -g 25 -c:a aac \
  -frames:v 25 -frames:a 47 -use_editlist 0 live-synthetic.mp4
```

FFmpeg is only a fixture-generation/verification tool. StreamGram's live
playback runtime uses teleproto and MP4Box.js, without an external media engine.
