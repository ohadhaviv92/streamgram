// mp4box exports CommonJS declarations, but its legacy `types` field points
// to a missing .d.ts. Keep this project on its existing Node module resolver.
declare module "mp4box" {
  export { createFile, DataStream } from "mp4box/dist/mp4box.all.cjs";
}
