import {Link} from "@remix-run/react";
import {Info} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";
import {BlogAuthorById} from "~/client/web/docs/internal/blog_author.js";
import {BlogPostListItem, createBlogPostUrl} from "~/client/web/docs/internal/blog_post.js";
import {DocumentationHeader} from "~/client/web/docs/internal/documentation_header.js";
import {formatBlogPublishDate} from "~/client/web/docs/internal/format_blog_publish_date.js";
import {DocumentationSearchIndex} from "~/client/web/docs/search_documentation_entries.js";

const blogLayoutCss = `
.blogFeaturedGrid { grid-template-columns: minmax(0, 1fr); }
.blogFeaturedArticle {
    display: grid;
    grid-template-columns: minmax(260px, 0.44fr) minmax(0, 1fr);
}
.blogFeaturedImage {
    height: 100%;
    min-height: 230px;
}
.blogPostGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 980px) {
    .blogPostGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 680px) {
    .blogFeaturedArticle { grid-template-columns: minmax(0, 1fr); }
    .blogFeaturedImage { min-height: 0; }
    .blogFeaturedImagePlaceholder { aspect-ratio: 5 / 3; }
    .blogLatestArticlesHeading { display: none; }
    .blogPostGrid { grid-template-columns: minmax(0, 1fr); }
}
`;

/**
 * Render the public blog index with featured and standard post grids.
 */
export function BlogHomePage({
    posts,
    authors,
    searchIndex,
}: {
    posts: Array<BlogPostListItem>;
    authors: BlogAuthorById;
    searchIndex: DocumentationSearchIndex;
}) {
    const featuredPosts = posts.slice(0, 3);
    const remainingPosts = posts.slice(3);

    return (
        <Box
            minHeight="full"
            backgroundColor="grey-0"
            color="grey-90"
            style={{minHeight: "100svh"}}
        >
            <style dangerouslySetInnerHTML={{__html: blogLayoutCss}} />

            {/* Point AI agents and tools at the markdown version of this page. The
                `<link rel="alternate">` is the machine-standard signal (React hoists it
                into `<head>`); the hidden note is a plain-language fallback for anything
                reading the HTML body. Both are invisible to people. */}
            <link rel="alternate" type="text/markdown" href="/blog.md" />
            <Box as="div" hidden data-docs-markdown-hint>
                This blog is also available as markdown for AI agents and tools. Append `.md` to any
                blog URL to get the markdown version of a page. For this page, that is `/blog.md`.
                The blog home is available at `/blog.md`.
            </Box>

            <DocumentationHeader surface="blog" searchIndex={searchIndex} />
            <Box as="main" paddingX="6" paddingTop="12" paddingBottom="24">
                <Box marginX="center" style={{maxWidth: 1180}}>
                    <Box as="header" marginBottom="10">
                        <Box
                            as="h1"
                            fontSize="800"
                            fontStyle="extra-bold"
                            margin="0"
                            color="grey-90"
                        >
                            Alpine Blog
                        </Box>
                        <Box
                            fontSize="200"
                            color="grey-50"
                            marginTop="3"
                            style={{maxWidth: 900, lineHeight: 1.6}}
                        >
                            Notes on building collaborative work, AI-native teams, and the product
                            craft behind Alpine.
                        </Box>
                    </Box>

                    {featuredPosts.length > 0 ? (
                        <Box as="section" marginBottom="14">
                            <Box className="blogFeaturedGrid" display="grid" gap="5">
                                {featuredPosts.map(post => (
                                    <BlogPostCard
                                        key={post.slug}
                                        post={post}
                                        authors={authors}
                                        featured
                                    />
                                ))}
                            </Box>
                        </Box>
                    ) : null}

                    {remainingPosts.length > 0 ? (
                        <Box as="section">
                            <Box
                                className="blogLatestArticlesHeading"
                                as="h2"
                                fontSize="400"
                                fontStyle="extra-bold"
                                marginTop="0"
                                marginBottom="5"
                            >
                                Latest articles
                            </Box>
                            <Box className="blogPostGrid" display="grid" gap="5">
                                {remainingPosts.map(post => (
                                    <BlogPostCard key={post.slug} post={post} authors={authors} />
                                ))}
                            </Box>
                        </Box>
                    ) : null}
                </Box>
            </Box>
        </Box>
    );
}

