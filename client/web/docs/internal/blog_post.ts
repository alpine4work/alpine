import {DocumentationImageData} from "~/client/web/docs/documentation_image_data.js";
import {BlogAuthorId} from "~/client/web/docs/internal/blog_author.js";

export type BlogPostListItem = {
    slug: string;
    title: string;
    summary: string;
    publishDate: string;
    authorId: BlogAuthorId;
    tags: Array<string>;
    previewImage: string | null;
    previewImageData: DocumentationImageData | null;
    previewImageAlt: string | null;
    modifiedDate: string;
};

export type BlogPostAdjacentArticle = {
    slug: string;
    title: string;
    summary: string;
    publishDate: string;
};

export type BlogPostPageData = BlogPostListItem & {
    mdxCode: string;
    previousArticle: BlogPostAdjacentArticle | null;
    nextArticle: BlogPostAdjacentArticle | null;
};

/**
 * Build the public URL for a blog post slug.
 */
export function createBlogPostUrl(slug: string): string {
    return `/blog/${slug}`;
}
