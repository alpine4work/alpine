import {Link} from "@remix-run/react";
import {ArrowLeft, ArrowRight, EnvelopeSimple} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";
import {documentationMdxComponents} from "~/client/web/docs/documentation_mdx_components.js";
import {DocumentationResponsiveImage} from "~/client/web/docs/documentation_responsive_image.js";
import {createBlogPostingStructuredData} from "~/client/web/docs/internal/create_blog_posting_structured_data.js";
import {DocumentationHeader} from "~/client/web/docs/internal/documentation_header.js";
import {formatBlogPublishDate} from "~/client/web/docs/internal/format_blog_publish_date.js";
import {getDocumentationMdxContent} from "~/client/web/docs/internal/get_documentation_mdx_content.js";
import {BlueskyLogo} from "~/client/web/icons/socials/bluesky_logo.js";
import {LinkedInLogo} from "~/client/web/icons/socials/linkedin_logo.js";
import {XLogo} from "~/client/web/icons/socials/x_logo.js";
import {BlogAuthorById} from "~/shared/docs/blog_author.js";
import {
    BlogPostAdjacentArticle,
    BlogPostPageData,
    createBlogPostUrl,
} from "~/shared/docs/blog_post.js";
import {DocumentationSearchIndex} from "~/shared/docs/search_documentation_entries.js";

const blogPostCss = `
.blogPostProse img {
    border: 1px solid var(--grey-5);
    border-radius: 8px;
    display: block;
    height: auto;
    margin-left: auto;
    margin-right: auto;
    max-width: calc(100% - 24px);
}
.blogAdjacentArticles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.blogAdjacentArticleLink {
    border: 1px solid var(--grey-5);
    border-radius: 8px;
    color: inherit;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 132px;
    padding: 18px;
    text-decoration: none;
}
.blogAuthorSocialLink {
    align-items: center;
    border-radius: 999px;
    display: inline-flex;
    height: 22px;
    justify-content: center;
    text-decoration: none;
    width: 22px;
}
.blogAdjacentArticleLinkNext {
    align-items: flex-end;
    grid-column: 2;
    text-align: right;
}
@media (max-width: 680px) {
    .blogAdjacentArticles { grid-template-columns: minmax(0, 1fr); }
    .blogAdjacentArticleLinkNext { grid-column: auto; }
}
`;

/**
 * Render an individual blog post with MDX content and adjacent article links.
 */
