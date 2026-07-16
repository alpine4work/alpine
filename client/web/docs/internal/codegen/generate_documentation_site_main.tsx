// Must run before importing docs components compiled with React Refresh.
import "~/server/helpers/node/register_noop_react_refresh.js";

import {compile} from "@mdx-js/mdx";
import fs from "fs/promises";
import {dirname, extname, join} from "path";
import remarkGfm from "remark-gfm";
import {parse} from "yaml";
import {createDocumentationApiPageUrl} from "~/client/web/docs/create_documentation_api_page_url.js";
import {documentationApiHomeUrl} from "~/client/web/docs/documentation_api_home_url.js";
import {
    DocumentationApiModel,
    createDocumentationApiOperationUrl,
} from "~/client/web/docs/documentation_api_model.js";
import type {
    DocumentationApiPageData,
    DocumentationApiPageLink,
    GeneratedDocumentationPageData,
} from "~/client/web/docs/documentation_mdx_page.js";
import {
    createDocumentationDocUrl,
    humanizeDocumentationName,
    parseDocumentationNavTree,
    parseDocumentationOrderPrefix,
} from "~/client/web/docs/documentation_nav.js";
import {GeneratedDocumentationApiNav} from "~/client/web/docs/generated_documentation.js";
import {BlogAuthorById, BlogAuthorId} from "~/client/web/docs/internal/blog_author.js";
import {
    BlogPostAdjacentArticle,
    BlogPostListItem,
    BlogPostPageData,
    createBlogPostUrl,
} from "~/client/web/docs/internal/blog_post.js";
import {extractDocumentationMdxToc} from "~/client/web/docs/internal/codegen/extract_documentation_mdx_toc.js";
import {parseDocumentationApiModel} from "~/client/web/docs/internal/codegen/parse_api_documentation_model.js";
import {
    DocumentationSearchEntry,
    buildDocumentationSearchIndex,
    getApiMethodSearchTags,
} from "~/client/web/docs/search_documentation_entries.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";

const runfilesPath = assertExists(process.env.RUNFILES);

const contentDirectoryPath = join(runfilesPath, "cyberworlds/client/web/docs/content");
const guidesDirectoryPath = join(contentDirectoryPath, "guides");
const apiDirectoryPath = join(contentDirectoryPath, "api");
const blogDirectoryPath = join(contentDirectoryPath, "blog");
const blogAuthorsPath = join(blogDirectoryPath, "blog_authors.json");
const specificationPath = join(
    runfilesPath,
    "cyberworlds/shared/api/specification/api_specification_final.yaml",
);

// The output TreeArtifact declared by `//client/web/docs:docs_generated`.
const outputDirectoryPath = "client/web/docs/generated";

type DocumentationContentSourceFile = {
    relativePath: string;
    name: string;
    order: number | null;
    frontmatter: {[key: string]: unknown};
    body: string;
};

type BlogPostSourceFile = {
    sourceName: string;
    frontmatter: {[key: string]: unknown};
    body: string;
};

type BlogPostContentData = BlogPostListItem & {
    mdxCode: string;
};

/**
 * Generate all browser-facing docs JSON artifacts from MDX and OpenAPI inputs.
 */
async function main() {
    await fs.rm(outputDirectoryPath, {recursive: true, force: true});

    // Read the expensive source inputs once, then fan out to independent writers so
    // Bazel sees one deterministic output tree for docs, API data, and search.
    const [model, guideFiles, apiFiles, blogAuthors, blogFiles] = await runAllPromises([
        fs.readFile(specificationPath, "utf8").then(parseDocumentationApiModel),
        readContentFiles(guidesDirectoryPath, ""),
        readContentFiles(apiDirectoryPath, "").then(orderApiContentFiles),
        readBlogAuthors(),
        readBlogPostFiles(),
    ]);
    const blogPosts = await runAllPromises(blogFiles.map(createBlogPostPage));
    blogPosts.sort(compareBlogPosts);
    assertUniqueBlogPostSlugs(blogPosts);

    await runAllPromises([
        writeGuideArtifacts(guideFiles),
        writeApiArtifacts(model, apiFiles),
        writeBlogArtifacts(blogAuthors, blogPosts),
        writeSearchMetadataArtifact({model, guideFiles, apiFiles, blogPosts}),
    ]);
}

