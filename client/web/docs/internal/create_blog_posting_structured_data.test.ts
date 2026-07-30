import {createBlogPostingStructuredData} from "~/client/web/docs/internal/create_blog_posting_structured_data.js";

test("creates canonical BlogPosting structured data", () => {
    expect(
        createBlogPostingStructuredData({
            post: {
                slug: "hello-world",
                title: "Hello world",
                summary: "A summary.",
                publishDate: "2026-01-01",
                modifiedDate: "2026-01-02T00:00:00.000Z",
                authorId: "josh",
                tags: ["Product"],
                previewImage: "/blog/hello/preview.png",
                previewImageData: {
                    src: "/blog/hello/preview.0123456789abcdef.png",
                    srcSet: "/blog/hello/preview.0123456789abcdef.320w.webp 320w",
                    width: 1200,
                    height: 720,
                },
                previewImageAlt: "Preview",
                mdxCode: "",
                previousArticle: null,
                nextArticle: null,
            },
            author: {
                id: "josh",
                name: "Josh",
                socials: {x: "https://x.com/josh", bluesky: null, linkedin: null, email: null},
                avatarUrl: "/blog/authors/josh.avif",
                avatarImage: {src: "avatar", srcSet: "avatar 24w", width: 512, height: 512},
            },
        }),
    ).toMatchObject({
        "@type": "BlogPosting",
        url: "https://alpine.inc/blog/hello-world",
        datePublished: "2026-01-01",
        dateModified: "2026-01-02T00:00:00.000Z",
        image: {
            "@type": "ImageObject",
            url: "https://alpine.inc/blog/hello-world/og.png",
            width: 1200,
            height: 630,
        },
        author: {"@type": "Person", name: "Josh", sameAs: ["https://x.com/josh"]},
        publisher: {
            "@type": "Organization",
            name: "Alpine",
            logo: {
                "@type": "ImageObject",
                url: "https://resources.alpine.inc/app-icons/app-icon-512x512.png",
                width: 512,
                height: 512,
            },
        },
    });
});
