const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".3gp",
  ".f4v",
  ".asf",
  ".rm",
  ".rmvb",
  ".vob",
  ".ogv",
  ".drc",
  ".gif",
  ".gifv",
  ".mng",
  ".qt",
  ".yuv",
  ".ts",
  ".mts",
  ".m2ts",
  ".mxf",
]);

export function videoExtension(fileName: string): string {
  const suffix = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  return VIDEO_EXTENSIONS.has(suffix) ? suffix : "";
}