/**
 * Write generated guide navigation and compiled guide pages.
 */
async function writeGuideArtifacts(files: Array<DocumentationContentSourceFile>): Promise<void> {
    const navTree = parseDocumentationNavTree(
        files.map(file => ({relativePath: file.relativePath, title: navTitleForFile(file)})),
    );
    await writeJsonFile("guides_nav.json", navTree);

    const slugByRelativePath = new Map(
        Object.entries(navTree.filePathBySlug).map(([slug, relativePath]) => [relativePath, slug]),
    );
    await runAllPromises(
        files.map(async file => {
            const slug = slugByRelativePath.get(file.relativePath);
            if (slug === undefined) return;

            const page: GeneratedDocumentationPageData = {
                slug,
                title: titleForFile(file),
                description: descriptionForFile(file),
                mdxCode: await compileMdxContent(file.body),
                toc: extractDocumentationMdxToc(file.body),
            };
            await writePageJson(createDocumentationDocUrl(slug), page);
        }),
    );
}

/**
 * Write generated API MDX pages plus the API model and navigation JSON.
 */
async function writeApiArtifacts(
    model: DocumentationApiModel,
    apiFiles: Array<DocumentationContentSourceFile>,
): Promise<void> {
    // API support pages are authored as MDX, but endpoint and schema pages come
    // directly from `api_model.json`; the nav ties both sources together.
    const pages = await runAllPromises(
        apiFiles.map(async (file, index): Promise<DocumentationApiPageData> => {
            const isHome = index === 0;
            return {
                name: file.name,
                title: titleForFile(file),
                description: descriptionForFile(file),
                url: isHome ? documentationApiHomeUrl : createDocumentationApiPageUrl(file.name),
                isHome,
                mdxCode: await compileMdxContent(file.body),
                toc: extractDocumentationMdxToc(file.body),
            };
        }),
    );
    const pageLinks: Array<DocumentationApiPageLink> = pages.map(page => ({
        name: page.name,
        title: page.title,
        url: page.url,
        isHome: page.isHome,
    }));
    const apiNav: GeneratedDocumentationApiNav = {
        pages: pageLinks,
        groups: model.groups,
        schemaNames: model.schemaNames,
    };

    await runAllPromises([
        writeJsonFile("api_model.json", model),
        writeJsonFile("api_nav.json", apiNav),
        ...pages.map(page => writePageJson(page.url, page)),
    ]);
}

/**
 * Write generated blog authors, list data, and compiled post pages.
 */
async function writeBlogArtifacts(
    authors: BlogAuthorById,
    posts: Array<BlogPostContentData>,
): Promise<void> {
    const postPages = posts.map((post, index) =>
        toBlogPostPageData({
            post,
            previousArticle: posts[index + 1] ?? null,
            nextArticle: posts[index - 1] ?? null,
        }),
    );

    await runAllPromises([
        writeJsonFile("blog/blog_authors.json", authors),
        writeJsonFile(
            "blog/posts.json",
            posts.map(post => toBlogPostListItem(post)),
        ),
        ...postPages.map(post => writePageJson(createBlogPostUrl(post.slug), post)),
    ]);
}

/**
 * Write the prebuilt Fuse search index used by the docs search dialog.
 */
