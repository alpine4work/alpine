// Must run before importing anything that pulls in a component (the markdown
// variants live in `.tsx` files that carry the SWC react-refresh transform).
import "~/server/helpers/node/register_noop_react_refresh.js";

import {compile} from "@mdx-js/mdx";
import fs from "fs/promises";
import {dirname, extname, join} from "path";
import remarkGfm from "remark-gfm";
import {parse} from "yaml";
import {renderDocumentationMdxToMarkdown} from "~/app/docs/codegen/markdown/render_documentation_mdx_to_markdown.js";
import {parseDocumentationApiModel} from "~/app/docs/codegen/parse_api_documentation_model.js";
import {
    createDocumentationMdxMarkdownComponents,
    documentationMdxMarkdownComponents,
} from "~/client/web/docs/documentation_mdx_components.js";
import {
    renderApiOperationToMarkdown,
    renderDocumentationApiSchemaToMarkdown,
} from "~/client/web/docs/render_api_documentation_to_markdown.js";
import {createBlogPostUrl} from "~/shared/docs/blog_post.js";
import {buildDocumentationApiCodeSamples} from "~/shared/docs/build_api_documentation_code_samples.js";
import {createDocumentationApiPageUrl} from "~/shared/docs/create_documentation_api_page_url.js";
import {documentationApiHomeUrl} from "~/shared/docs/documentation_api_home_url.js";
import {
    createDocumentationApiOperationUrl,
    createDocumentationApiSchemaUrl,
} from "~/shared/docs/documentation_api_model.js";
import {
    createDocumentationDocUrl,
    humanizeDocumentationName,
    parseDocumentationNavTree,
    parseDocumentationOrderPrefix,
} from "~/shared/docs/documentation_nav.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.open_source.js";

// The markdown content and OpenAPI spec are read from this tool's runfiles.
const runfilesPath = assertExists(process.env.RUNFILES);
const contentDirectoryPath = join(runfilesPath, "cyberworlds/app/docs/codegen/content");
const guidesDirectoryPath = join(contentDirectoryPath, "guides");
const apiDirectoryPath = join(contentDirectoryPath, "api");
const blogDirectoryPath = join(contentDirectoryPath, "blog");
const blogAuthorsPath = join(blogDirectoryPath, "blog_authors.json");
const specificationPath = join(
    runfilesPath,
    "cyberworlds/shared/api/specification/api_specification_final.yaml",
);

// The output TreeArtifact, declared as `out_dirs` in this package's `BUILD`. Each
// page is written to `<url>.md`, so the `.md` route can map a request path
// straight to a file (`/docs/guides/tasks.md` → `pages/docs/guides/tasks.md`).
const outputDirectory = "app/docs/codegen/pages";

type DocumentationMarkdownPage = {url: string; markdown: string};

/**
 * Generate markdown mirrors for every docs page that agents may read.
 */
async function main() {
    const pages = [
        ...(await buildDocumentationMdxPages()),
        ...(await buildApiPages()),
        ...(await buildBlogPages()),
    ];
    await runAllPromises(pages.map(writeMarkdownPage));
}

/**
 * Write one generated markdown file at the path derived from its docs URL.
 */
async function writeMarkdownPage(page: DocumentationMarkdownPage): Promise<void> {
    const filePath = join(outputDirectory, `${page.url.replace(/^\//, "")}.md`);
    await fs.mkdir(dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, `${page.markdown.trim()}\n`);
}

/**
 * Build markdown mirrors for generic docs MDX pages.
 */
async function buildDocumentationMdxPages(): Promise<Array<DocumentationMarkdownPage>> {
    const files = await readContentFiles(guidesDirectoryPath, "");
    const {filePathBySlug} = parseDocumentationNavTree(
        files.map(file => ({relativePath: file.relativePath, title: navTitleForFile(file)})),
    );
    const slugByRelativePath = new Map(
        Object.entries(filePathBySlug).map(([slug, relativePath]) => [relativePath, slug]),
    );

    const pages = await runAllPromises(
        files.map(async file => {
            const slug = slugByRelativePath.get(file.relativePath);
            if (slug === undefined) return null;

            const markdown = await renderContentFileMarkdown(
                file,
                documentationMdxMarkdownComponents,
            );
            return {url: createDocumentationDocUrl(slug), markdown};
        }),
    );

    return pages.filter((page): page is DocumentationMarkdownPage => page !== null);
}

/**
 * Build markdown mirrors for API support pages, operations, and schemas.
 */
