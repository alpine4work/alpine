import {parseDocumentationSitemapEntries} from "~/shared/docs/documentation_sitemap.js";

test("constructs sitemap entries from validated fields", () => {
    expect(
        parseDocumentationSitemapEntries({
            entries: [
                {
                    pathname: "/blog/example",
                    lastModified: "2026-07-14T00:00:00.000Z",
                    imageUrls: ["/blog/example/image.png"],
                    ignored: "value",
                },
            ],
        }),
    ).toEqual([
        {
            pathname: "/blog/example",
            lastModified: "2026-07-14T00:00:00.000Z",
            imageUrls: ["/blog/example/image.png"],
        },
    ]);
});
