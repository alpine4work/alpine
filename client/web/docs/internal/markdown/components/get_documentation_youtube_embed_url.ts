import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Convert a supported public YouTube URL into its privacy-enhanced embed URL.
 */
export function getDocumentationYoutubeEmbedUrl(url: string): string {
    const parsedUrl = new URL(url);
    assert(parsedUrl.protocol === "https:", "Expected an HTTPS YouTube URL");

    let videoId: string | null = null;
    switch (parsedUrl.hostname) {
        case "youtu.be":
        case "www.youtu.be": {
            videoId = parsedUrl.pathname.split("/")[1] ?? null;
            break;
        }
        case "youtube.com":
        case "www.youtube.com":
        case "m.youtube.com": {
            if (parsedUrl.pathname === "/watch") {
                videoId = parsedUrl.searchParams.get("v");
            } else {
                videoId = parsedUrl.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/)?.[1] ?? null;
            }
            break;
        }
        default: {
            assert(false, "Expected a YouTube URL");
        }
    }

    assert(videoId !== null && /^[A-Za-z0-9_-]{11}$/.test(videoId), "Expected a YouTube video ID");
    return `https://www.youtube-nocookie.com/embed/${videoId}`;
}