async function buildApiPages(): Promise<Array<DocumentationMarkdownPage>> {
    const model = parseDocumentationApiModel(await fs.readFile(specificationPath, "utf8"));
    const markdownComponents = createDocumentationMdxMarkdownComponents(model);

    // API support MDX uses the same custom component framework as browser pages, but
    // renders through `.documentationComponent.markdown` variants.
    const apiFiles = (await readContentFiles(apiDirectoryPath, "")).sort((file1, file2) =>
        file1.relativePath.localeCompare(file2.relativePath),
    );
    const pages: Array<DocumentationMarkdownPage> = await runAllPromises(
        apiFiles.map(async (file, index) => {
            const markdown = await renderContentFileMarkdown(file, markdownComponents);
            const url =
                index === 0 ? documentationApiHomeUrl : createDocumentationApiPageUrl(file.name);
            return {url, markdown};
        }),
    );

    // Operation and schema pages are generated from the parsed OpenAPI model so agents
    // see the same content as the interactive API reference.
    for (const group of model.groups) {
        for (const reference of group.operations) {
            const operation = assertExists(model.operationsBySlug[reference.slug]);
            pages.push({
                url: createDocumentationApiOperationUrl(operation.slug),
                markdown: renderApiOperationToMarkdown(
                    model,
                    operation,
                    buildDocumentationApiCodeSamples(model, operation),
                ),
            });
        }
    }

    for (const name of model.schemaNames) {
        pages.push({
            url: createDocumentationApiSchemaUrl(name),
            markdown: renderDocumentationApiSchemaToMarkdown(model, name),
        });
    }

    return pages;
}

/**
 * Build markdown mirrors for the blog index and individual blog posts.
 */
async function buildBlogPages(): Promise<Array<DocumentationMarkdownPage>> {
    const [authors, postFiles] = await runAllPromises([readBlogAuthors(), readBlogPostFiles()]);
    const posts = await runAllPromises(
        postFiles.map(file => createBlogMarkdownPost({file, authors})),
    );
    posts.sort(compareBlogMarkdownPosts);
    assertUniqueBlogPostSlugs(posts);

    return [
        {url: "/blog", markdown: renderBlogIndexMarkdown(posts)},
        ...posts.map((post, index) => ({
            url: createBlogPostUrl(post.slug),
            markdown: renderBlogPostMarkdown({
                post,
                previousPost: posts[index + 1] ?? null,
                nextPost: posts[index - 1] ?? null,
            }),
        })),
    ];
}

type DocumentationContentSourceFile = {
    relativePath: string;
    name: string;
    frontmatter: {[key: string]: unknown};
    body: string;
};

type BlogMarkdownPostSourceFile = {
    sourceName: string;
    frontmatter: {[key: string]: unknown};
    body: string;
};

type BlogMarkdownPost = {
    slug: string;
    title: string;
    summary: string;
    publishDate: string;
    author: BlogMarkdownAuthor | null;
    tags: Array<string>;
    body: string;
};

type BlogMarkdownAuthor = {
    name: string;
    socials: {
        x: string | null;
        bluesky: string | null;
        linkedin: string | null;
        email: string | null;
    };
};

type BlogMarkdownAuthors = Map<string, BlogMarkdownAuthor>;

/**
 * Compile a content file's MDX and render it with markdown component variants.
 */
async function renderContentFileMarkdown(
    file: DocumentationContentSourceFile,
    markdownComponents: Parameters<typeof renderDocumentationMdxToMarkdown>[1],
): Promise<string> {
    const compiled = await compile(file.body, {
        outputFormat: "function-body",
        development: false,
        remarkPlugins: [remarkGfm],
    });
    const title =
        typeof file.frontmatter.title === "string"
            ? file.frontmatter.title
            : humanizeDocumentationName(file.name);
    const description =
        typeof file.frontmatter.description === "string" ? file.frontmatter.description : "";

    return [
        `# ${title}`,
        ...(description.length > 0 ? [description] : []),
        renderDocumentationMdxToMarkdown(String(compiled), markdownComponents),
    ].join("\n\n");
}

/**
 * Recursively read MDX source files used by docs markdown generation.
 */