async function writeSearchMetadataArtifact({
    model,
    guideFiles,
    apiFiles,
    blogPosts,
}: {
    model: DocumentationApiModel;
    guideFiles: Array<DocumentationContentSourceFile>;
    apiFiles: Array<DocumentationContentSourceFile>;
    blogPosts: Array<BlogPostContentData>;
}): Promise<void> {
    const navTree = parseDocumentationNavTree(
        guideFiles.map(file => ({relativePath: file.relativePath, title: navTitleForFile(file)})),
    );
    const guideFileByRelativePath = new Map(
        guideFiles.map(file => [file.relativePath, file] as const),
    );

    const entries: Array<DocumentationSearchEntry> = [];
    for (const [slug, relativePath] of Object.entries(navTree.filePathBySlug)) {
        const file = guideFileByRelativePath.get(relativePath);
        if (file === undefined) continue;

        const description = descriptionForFile(file);
        entries.push({
            type: "page",
            title: navTitleForFile(file),
            url: createDocumentationDocUrl(slug),
            tags: tagsForFile(file),
            ...(description !== null ? {description} : {}),
        });
    }

    for (const [index, file] of apiFiles.entries()) {
        const description = descriptionForFile(file);
        entries.push({
            type: "api",
            title: titleForFile(file),
            url: index === 0 ? documentationApiHomeUrl : createDocumentationApiPageUrl(file.name),
            tags: tagsForFile(file),
            ...(description !== null ? {description} : {}),
        });
    }

    for (const post of blogPosts) {
        entries.push(toBlogSearchEntry(post));
    }

    for (const operation of Object.values(model.operationsBySlug)) {
        entries.push({
            type: "api",
            title: operation.title,
            url: createDocumentationApiOperationUrl(operation.slug),
            tags: [...getApiMethodSearchTags(operation.method), operation.group.toLowerCase()],
            description: operation.description ?? `${operation.method} ${operation.path}`,
        });
    }

    await writeJsonFile("search_metadata.json", buildDocumentationSearchIndex(entries));
}

/**
 * Compile MDX source into function-body code that Remix can evaluate at runtime.
 */
async function compileMdxContent(body: string): Promise<string> {
    const compiled = await compile(body, {
        outputFormat: "function-body",
        development: false,
        remarkPlugins: [remarkGfm],
    });
    return String(compiled);
}

/**
 * Write one generated page JSON file at the file path derived from its docs URL.
 */
