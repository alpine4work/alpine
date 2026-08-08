import {
    createDocumentationMeta,
    createDocumentationMetaFunction,
} from "~/app/docs/opengraph/create_documentation_meta.js";

describe("createDocumentationMeta", () => {
    test("creates documentation metadata", () => {
        expect(
            createDocumentationMeta({
                type: "Documentation",
                title: "Documents",
                description: "Write and collaborate in Alpine.",
                pageUrl: "/docs/guides/documents",
            }),
        ).toEqual(
            expect.arrayContaining([
                {title: "Documents | Alpine"},
                {name: "application-name", content: "Alpine"},
                {name: "description", content: "Write and collaborate in Alpine."},
                {name: "robots", content: "noindex,nofollow"},
                {
                    tagName: "link",
                    rel: "canonical",
                    href: "https://alpine.inc/docs/guides/documents",
                },
                {property: "og:type", content: "article"},
                {property: "og:site_name", content: "Alpine"},
                {property: "og:locale", content: "en_US"},
                {property: "article:section", content: "Documentation"},
                {property: "og:title", content: "Documents | Alpine"},
                {property: "og:description", content: "Write and collaborate in Alpine."},
                {property: "og:url", content: "https://alpine.inc/docs/guides/documents"},
                {
                    property: "og:image",
                    content: "https://alpine.inc/docs/guides/documents/og.png",
                },
                {
                    name: "twitter:url",
                    content: "https://alpine.inc/docs/guides/documents",
                },
            ]),
        );
    });

    test("adds article author and publishing metadata", () => {
        expect(
            createDocumentationMeta({
                type: "Blog",
                title: "Designing the Work Graph",
                description: "A summary.",
                pageUrl: "/blog/designing-the-work-graph",
                authorName: "Josh Johnson",
                publishDate: "2026-07-11",
                modifiedDate: "2026-07-12T17:41:48.303Z",
                tags: ["Design", "Collaboration"],
                twitterCreator: "@imjosh_in",
            }),
        ).toEqual(
            expect.arrayContaining([
                {property: "og:type", content: "article"},
                {property: "article:section", content: "Blog"},
                {name: "author", content: "Josh Johnson"},
                {property: "article:author", content: "Josh Johnson"},
                {property: "article:published_time", content: "2026-07-11T00:00:00.000Z"},
                {property: "article:modified_time", content: "2026-07-12T17:41:48.303Z"},
                {property: "article:tag", content: "Design"},
                {property: "article:tag", content: "Collaboration"},
                {name: "keywords", content: "Design, Collaboration"},
                {name: "twitter:creator", content: "@imjosh_in"},
                {
                    property: "og:image",
                    content: "https://alpine.inc/blog/designing-the-work-graph/og.png",
                },
            ]),
        );
    });

    test("omits description metadata when the page has no description", () => {
        const metadata = createDocumentationMeta({
            type: "APIReference",
            title: "ContentCodeBlockElement",
            pageUrl: "/docs/api/schemas/ContentCodeBlockElement",
        });
        const descriptions = metadata.filter(
            descriptor =>
                ("name" in descriptor &&
                    (descriptor.name === "description" ||
                        descriptor.name === "twitter:description")) ||
                ("property" in descriptor && descriptor.property === "og:description"),
        );

        expect(descriptions).toEqual([]);
    });

    test.each([undefined, new TypeError("Page unavailable")])(
        "creates safe metadata when loader data is unavailable",
        data => {
            const meta = createDocumentationMetaFunction<never>(() => {
                throw new TypeError("The page callback should not be called");
            });

            expect(meta({data})).toEqual([{name: "robots", content: "noindex"}, {title: "Alpine"}]);
        },
    );
});