async function readContentFiles(
    directoryPath: string,
    relativeDirectory: string,
): Promise<Array<DocumentationContentSourceFile>> {
    const entries = await fs.readdir(directoryPath, {withFileTypes: true});
    const files: Array<DocumentationContentSourceFile> = [];

    // Keep nested guide paths stable so markdown output mirrors the same URL layout as
    // the generated browser docs.
    for (const entry of entries) {
        const relativePath =
            relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;

        if (entry.isDirectory()) {
            files.push(...(await readContentFiles(join(directoryPath, entry.name), relativePath)));
        } else if (entry.name.endsWith(".mdx")) {
            const source = await fs.readFile(join(directoryPath, entry.name), "utf8");
            const {frontmatter, body} = splitDocumentationFrontmatter(source);
            const {name} = parseDocumentationOrderPrefix(entry.name.replace(/\.mdx$/, ""));
            files.push({relativePath, name, frontmatter, body});
        }
    }

    return files;
}

/**
 * Read authored blog Markdown and MDX files directly under `content/blog`.
 */
async function readBlogPostFiles(): Promise<Array<BlogMarkdownPostSourceFile>> {
    const entries = await fs.readdir(blogDirectoryPath, {withFileTypes: true});
    const files: Array<BlogMarkdownPostSourceFile> = [];

    for (const entry of entries) {
        const extension = extname(entry.name);
        if (extension !== ".md" && extension !== ".mdx") continue;

        const source = await fs.readFile(join(blogDirectoryPath, entry.name), "utf8");
        const {frontmatter, body} = splitDocumentationFrontmatter(source);
        files.push({sourceName: entry.name, frontmatter, body});
    }

    return files;
}

/**
 * Read blog author data used by markdown-rendered posts.
 */
async function readBlogAuthors(): Promise<BlogMarkdownAuthors> {
    const value: unknown = JSON.parse(await fs.readFile(blogAuthorsPath, "utf8"));
    assert(isPlainObject(value), "Expected blog authors JSON object");

    const authors: BlogMarkdownAuthors = new Map();
    for (const [id, author] of Object.entries(value)) {
        assert(isPlainObject(author), `Expected blog author ${id}`);
        assert(typeof author.name === "string", `Expected blog author ${id} name`);
        assert(isPlainObject(author.socials), `Expected blog author ${id} socials`);

        authors.set(id, {
            name: author.name,
            socials: {
                x: nullableString(author.socials.x),
                bluesky: nullableString(author.socials.bluesky),
                linkedin: nullableString(author.socials.linkedin),
                email: nullableString(author.socials.email),
            },
        });
    }

    return authors;
}

/**
 * Resolve the navigation title for slug generation.
 */
function navTitleForFile(file: DocumentationContentSourceFile): string {
    if (typeof file.frontmatter.navTitle === "string") return file.frontmatter.navTitle;
    if (typeof file.frontmatter.title === "string") return file.frontmatter.title;
    return humanizeDocumentationName(file.name);
}

/**
 * Build the markdown-side representation of one blog post.
 */
async function createBlogMarkdownPost({
    file,
    authors,
}: {
    file: BlogMarkdownPostSourceFile;
    authors: BlogMarkdownAuthors;
}): Promise<BlogMarkdownPost> {
    const authorId = stringFrontmatter(file, "author");

    return {
        slug: slugForBlogPostFile(file),
        title: stringFrontmatter(file, "title") ?? humanizeDocumentationName(file.sourceName),
        summary: stringFrontmatter(file, "summary") ?? "",
        publishDate: publishDateForBlogPostFile(file),
        author: authorId === null ? null : (authors.get(authorId) ?? null),
        tags: tagsForFile(file),
        body: await renderBlogPostBodyMarkdown(file.body),
    };
}

/**
 * Render a blog MDX body through the documentation markdown component map.
 */
async function renderBlogPostBodyMarkdown(body: string): Promise<string> {
    const compiled = await compile(body, {
        outputFormat: "function-body",
        development: false,
        remarkPlugins: [remarkGfm],
    });
    return renderDocumentationMdxToMarkdown(String(compiled), documentationMdxMarkdownComponents);
}

/**
 * Render the blog index markdown mirror.
 */
function renderBlogIndexMarkdown(posts: Array<BlogMarkdownPost>): string {
    return [
        "# Alpine Blog",
        "Notes on building collaborative work, AI-native teams, and the product craft behind Alpine.",
        ...posts.map(post =>
            [
                `## [${post.title}](${createBlogPostUrl(post.slug)}.md)`,
                `${post.publishDate}${post.author !== null ? ` · ${post.author.name}` : ""}`,
                post.summary,
            ]
                .filter(part => part.length > 0)
                .join("\n\n"),
        ),
    ].join("\n\n");
}