/**
 * Render a single blog card, including the featured horizontal variant.
 */
function BlogPostCard({
    post,
    authors,
    featured = false,
}: {
    post: BlogPostListItem;
    authors: BlogAuthorById;
    featured?: boolean;
}) {
    const author = authors[post.authorId];

    return (
        <Link
            to={createBlogPostUrl(post.slug)}
            prefetch="intent"
            style={{color: "inherit", textDecoration: "none"}}
        >
            <Box
                className={featured ? "blogFeaturedArticle" : undefined}
                as="article"
                backgroundColor="grey-1"
                border="grey-5"
                borderRadius="2"
                overflow="hidden"
                height="full"
                style={{transition: "border-color 120ms ease, transform 120ms ease"}}
            >
                {post.previewImage !== null ? (
                    <img
                        className={featured ? "blogFeaturedImage" : undefined}
                        src={post.previewImage}
                        alt={post.previewImageAlt ?? ""}
                        style={{
                            aspectRatio: featured ? undefined : "5 / 3",
                            display: "block",
                            objectFit: "cover",
                            width: "100%",
                        }}
                    />
                ) : (
                    <Box
                        className={
                            featured ? "blogFeaturedImage blogFeaturedImagePlaceholder" : undefined
                        }
                        backgroundColor="grey-5"
                        color="grey-40"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        role="img"
                        aria-label="No image available"
                        style={{
                            aspectRatio: featured ? undefined : "5 / 3",
                            width: "100%",
                        }}
                    >
                        <Info size={32} aria-hidden />
                    </Box>
                )}
                <Box padding={featured ? "5" : "4"}>
                    <Box
                        as="h3"
                        fontSize={featured ? "400" : "300"}
                        fontStyle="extra-bold"
                        color="grey-90"
                        marginTop="0"
                        marginBottom="2"
                        style={{lineHeight: 1.15}}
                    >
                        {post.title}
                    </Box>
                    <Box fontSize="100" color="grey-60" style={{lineHeight: 1.6}}>
                        {post.summary}
                    </Box>
                    <Box display="flex" alignItems="center" gap="2" marginTop="4">
                        <img
                            src={author.avatarUrl}
                            alt=""
                            style={{borderRadius: "999px", height: 24, width: 24}}
                        />
                        <Box
                            as="span"
                            display="flex"
                            alignItems="center"
                            gap="2"
                            fontSize="75"
                            color="grey-60"
                        >
                            <Box as="span" fontStyle="semi-bold">
                                {author.name}
                            </Box>
                            <Box as="span">|</Box>
                            <time dateTime={post.publishDate}>
                                {formatBlogPublishDate(post.publishDate)}
                            </time>
                        </Box>
                    </Box>
                </Box>
            </Box>
        </Link>
    );
}

/**
 * Render shared blog post metadata for cards and individual post headers.
 */
export function BlogPostMeta({post, authors}: {post: BlogPostListItem; authors: BlogAuthorById}) {
    const author = authors[post.authorId];
    return (
        <Box
            display="flex"
            alignItems="center"
            gap="2"
            flexWrap="wrap"
            fontSize="75"
            color="grey-50"
        >
            <time dateTime={post.publishDate}>{formatBlogPublishDate(post.publishDate)}</time>
            <Box as="span">/</Box>
            <Box as="span">{author.name}</Box>
            {post.tags.slice(0, 2).map(tag => (
                <Box
                    key={tag}
                    as="span"
                    backgroundColor="grey-5"
                    color="grey-60"
                    borderRadius="full"
                    paddingX="2"
                    paddingY="0.5"
                >
                    {tag}
                </Box>
            ))}
        </Box>
    );
}
