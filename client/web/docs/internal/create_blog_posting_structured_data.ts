import {BlogAuthor} from "~/shared/docs/blog_author.js";
import {BlogPostPageData, createBlogPostUrl} from "~/shared/docs/blog_post.js";

/** Build the BlogPosting JSON-LD object for an authored Alpine article. */
export function createBlogPostingStructuredData({
    post,
    author,
}: {
    post: BlogPostPageData;
    author: BlogAuthor;
}) {
    const pageUrl = createBlogPostUrl(post.slug);
    const url = `https://alpine.inc${pageUrl}`;
    const sameAs = [author.socials.x, author.socials.bluesky, author.socials.linkedin].filter(
        (socialUrl): socialUrl is string => socialUrl !== null,
    );

    return {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: post.title,
        description: post.summary,
        url,
        mainEntityOfPage: {"@type": "WebPage", "@id": url},
        image: {
            "@type": "ImageObject",
            url: `https://alpine.inc${pageUrl}/og.png`,
            width: 1200,
            height: 630,
        },
        datePublished: post.publishDate,
        dateModified: post.modifiedDate,
        author: {
            "@type": "Person",
            name: author.name,
            ...(sameAs.length > 0 ? {sameAs} : {}),
        },
        publisher: {
            "@type": "Organization",
            name: "Alpine",
            url: "https://alpine.inc",
            logo: {
                "@type": "ImageObject",
                url: "https://resources.alpine.inc/app-icons/app-icon-512x512.png",
                width: 512,
                height: 512,
            },
        },
        keywords: post.tags,
        inLanguage: "en-US",
    };
}