/**
 * Render an individual blog post markdown mirror.
 */
function renderBlogPostMarkdown({
    post,
    previousPost,
    nextPost,
}: {
    post: BlogMarkdownPost;
    previousPost: BlogMarkdownPost | null;
    nextPost: BlogMarkdownPost | null;
}): string {
    return [
        `# ${post.title}`,
        renderBlogPostMetadataMarkdown(post),
        post.body,
        renderBlogPostLinksMarkdown({previousPost, nextPost}),
    ]
        .filter(part => part.length > 0)
        .join("\n\n");
}

/**
 * Render tag and author metadata for an individual markdown blog post.
 */
function renderBlogPostMetadataMarkdown(post: BlogMarkdownPost): string {
    return [
        ...(post.tags.length > 0 ? ["Tags:", post.tags.map(tag => `- ${tag}`).join("\n")] : []),
        ...(post.author === null
            ? []
            : [`Author: ${post.author.name}`, renderBlogAuthorLinks(post.author)]),
    ]
        .filter(part => part.length > 0)
        .join("\n\n");
}

/**
 * Render markdown links for the configured social profiles on an author.
 */
function renderBlogAuthorLinks(author: BlogMarkdownAuthor): string {
    return [
        author.socials.x === null ? null : `- [X](${author.socials.x})`,
        author.socials.bluesky === null ? null : `- [BlueSky](${author.socials.bluesky})`,
        author.socials.linkedin === null ? null : `- [LinkedIn](${author.socials.linkedin})`,
        author.socials.email === null ? null : `- [Email](mailto:${author.socials.email})`,
    ]
        .filter((link): link is string => link !== null)
        .join("\n");
}

/**
 * Render the generated next, previous, and home links for a markdown post.
 */
function renderBlogPostLinksMarkdown({
    previousPost,
    nextPost,
}: {
    previousPost: BlogMarkdownPost | null;
    nextPost: BlogMarkdownPost | null;
}): string {
    return [
        "# Links",
        "- [Blog home](/blog.md)",
        ...(previousPost === null
            ? []
            : [`- [Previous: ${previousPost.title}](${createBlogPostUrl(previousPost.slug)}.md)`]),
        ...(nextPost === null
            ? []
            : [`- [Next: ${nextPost.title}](${createBlogPostUrl(nextPost.slug)}.md)`]),
    ].join("\n");
}

/**
 * Read and validate a blog publish date for markdown generation.
 */
function publishDateForBlogPostFile(file: BlogMarkdownPostSourceFile): string {
    const publishDate = stringFrontmatter(file, "publishDate");
    assert(
        publishDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(publishDate),
        `Expected publishDate YYYY-MM-DD for ${file.sourceName}`,
    );
    return publishDate;
}

/**
 * Read and validate the stable public slug for markdown generation.
 */
function slugForBlogPostFile(file: BlogMarkdownPostSourceFile): string {
    const slug = stringFrontmatter(file, "slug");
    assert(slug !== null, `Expected slug frontmatter for ${file.sourceName}`);
    assert(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug),
        `Expected lowercase kebab-case slug for ${file.sourceName}`,
    );
    return slug;
}

/**
 * Resolve comma-separated or array frontmatter tags for markdown output.
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
 * Sort markdown blog posts by newest publish date, then slug.
 */
function compareBlogMarkdownPosts(post1: BlogMarkdownPost, post2: BlogMarkdownPost): number {
    const dateOrder = post2.publishDate.localeCompare(post1.publishDate);
    return dateOrder !== 0 ? dateOrder : post1.slug.localeCompare(post2.slug);
}

/**
 * Assert that no two markdown blog posts claim the same public slug.
 */
function assertUniqueBlogPostSlugs(posts: Array<BlogMarkdownPost>): void {
    const slugs = new Set<string>();
    for (const post of posts) {
        assert(!slugs.has(post.slug), `Duplicate blog post slug: ${post.slug}`);
        slugs.add(post.slug);
    }
}

/**
 * Split YAML frontmatter from a docs MDX source file.
 */
function splitDocumentationFrontmatter(source: string): {
    frontmatter: {[key: string]: unknown};
    body: string;
} {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
    if (match === null) return {frontmatter: {}, body: source};

    // Non-object frontmatter is ignored; only key/value metadata is meaningful to docs
    // codegen.
    const parsed: unknown = parse(match[1]!);
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
