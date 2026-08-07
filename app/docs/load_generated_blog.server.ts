import fs from "fs/promises";
import {join, normalize} from "path";
import {
    BlogAuthorById,
    BlogPostAdjacentArticle,
    BlogPostListItem,
    BlogPostPageData,
    createBlogPostUrl,
} from "~/client/web/docs/blog.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {
    DocumentationSearchIndex,
    parseDocumentationSearchIndex,
} from "~/shared/docs/search_documentation_entries.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.open_source.js";

const generatedDocumentationDirectoryPath = join(
    runfilesPath,
    "cyberworlds/app/docs/codegen/generated",
);
const generatedBlogDirectoryPath = join(
    runfilesPath,
    "cyberworlds/app/docs/codegen/generated/blog",
);
const generatedBlogPagesDirectoryPath = join(
    runfilesPath,
    "cyberworlds/app/docs/codegen/generated/pages",
);

/**
 * Load the generated blog index data and author records for the home page.
 */
export async function loadGeneratedBlogHomePage(): Promise<{
    authors: BlogAuthorById;
    posts: Array<BlogPostListItem>;
    searchIndex: DocumentationSearchIndex;
}> {
    const [authors, posts, searchIndex] = await runAllPromises([
        loadGeneratedBlogAuthors(),
        readGeneratedJson("posts.json"),
        loadGeneratedDocumentationSearchIndex(),
    ]);
    assert(isBlogPostList(posts), "Expected generated blog posts JSON");
    return {authors, posts, searchIndex};
}

/**
 * Load one generated blog post by slug, returning `null` for unknown posts.
 */
export async function loadGeneratedBlogPost(slug: string): Promise<{
    authors: BlogAuthorById;
    post: BlogPostPageData;
    searchIndex: DocumentationSearchIndex;
} | null> {
    const [authors, page, searchIndex] = await runAllPromises([
        loadGeneratedBlogAuthors(),
        readGeneratedPageJson(createBlogPostUrl(slug)),
        loadGeneratedDocumentationSearchIndex(),
    ]);
    if (!isBlogPostPageData(page)) return null;
    return {authors, post: page, searchIndex};
}

/**
 * Load generated blog authors keyed by their stable author IDs.
 */
async function loadGeneratedBlogAuthors(): Promise<BlogAuthorById> {
    const json = await readGeneratedJson("blog_authors.json");
    assert(isPlainObject(json), "Expected generated blog authors JSON");
    return json as BlogAuthorById;
}

/**
 * Load the shared generated docs/blog/API search index.
 */
async function loadGeneratedDocumentationSearchIndex(): Promise<DocumentationSearchIndex> {
    return parseDocumentationSearchIndex(await readGeneratedRootJson("search_metadata.json"));
}

/**
 * Read a generated JSON artifact from the shared docs output directory.
 */
async function readGeneratedRootJson(path: string): Promise<unknown> {
    return JSON.parse(await fs.readFile(join(generatedDocumentationDirectoryPath, path), "utf8"));
}

/**
 * Read a generated blog JSON artifact from the blog output directory.
 */
async function readGeneratedJson(path: string): Promise<unknown> {
    return JSON.parse(await fs.readFile(join(generatedBlogDirectoryPath, path), "utf8"));
}

/**
 * Read a generated page JSON artifact for a public blog URL.
 */
async function readGeneratedPageJson(url: string): Promise<unknown> {
    const filePath = generatedPageFilePath(url);
    if (filePath === null) return null;

    try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
        if (isMissingFileError(error)) return null;
        throw error;
    }
}

/**
 * Resolve a public blog URL to its generated page JSON file inside runfiles.
 */
function generatedPageFilePath(url: string): string | null {
    const decoded = decodeGeneratedBlogUrl(url);
    if (decoded === null) return null;

    const normalized = normalize(
        join(generatedBlogPagesDirectoryPath, `${decoded.replace(/^\/+/, "")}.json`),
    );
    if (
        normalized !== generatedBlogPagesDirectoryPath &&
        !normalized.startsWith(`${generatedBlogPagesDirectoryPath}/`)
    ) {
        return null;
    }
    return normalized;
}

/**
 * Decode a blog URL segment, treating malformed escapes as a missing page.
 */
function decodeGeneratedBlogUrl(url: string): string | null {
    try {
        return decodeURIComponent(url);
    } catch {
        return null;
    }
}

/**
 * Identify expected filesystem misses for optional generated pages.
 */
function isMissingFileError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
    );
}

/**
 * Check that generated JSON is a list of blog cards.
 */
function isBlogPostList(value: unknown): value is Array<BlogPostListItem> {
    return Array.isArray(value) && value.every(isBlogPostListItem);
}

/**
 * Check that generated JSON has the full blog post page shape.
 */
function isBlogPostPageData(value: unknown): value is BlogPostPageData {
    if (!isBlogPostListItem(value) || !isPlainObject(value)) return false;
    const page = value as {
        mdxCode?: unknown;
        previousArticle?: unknown;
        nextArticle?: unknown;
    };
    return (
        typeof page.mdxCode === "string" &&
        isNullableBlogPostAdjacentArticle(page.previousArticle) &&
        isNullableBlogPostAdjacentArticle(page.nextArticle)
    );
}

/**
 * Check that generated JSON has the shared blog list item fields.
 */
function isBlogPostListItem(value: unknown): value is BlogPostListItem {
    return (
        isPlainObject(value) &&
        typeof value.slug === "string" &&
        typeof value.title === "string" &&
        typeof value.summary === "string" &&
        typeof value.publishDate === "string" &&
        typeof value.modifiedDate === "string" &&
        (value.authorId === "josh" ||
            value.authorId === "caleb" ||
            value.authorId === "rachel" ||
            value.authorId === "ian") &&
        Array.isArray(value.tags) &&
        value.tags.every(tag => typeof tag === "string") &&
        (typeof value.previewImage === "string" || value.previewImage === null) &&
        (isDocumentationImageData(value.previewImageData) || value.previewImageData === null) &&
        (typeof value.previewImageAlt === "string" || value.previewImageAlt === null)
    );
}

/** Check generated intrinsic dimensions and responsive image candidates. */
function isDocumentationImageData(value: unknown): boolean {
    return (
        isPlainObject(value) &&
        typeof value.src === "string" &&
        typeof value.srcSet === "string" &&
        typeof value.width === "number" &&
        typeof value.height === "number"
    );
}

/**
 * Check the nullable previous/next article payload generated for a post.
 */
function isNullableBlogPostAdjacentArticle(
    value: unknown,
): value is BlogPostAdjacentArticle | null {
    return value === null || isBlogPostAdjacentArticle(value);
}

/**
 * Check that generated JSON has the compact adjacent article shape.
 */
function isBlogPostAdjacentArticle(value: unknown): value is BlogPostAdjacentArticle {
    return (
        isPlainObject(value) &&
        typeof value.slug === "string" &&
        typeof value.title === "string" &&
        typeof value.summary === "string" &&
        typeof value.publishDate === "string"
    );
}
