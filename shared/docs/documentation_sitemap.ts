import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.open_source.js";

export type DocumentationSitemapEntry = {
    pathname: string;
    lastModified: string | null;
    imageUrls: Array<string>;
};

/** Parse generated canonical sitemap entries. */
export function parseDocumentationSitemapEntries(value: unknown): Array<DocumentationSitemapEntry> {
    assert(isPlainObject(value), "Expected generated documentation sitemap");
    assert(Array.isArray(value.entries), "Expected generated documentation sitemap entries");

    return value.entries.map((entry, index) => {
        assert(isPlainObject(entry), `Expected sitemap entry ${index}`);
        assert(typeof entry.pathname === "string", `Expected sitemap pathname ${index}`);
        assert(
            entry.lastModified === null || typeof entry.lastModified === "string",
            `Expected sitemap last modified date ${index}`,
        );
        assert(Array.isArray(entry.imageUrls), `Expected sitemap images ${index}`);
        assert(
            entry.imageUrls.every(imageUrl => typeof imageUrl === "string"),
            `Expected sitemap image URLs ${index}`,
        );
        return {
            pathname: entry.pathname,
            lastModified: entry.lastModified,
            imageUrls: [...entry.imageUrls],
        };
    });
}
