import { addPreviewMetadata } from "./dashboard.controller";

describe("Dashboard link previews", () => {
  const html = '<html><head><title>StreamGram</title></head><body></body></html>';

  it("uses a small thumbnail at the configured public URL", () => {
    const result = addPreviewMetadata(html, "https://streamgram.example/");
    expect(result).toContain('property="og:image" content="https://streamgram.example/preview-logo-v1.png"');
    expect(result).toContain('property="og:image:width" content="200"');
    expect(result).toContain('name="twitter:card" content="summary"');
    expect(result).not.toContain("summary_large_image");
  });

  it("escapes public URLs before embedding them in HTML", () => {
    const result = addPreviewMetadata(html, 'https://streamgram.example/" onload="bad');
    expect(result).not.toContain('" onload="bad');
    expect(result).toContain("&quot;");
  });
});