export function BlogPostPage({
    post,
    authors,
    searchIndex,
}: {
    post: BlogPostPageData;
    authors: BlogAuthorById;
    searchIndex: DocumentationSearchIndex;
}) {
    const Content = getDocumentationMdxContent(post.mdxCode);
    const author = authors[post.authorId];
    const markdownUrl = `${createBlogPostUrl(post.slug)}.md`;
    const structuredData = createBlogPostingStructuredData({post, author});
    // Escape opening tags so authored text cannot terminate the JSON-LD script.
    const structuredDataJson = JSON.stringify(structuredData).replaceAll("<", "\\u003c");

    return (
        <Box
            minHeight="full"
            backgroundColor="grey-0"
            color="grey-90"
            style={{minHeight: "100svh"}}
        >
            <style dangerouslySetInnerHTML={{__html: blogPostCss}} />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{__html: structuredDataJson}}
            />

            {/* Point AI agents and tools at the markdown version of this page. The
                `<link rel="alternate">` is the machine-standard signal (React hoists it
                into `<head>`); the hidden note is a plain-language fallback for anything
                reading the HTML body. Both are invisible to people. */}
            <link rel="alternate" type="text/markdown" href={markdownUrl} />
            <Box as="div" hidden data-docs-markdown-hint>
                {`This blog is also available as markdown for AI agents and tools. Append \`.md\` to any blog URL to get the markdown version of a page. For this page, that is ${markdownUrl}. The blog home is available at \`/blog.md\`.`}
            </Box>

            <DocumentationHeader surface="blog" searchIndex={searchIndex} />
            <Box as="main" paddingX="6" paddingTop="10" paddingBottom="24" userSelect="text">
                <Box marginX="center" style={{maxWidth: 820}}>
                    <Box as="article">
                        <Box as="header" marginBottom="8">
                            <Box
                                as="h1"
                                fontSize="700"
                                fontStyle="extra-bold"
                                color="grey-90"
                                marginTop="0"
                                marginBottom="4"
                                style={{lineHeight: 1.08}}
                            >
                                {post.title}
                            </Box>
                            <Box fontSize="200" color="grey-60" style={{lineHeight: 1.65}}>
                                {post.summary}
                            </Box>
                            <Box display="flex" alignItems="center" gap="4" marginTop="6">
                                <Box display="flex" alignItems="center" gap="3">
                                    <DocumentationResponsiveImage
                                        image={author.avatarImage}
                                        alt=""
                                        sizes="36px"
                                        style={{borderRadius: "999px", height: 36, width: 36}}
                                    />
                                    <Box>
                                        <Box fontSize="100" fontStyle="semi-bold" color="grey-80">
                                            {author.name}
                                        </Box>
                                        <BlogAuthorLinks author={author} />
                                    </Box>
                                </Box>
                                <Box
                                    aria-hidden
                                    backgroundColor="grey-10"
                                    flexShrink="0"
                                    style={{height: 28, width: 1}}
                                />
                                <Box color="grey-50" fontSize="75">
                                    <time dateTime={post.publishDate}>
                                        {formatBlogPublishDate(post.publishDate)}
                                    </time>
                                </Box>
                            </Box>
                        </Box>

                        <Box className="blogPostProse">
                            <Content components={documentationMdxComponents} />
                        </Box>

                        <BlogAdjacentArticles post={post} />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

/**
 * Render previous and next article navigation when adjacent posts exist.
 */
function BlogAdjacentArticles({post}: {post: BlogPostPageData}) {
    if (post.previousArticle === null && post.nextArticle === null) return null;

    return (
        <Box
            className="blogAdjacentArticles"
            as="nav"
            display="grid"
            gap="4"
            marginTop="12"
            aria-label="Adjacent blog articles"
        >
            {post.previousArticle !== null ? (
                <BlogAdjacentArticleLink
                    article={post.previousArticle}
                    direction="previous"
                    label="Previous article"
                />
            ) : null}
            {post.nextArticle !== null ? (
                <BlogAdjacentArticleLink
                    article={post.nextArticle}
                    direction="next"
                    label="Next article"
                />
            ) : null}
        </Box>
    );
}

/**
 * Render one adjacent article navigation target.
 */
function BlogAdjacentArticleLink({
    article,
    direction,
    label,
}: {
    article: BlogPostAdjacentArticle;
    direction: "previous" | "next";
    label: string;
}) {
    const isNext = direction === "next";

    return (
        <Link
            className={`blogAdjacentArticleLink${isNext ? " blogAdjacentArticleLinkNext" : ""}`}
            to={createBlogPostUrl(article.slug)}
            prefetch="intent"
            aria-label={`${label}: ${article.title}`}
        >
            <Box display="flex" alignItems="center" gap="2" fontSize="75" color="grey-50">
                {isNext ? null : <ArrowLeft size={14} />}
                <Box as="span" fontStyle="semi-bold">
                    {label}
                </Box>
                {isNext ? <ArrowRight size={14} /> : null}
            </Box>
            <Box fontSize="300" fontStyle="extra-bold" color="grey-90" style={{lineHeight: 1.2}}>
                {article.title}
            </Box>
            <Box fontSize="75" color="grey-50">
                {formatBlogPublishDate(article.publishDate)}
            </Box>
        </Link>
    );
}

/**
 * Render icon-only social links for a blog author.
 */
function BlogAuthorLinks({author}: {author: BlogAuthorById[keyof BlogAuthorById]}) {
    const logoStyle = {display: "block", height: 14, width: 14};
    const links = [
        {
            color: "var(--grey-90)",
            icon: <XLogo color="currentColor" style={logoStyle} />,
            label: `${author.name} on X`,
            url: author.socials.x,
        },
        {
            color: "#1185FE",
            icon: <BlueskyLogo style={logoStyle} />,
            label: `${author.name} on Bluesky`,
            url: author.socials.bluesky,
        },
        {
            color: "#0A66C2",
            icon: <LinkedInLogo style={logoStyle} />,
            label: `${author.name} on LinkedIn`,
            url: author.socials.linkedin,
        },
        {
            color: "var(--grey-60)",
            icon: <EnvelopeSimple size={17} weight="fill" />,
            label: `Email ${author.name}`,
            url: author.socials.email === null ? null : `mailto:${author.socials.email}`,
        },
    ].filter((link): link is Omit<typeof link, "url"> & {url: string} => link.url !== null);

    if (links.length === 0) return null;

    return (
        <Box display="flex" alignItems="center" gap="1" marginTop="1" flexWrap="wrap">
            {links.map(link => (
                <a
                    key={link.label}
                    href={link.url}
                    aria-label={link.label}
                    className="blogAuthorSocialLink"
                    rel={link.url.startsWith("mailto:") ? undefined : "noreferrer"}
                    target={link.url.startsWith("mailto:") ? undefined : "_blank"}
                    style={{
                        color: link.color,
                    }}
                    title={link.label}
                >
                    {link.icon}
                </a>
            ))}
        </Box>
    );
}
