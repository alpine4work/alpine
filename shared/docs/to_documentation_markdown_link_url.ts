import {documentationHomeUrl} from "~/shared/docs/documentation_home_url.js";

/**
 * Rewrite an internal docs link to its markdown twin so a rendered markdown page
 * links to other markdown pages (`/docs/guides/tasks` -> `/docs/guides/tasks.md`).
 * External links, in-page anchors, and links already ending in `.md` are left as
 * is. Used only when serializing docs to markdown, never for the HTML site.
 */
export function toDocumentationMarkdownLinkUrl(url: string): string {
    if (url !== documentationHomeUrl && !url.startsWith(`${documentationHomeUrl}/`)) return url;

    const hashIndex = url.indexOf("#");
    const path = hashIndex === -1 ? url : url.slice(0, hashIndex);
    const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
    return path.endsWith(".md") ? url : `${path}.md${hash}`;
}
