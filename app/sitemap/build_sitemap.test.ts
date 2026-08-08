import {buildSitemap, serializeSitemap} from "~/app/sitemap/build_sitemap.js";
import {loadGeneratedDocumentationSitemapEntries} from "~/app/sitemap/load_generated_documentation_sitemap_entries.js";

test("builds Alpine\u2019s enabled sitemap surfaces", async () => {
    const locations = Array.from(
        (await buildSitemap()).matchAll(/<loc>([^<]+)<\/loc>/g),
        match => match[1],
    );

    expect(locations).toEqual([
        "https://alpine.inc/",
        "https://alpine.inc/auth/sign-in",
        "https://alpine.inc/auth/sign-up",
    ]);
});

test("prepares documentation surfaces in their future crawl order", async () => {
    const entries = await loadGeneratedDocumentationSitemapEntries();
    const pathnames = entries.map(entry => entry.pathname);
    const firstApiDocumentationIndex = pathnames.findIndex(
        (pathname, index) => index >= 7 && pathname.startsWith("/docs/api/"),
    );
    const entryByPathname = new Map(entries.map(entry => [entry.pathname, entry]));

    expect({
        leadingPathnames: pathnames.slice(0, 8),
        blogLastModified: entryByPathname.get("/blog")?.lastModified,
        blogPostLastModified: entryByPathname.get(
            "/blog/my-year-abandoning-slack-notion-and-linear-for-alpine",
        )?.lastModified,
        documentationLastModified: entryByPathname.get("/docs/overview")?.lastModified,
        apiLastModified: entries.find(entry => entry.pathname.startsWith("/docs/api/schemas/"))
            ?.lastModified,
        hasDocumentationBeforeApi:
            firstApiDocumentationIndex > 7 &&
            pathnames
                .slice(7, firstApiDocumentationIndex)
                .every(pathname => pathname.startsWith("/docs/")),
        hasOnlyApiDocumentationAfterward:
            firstApiDocumentationIndex !== -1 &&
            pathnames
                .slice(firstApiDocumentationIndex)
                .every(pathname => pathname.startsWith("/docs/api/")),
    }).toEqual({
        leadingPathnames: [
            "/blog",
            "/docs",
            "/docs/api",
            "/blog/my-year-abandoning-slack-notion-and-linear-for-alpine",
            "/blog/write-your-own-database-clients",
            "/blog/announcing-the-first-coding-agent-in-alpine-cursor",
            "/blog/introducing-alpine-the-future-of-work",
            "/docs/overview",
        ],
        blogLastModified: "2026-02-25T00:00:00.000Z",
        blogPostLastModified: "2026-02-25T00:00:00.000Z",
        documentationLastModified: null,
        apiLastModified: null,
        hasDocumentationBeforeApi: true,
        hasOnlyApiDocumentationAfterward: true,
    });
});

test("builds absolute canonical URLs with accurate dates and images", () => {
    expect(
        serializeSitemap({
            origin: "https://alpine.inc",
            entries: [
                {
                    pathname: "/blog/alpine-and-friends",
                    lastModified: "2026-07-14",
                    imageUrls: ["/blog/alpine-and-friends.png?size=large&format=webp"],
                },
            ],
        }),
    ).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://alpine.inc/blog/alpine-and-friends</loc>
    <lastmod>2026-07-14</lastmod>
    <image:image><image:loc>https://alpine.inc/blog/alpine-and-friends.png?size=large&amp;format=webp</image:loc></image:image>
  </url>
</urlset>
`);
});

test("omits unsupported priority and change frequency fields", () => {
    const sitemap = serializeSitemap({
        origin: "https://alpine.inc",
        entries: [{pathname: "/docs/overview", lastModified: null, imageUrls: []}],
    });

    expect(sitemap).not.toMatch(/priority|changefreq|lastmod|xmlns:image/);
});

test("builds a valid empty sitemap when no public surface entries are enabled", () => {
    expect(serializeSitemap({origin: "https://alpine.inc", entries: []})).toBe(
        `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</urlset>
`,
    );
});
