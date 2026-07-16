import {DocumentationYoutubeEmbed} from "~/client/web/docs/internal/markdown/components/documentation_youtube_embed.js";
import {getDocumentationYoutubeEmbedUrl} from "~/client/web/docs/internal/markdown/components/get_documentation_youtube_embed_url.js";

test("creates a privacy-enhanced embed URL from a short YouTube URL", () => {
    expect(
        getDocumentationYoutubeEmbedUrl("https://youtu.be/f-5dMvqtXps?si=ccj-SbNSLzBYJ6VT"),
    ).toBe("https://www.youtube-nocookie.com/embed/f-5dMvqtXps");
});

test("creates a privacy-enhanced embed URL from a YouTube watch URL", () => {
    expect(getDocumentationYoutubeEmbedUrl("https://www.youtube.com/watch?v=f-5dMvqtXps")).toBe(
        "https://www.youtube-nocookie.com/embed/f-5dMvqtXps",
    );
});

test("rejects non-YouTube video URLs", () => {
    expect(() => getDocumentationYoutubeEmbedUrl("https://example.com/f-5dMvqtXps")).toThrow(
        "Assertion failure: Expected a YouTube URL",
    );
});

test("renders a titled YouTube link in markdown", () => {
    expect(
        DocumentationYoutubeEmbed.markdown({
            url: "https://youtu.be/f-5dMvqtXps?si=ccj-SbNSLzBYJ6VT",
            title: "Cursor in Alpine",
        }),
    ).toBe("[Cursor in Alpine](https://youtu.be/f-5dMvqtXps?si=ccj-SbNSLzBYJ6VT)\n\n");
});

test("uses an accessible default YouTube link title", () => {
    expect(DocumentationYoutubeEmbed.markdown({url: "https://youtu.be/f-5dMvqtXps"})).toBe(
        "[Watch video on YouTube](https://youtu.be/f-5dMvqtXps)\n\n",
    );
});