async function writePageJson(url: string, value: unknown): Promise<void> {
    const filePath = join(outputDirectoryPath, "pages", `${url.replace(/^\//, "")}.json`);
    await fs.mkdir(dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Write a top-level generated JSON artifact.
 */
async function writeJsonFile(path: string, value: unknown): Promise<void> {
    await fs.mkdir(dirname(join(outputDirectoryPath, path)), {recursive: true});
    await fs.writeFile(join(outputDirectoryPath, path), `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Sort API support pages by numeric filename prefix and then by name.
 */
function orderApiContentFiles(
    files: Array<DocumentationContentSourceFile>,
): Array<DocumentationContentSourceFile> {
    return [...files].sort((file1, file2) =>
        file1.order !== file2.order
            ? (file1.order ?? Number.MAX_SAFE_INTEGER) - (file2.order ?? Number.MAX_SAFE_INTEGER)
            : file1.name.localeCompare(file2.name),
    );
}

/**
 * Recursively read MDX content files and extract ordering metadata.
 */
async function readContentFiles(
    directoryPath: string,
    relativeDirectory: string,
): Promise<Array<DocumentationContentSourceFile>> {
    const entries = await fs.readdir(directoryPath, {withFileTypes: true});
    const files: Array<DocumentationContentSourceFile> = [];

    // Preserve nested guide directory shape in `relativePath`; the nav parser turns
    // that into slugs and groups after all files have been discovered.
    for (const entry of entries) {
        const relativePath =
            relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;

        if (entry.isDirectory()) {
            files.push(...(await readContentFiles(join(directoryPath, entry.name), relativePath)));
        } else if (entry.name.endsWith(".mdx")) {
            const source = await fs.readFile(join(directoryPath, entry.name), "utf8");
            const {frontmatter, body} = splitDocumentationFrontmatter(source);
            const {name, order} = parseDocumentationOrderPrefix(entry.name.replace(/\.mdx$/, ""));
            files.push({relativePath, name, order, frontmatter, body});
        }
    }

    return files;
}

/**
 * Read and validate blog author configuration.
 */
async function readBlogAuthors(): Promise<BlogAuthorById> {
    const value: unknown = JSON.parse(await fs.readFile(blogAuthorsPath, "utf8"));
    assert(isPlainObject(value), "Expected blog authors JSON object");

    const authors: Partial<BlogAuthorById> = {};
    for (const id of ["josh", "caleb", "rachel", "ian"] as const) {
        const author = value[id];
        assert(isPlainObject(author), `Expected blog author ${id}`);
        assert(typeof author.name === "string", `Expected blog author ${id} name`);
        assert(isPlainObject(author.socials), `Expected blog author ${id} socials`);

        authors[id] = {
            id,
            name: author.name,
            socials: {
                x: nullableString(author.socials.x),
                bluesky: nullableString(author.socials.bluesky),
                linkedin: nullableString(author.socials.linkedin),
                email: nullableString(author.socials.email),
            },
            avatarUrl: `/blog/authors/${id}.avif`,
        };
    }

    return authors as BlogAuthorById;
}

/**
 * Read authored blog posts from Markdown or MDX files.
 */
async function readBlogPostFiles(): Promise<Array<BlogPostSourceFile>> {
    const entries = await fs.readdir(blogDirectoryPath, {withFileTypes: true});
    const files: Array<BlogPostSourceFile> = [];

    for (const entry of entries) {
        const extension = extname(entry.name);
        if (extension !== ".md" && extension !== ".mdx") continue;

        const source = await fs.readFile(join(blogDirectoryPath, entry.name), "utf8");
        const {frontmatter, body} = splitDocumentationFrontmatter(source);
        files.push({
            sourceName: entry.name,
            frontmatter,
            body,
        });
    }

    return files;
}

/**
 * Compile a blog post from frontmatter and MDX body.
 */
async function createBlogPostPage(file: BlogPostSourceFile): Promise<BlogPostContentData> {
    const slug = slugForFile(file);
    const authorId = stringFrontmatter(file, "author");
    assert(isBlogAuthorId(authorId), `Expected valid author for ${file.sourceName}`);

    return {
        slug,
        title: stringFrontmatter(file, "title") ?? humanizeBlogSlug(slug),
        summary: stringFrontmatter(file, "summary") ?? "",
        publishDate: publishDateForFile(file),
        authorId,
        tags: tagsForFile(file),
        previewImage: stringFrontmatter(file, "previewImage"),
        previewImageAlt: stringFrontmatter(file, "previewImageAlt"),
        mdxCode: await compileMdxContent(file.body),
    };
}

/**
 * Resolve the display title for a content file.
 */
function titleForFile(file: DocumentationContentSourceFile): string {
    return typeof file.frontmatter.title === "string"
        ? file.frontmatter.title
        : humanizeDocumentationName(file.name);
}

/**
 * Resolve the navigation title for a content file.
 */
function navTitleForFile(file: DocumentationContentSourceFile): string {
    if (typeof file.frontmatter.navTitle === "string") return file.frontmatter.navTitle;
    return titleForFile(file);
}

/**
 * Resolve the optional page description from frontmatter.
 */
function descriptionForFile(file: DocumentationContentSourceFile): string | null {
    return typeof file.frontmatter.description === "string" ? file.frontmatter.description : null;
}

/**
 * Resolve comma-separated or array frontmatter tags for search metadata.
 */
function tagsForFile(file: {frontmatter: {[key: string]: unknown}}): Array<string> {
    const {tags} = file.frontmatter;
    if (Array.isArray(tags)) return tags.filter((tag): tag is string => typeof tag === "string");
    if (typeof tags !== "string") return [];
    return tags
        .split(",")
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
}

/**
 * Read and validate a blog post publish date from frontmatter.
 */
function publishDateForFile(file: BlogPostSourceFile): string {
    const publishDate = stringFrontmatter(file, "publishDate");
    assert(
        publishDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(publishDate),
        `Expected publishDate YYYY-MM-DD for ${file.sourceName}`,
    );
    return publishDate;
}

/**
 * Read and validate the stable public slug from blog post frontmatter.
 */
function slugForFile(file: BlogPostSourceFile): string {
    const slug = stringFrontmatter(file, "slug");
    assert(slug !== null, `Expected slug frontmatter for ${file.sourceName}`);
    assert(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug),
        `Expected lowercase kebab-case slug for ${file.sourceName}`,
    );
    return slug;
}

/**
 * Convert full blog post content into the compact index card payload.
 */
function toBlogPostListItem(post: BlogPostContentData): BlogPostListItem {
    return {
        slug: post.slug,
        title: post.title,
        summary: post.summary,
        publishDate: post.publishDate,
        authorId: post.authorId,
        tags: post.tags,
        previewImage: post.previewImage,
        previewImageAlt: post.previewImageAlt,
    };
}

/**
 * Build the generated page payload with codegened adjacent article links.
 */
function toBlogPostPageData({
    post,
    previousArticle,
    nextArticle,
}: {
    post: BlogPostContentData;
    previousArticle: BlogPostContentData | null;
    nextArticle: BlogPostContentData | null;
}): BlogPostPageData {
    return {
        ...post,
        previousArticle: toBlogPostAdjacentArticle(previousArticle),
        nextArticle: toBlogPostAdjacentArticle(nextArticle),
    };
}

/**
 * Convert a full blog post into the compact previous/next article payload.
 */
function toBlogPostAdjacentArticle(
    post: BlogPostContentData | null,
): BlogPostAdjacentArticle | null {
    if (post === null) return null;

    return {
        slug: post.slug,
        title: post.title,
        summary: post.summary,
        publishDate: post.publishDate,
    };
}

/**
 * Convert a blog post into a shared documentation search record.
 */
function toBlogSearchEntry(post: BlogPostContentData): DocumentationSearchEntry {
    return {
        type: "blog",
        title: post.title,
        url: createBlogPostUrl(post.slug),
        tags: post.tags,
        description: post.summary,
    };
}

/**
 * Sort blog posts by newest publish date, then slug for deterministic ties.
 */
function compareBlogPosts(post1: BlogPostContentData, post2: BlogPostContentData): number {
    const dateOrder = post2.publishDate.localeCompare(post1.publishDate);
    return dateOrder !== 0 ? dateOrder : post1.slug.localeCompare(post2.slug);
}

/**
 * Assert that no two generated blog posts claim the same public slug.
 */
function assertUniqueBlogPostSlugs(posts: Array<BlogPostContentData>): void {
    const slugs = new Set<string>();
    for (const post of posts) {
        assert(!slugs.has(post.slug), `Duplicate blog post slug: ${post.slug}`);
        slugs.add(post.slug);
    }
}

/**
 * Read a non-empty string frontmatter value.
 */
function stringFrontmatter(
    file: {frontmatter: {[key: string]: unknown}},
    key: string,
): string | null {
    const value = file.frontmatter[key];
    return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Normalize optional string JSON values into nullable strings.
 */
function nullableString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Check whether a frontmatter author value is one of the configured author IDs.
 */
function isBlogAuthorId(value: unknown): value is BlogAuthorId {
    return value === "josh" || value === "caleb" || value === "rachel" || value === "ian";
}

/**
 * Derive a readable title fallback from a blog slug.
 */
function humanizeBlogSlug(slug: string): string {
    return slug
        .split("-")
        .filter(word => word.length > 0)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

/**
 * Split YAML frontmatter from the body of a docs MDX source file.
 */
function splitDocumentationFrontmatter(source: string): {
    frontmatter: {[key: string]: unknown};
    body: string;
} {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
    if (match === null) return {frontmatter: {}, body: source};

    // Invalid or scalar YAML frontmatter is treated as empty metadata so a bad
    // authoring value cannot break docs generation for the whole package.
    const frontmatterSource = assertExists(match[1]);
    const parsed: unknown = parse(frontmatterSource);
    return {
        frontmatter: isPlainObject(parsed) ? parsed : {},
        body: source.slice(match[0].length),
    };
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
