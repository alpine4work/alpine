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
    createDocumentationApiSchemaUrl,
} from "~/client/web/docs/documentation_api_model.js";
import {documentationHomeUrl} from "~/client/web/docs/documentation_home_url.js";
import {
    DocumentationImageData,
    parseDocumentationImageDataBySource,
} from "~/client/web/docs/documentation_image_data.js";
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
import {DocumentationSitemapEntry} from "~/client/web/docs/documentation_sitemap.js";
import {
    GeneratedDocumentationApiNav,
    GeneratedDocumentationOpenGraphImage,
} from "~/client/web/docs/generated_documentation.js";
import {BlogAuthorById, BlogAuthorId} from "~/client/web/docs/internal/blog_author.js";
import {blogHomeUrl} from "~/client/web/docs/internal/blog_home_url.js";
import {
    BlogPostAdjacentArticle,
    BlogPostListItem,
    BlogPostPageData,
    createBlogPostUrl,
} from "~/client/web/docs/internal/blog_post.js";
import {createDocumentationImageRehypePlugin} from "~/client/web/docs/internal/codegen/create_documentation_image_rehype_plugin.js";
import {extractDocumentationMdxToc} from "~/client/web/docs/internal/codegen/extract_documentation_mdx_toc.js";
import {parseDocumentationApiModel} from "~/client/web/docs/internal/codegen/parse_api_documentation_model.js";
import {parseBlogPostDate} from "~/client/web/docs/internal/codegen/parse_blog_post_date.js";
import {
    DocumentationSearchEntry,
    buildDocumentationSearchIndex,
    createDocumentationSearchTags,
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
const responsiveDocumentationImageManifestPath = join(
    runfilesPath,
    "cyberworlds/app/static/responsive_documentation_image_manifest.json",
);
const specificationPath = join(
    runfilesPath,
    "cyberworlds/shared/api/specification/api_specification_final.yaml",
);

// The output TreeArtifact declared by `//client/web/docs:docs_generated`.
const outputDirectoryPath = "client/web/docs/generated";
const openGraphImageApiManifestPath = "client/web/docs/open_graph_images_api.json";
const openGraphImageBlogManifestPath = "client/web/docs/open_graph_images_blog.json";
const openGraphImageGuidesManifestPath = "client/web/docs/open_graph_images_guides.json";
const openGraphImageSchemasManifestPath = "client/web/docs/open_graph_images_schemas.json";

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
    // Bazel sees one output tree for docs, API data, and search.
    const [model, guideFiles, apiFiles, blogFiles, imageDataBySource] = await runAllPromises([
        fs.readFile(specificationPath, "utf8").then(parseDocumentationApiModel),
        readContentFiles(guidesDirectoryPath, ""),
        readContentFiles(apiDirectoryPath, "").then(orderApiContentFiles),
        readBlogPostFiles(),
        readDocumentationImageDataBySource(),
    ]);
    const [blogAuthors, blogPosts] = await runAllPromises([
        readBlogAuthors(imageDataBySource),
        runAllPromises(blogFiles.map(file => createBlogPostPage(file, imageDataBySource))),
    ]);
    blogPosts.sort(compareBlogPosts);
    assertUniqueBlogPostSlugs(blogPosts);

    await runAllPromises([
        writeGuideArtifacts(guideFiles, imageDataBySource),
        writeApiArtifacts(model, apiFiles, imageDataBySource),
        writeBlogArtifacts(blogAuthors, blogPosts),
        writeSearchMetadataArtifact({model, guideFiles, apiFiles, blogAuthors, blogPosts}),
        writeOpenGraphImageManifestArtifact({
            model,
            guideFiles,
            apiFiles,
            blogAuthors,
            blogPosts,
        }),
        writeDocumentationSitemapArtifact({
            model,
            guideFiles,
            apiFiles,
            blogFiles,
            blogPosts,
            imageDataBySource,
        }),
    ]);
}

/**
 * Write generated guide navigation and compiled guide pages.
 */
async function writeGuideArtifacts(
    files: Array<DocumentationContentSourceFile>,
    imageDataBySource: Record<string, DocumentationImageData>,
): Promise<void> {
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
                mdxCode: await compileMdxContent({
                    body: file.body,
                    imageDataBySource,
                    sizes: "(max-width: 860px) calc(100vw - 48px), 768px",
                }),
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
    imageDataBySource: Record<string, DocumentationImageData>,
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
                mdxCode: await compileMdxContent({
                    body: file.body,
                    imageDataBySource,
                    sizes: "(max-width: 860px) calc(100vw - 48px), 900px",
                }),
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
 * Write lightweight image inputs for the production-only Open Graph image build.
 */
async function writeOpenGraphImageManifestArtifact({
    model,
    guideFiles,
    apiFiles,
    blogAuthors,
    blogPosts,
}: {
    model: DocumentationApiModel;
    guideFiles: Array<DocumentationContentSourceFile>;
    apiFiles: Array<DocumentationContentSourceFile>;
    blogAuthors: BlogAuthorById;
    blogPosts: Array<BlogPostContentData>;
}): Promise<void> {
    const guideNavTree = parseDocumentationNavTree(
        guideFiles.map(file => ({relativePath: file.relativePath, title: navTitleForFile(file)})),
    );
    const guideFileByRelativePath = new Map(
        guideFiles.map(file => [file.relativePath, file] as const),
    );
    const guideImages: Array<GeneratedDocumentationOpenGraphImage> = [];
    const apiImages: Array<GeneratedDocumentationOpenGraphImage> = [];
    const schemaImages: Array<GeneratedDocumentationOpenGraphImage> = [];
    const blogImages: Array<GeneratedDocumentationOpenGraphImage> = [];

    for (const [slug, relativePath] of Object.entries(guideNavTree.filePathBySlug)) {
        const file = assertExists(guideFileByRelativePath.get(relativePath));
        const description = descriptionForFile(file);
        guideImages.push({
            pageUrl: createDocumentationDocUrl(slug),
            document: {
                type: "Documentation",
                title: titleForFile(file),
                ...(description === null ? {} : {description}),
            },
        });
    }

    for (const [index, file] of apiFiles.entries()) {
        const description = descriptionForFile(file);
        apiImages.push({
            pageUrl:
                index === 0 ? documentationApiHomeUrl : createDocumentationApiPageUrl(file.name),
            document: {
                type: "APIReference",
                title: titleForFile(file),
                ...(description === null ? {} : {description}),
            },
        });
    }

    for (const operation of Object.values(model.operationsBySlug)) {
        apiImages.push({
            pageUrl: createDocumentationApiOperationUrl(operation.slug),
            document: {
                type: "APIReference",
                title: operation.title,
                method: operation.method,
                ...(operation.description === null ? {} : {description: operation.description}),
            },
        });
    }

    for (const name of model.schemaNames) {
        const description = assertExists(model.schemas[name]).description;
        schemaImages.push({
            pageUrl: createDocumentationApiSchemaUrl(name),
            document: {
                type: "APIReference",
                title: name,
                ...(description === undefined ? {} : {description}),
            },
        });
    }

    blogImages.push({
        pageUrl: blogHomeUrl,
        document: {type: "BlogHome", title: "Alpine Blog"},
    });
    for (const post of blogPosts) {
        const author = blogAuthors[post.authorId];
        blogImages.push({
            pageUrl: createBlogPostUrl(post.slug),
            document: {
                type: "Blog",
                title: post.title,
                author: {name: author.name, avatarUrl: author.avatarUrl},
            },
        });
    }

    await runAllPromises([
        writeStandaloneJsonFile(openGraphImageGuidesManifestPath, guideImages),
        writeStandaloneJsonFile(openGraphImageApiManifestPath, apiImages),
        writeStandaloneJsonFile(openGraphImageSchemasManifestPath, schemaImages),
        writeStandaloneJsonFile(openGraphImageBlogManifestPath, blogImages),
    ]);
}

/**
 * Write the prebuilt Fuse search index used by the docs search dialog.
 */
async function writeSearchMetadataArtifact({
    model,
    guideFiles,
    apiFiles,
    blogAuthors,
    blogPosts,
}: {
    model: DocumentationApiModel;
    guideFiles: Array<DocumentationContentSourceFile>;
    apiFiles: Array<DocumentationContentSourceFile>;
    blogAuthors: BlogAuthorById;
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
            tags: createDocumentationSearchTags({type: "api", tags: tagsForFile(file)}),
            ...(description !== null ? {description} : {}),
        });
    }

    for (const post of blogPosts) {
        entries.push(toBlogSearchEntry(post, blogAuthors));
    }

    for (const operation of Object.values(model.operationsBySlug)) {
        entries.push({
            type: "api",
            title: operation.title,
            url: createDocumentationApiOperationUrl(operation.slug),
            tags: createDocumentationSearchTags({
                type: "api",
                tags: [...getApiMethodSearchTags(operation.method), operation.group.toLowerCase()],
            }),
            description: operation.description ?? `${operation.method} ${operation.path}`,
        });
    }

    await writeJsonFile("search_metadata.json", buildDocumentationSearchIndex(entries));
}

/** Write the documentation and blog contribution to Alpine's sitemap. */
async function writeDocumentationSitemapArtifact({
    model,
    guideFiles,
    apiFiles,
    blogFiles,
    blogPosts,
    imageDataBySource,
}: {
    model: DocumentationApiModel;
    guideFiles: Array<DocumentationContentSourceFile>;
    apiFiles: Array<DocumentationContentSourceFile>;
    blogFiles: Array<BlogPostSourceFile>;
    blogPosts: Array<BlogPostContentData>;
    imageDataBySource: Record<string, DocumentationImageData>;
}): Promise<void> {
    const guideNavTree = parseDocumentationNavTree(
        guideFiles.map(file => ({relativePath: file.relativePath, title: navTitleForFile(file)})),
    );
    const blogFileBySlug = new Map(blogFiles.map(file => [slugForFile(file), file] as const));
    const entries: Array<DocumentationSitemapEntry> = [];

    // Blog dates come from authored metadata. Other documentation surfaces omit
    // modification dates until they have an equally truthful authored source.
    const blogLastModified = blogPosts.reduce(
        (latest, post) => (post.modifiedDate > latest ? post.modifiedDate : latest),
        "",
    );

    // Keep every public content root together immediately after Alpine's app-level
    // sitemap entries. Deeper content is grouped by surface below.
    entries.push(
        {
            pathname: blogHomeUrl,
            lastModified: blogLastModified || null,
            imageUrls: blogPosts
                .map(post => post.previewImageData?.src ?? post.previewImage)
                .filter((imageUrl): imageUrl is string => imageUrl !== null),
        },
        {
            pathname: documentationHomeUrl,
            lastModified: null,
            imageUrls: [],
        },
        {
            pathname: documentationApiHomeUrl,
            lastModified: null,
            imageUrls: [],
        },
    );

    // `blogPosts` is already sorted by newest publish date in `main()`.
    for (const post of blogPosts) {
        const file = assertExists(blogFileBySlug.get(post.slug));
        const imageSources = [post.previewImage, ...extractDocumentationImageSources(file.body)];
        // Prefer cache-busted responsive sources while retaining remote or otherwise
        // unprocessed image URLs exactly as authored.
        const imageUrls = Array.from(
            new Set(
                imageSources
                    .map(source =>
                        source === null ? undefined : (imageDataBySource[source]?.src ?? source),
                    )
                    .filter((imageUrl): imageUrl is string => imageUrl !== undefined),
            ),
        );
        entries.push({
            pathname: createBlogPostUrl(post.slug),
            lastModified: post.modifiedDate,
            imageUrls,
        });
    }

    for (const slug of Object.keys(guideNavTree.filePathBySlug)) {
        entries.push({
            pathname: createDocumentationDocUrl(slug),
            lastModified: null,
            imageUrls: [],
        });
    }
    for (const file of apiFiles.slice(1)) {
        entries.push({
            pathname: createDocumentationApiPageUrl(file.name),
            lastModified: null,
            imageUrls: [],
        });
    }
    for (const operation of Object.values(model.operationsBySlug)) {
        entries.push({
            pathname: createDocumentationApiOperationUrl(operation.slug),
            lastModified: null,
            imageUrls: [],
        });
    }
    for (const schemaName of model.schemaNames) {
        entries.push({
            pathname: createDocumentationApiSchemaUrl(schemaName),
            lastModified: null,
            imageUrls: [],
        });
    }
    await writeJsonFile("documentation_sitemap.json", {entries});
}

/** Extract local image destinations from authored Markdown image syntax. */
function extractDocumentationImageSources(markdown: string): Array<string> {
    return Array.from(markdown.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g), match =>
        assertExists(match[1]),
    );
}

/**
 * Compile MDX source into function-body code that Remix can evaluate at runtime.
 */
async function compileMdxContent({
    body,
    imageDataBySource,
    sizes,
}: {
    body: string;
    imageDataBySource: Record<string, DocumentationImageData>;
    sizes: string;
}): Promise<string> {
    const compiled = await compile(body, {
        outputFormat: "function-body",
        development: false,
        remarkPlugins: [remarkGfm],
        rehypePlugins: [createDocumentationImageRehypePlugin({imageDataBySource, sizes})],
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
 * Write one declared output outside the generated documentation TreeArtifact.
 */
async function writeStandaloneJsonFile(path: string, value: unknown): Promise<void> {
    await fs.mkdir(dirname(path), {recursive: true});
    await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
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
            const filePath = join(directoryPath, entry.name);
            const source = await fs.readFile(filePath, "utf8");
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
async function readBlogAuthors(
    imageDataBySource: Record<string, DocumentationImageData>,
): Promise<BlogAuthorById> {
    const value: unknown = JSON.parse(await fs.readFile(blogAuthorsPath, "utf8"));
    assert(isPlainObject(value), "Expected blog authors JSON object");

    const authors: Partial<BlogAuthorById> = {};
    for (const id of ["josh", "caleb", "rachel", "ian"] as const) {
        const author = value[id];
        assert(isPlainObject(author), `Expected blog author ${id}`);
        assert(typeof author.name === "string", `Expected blog author ${id} name`);
        assert(isPlainObject(author.socials), `Expected blog author ${id} socials`);

        const avatarUrl = `/blog/authors/${id}.avif`;
        authors[id] = {
            id,
            name: author.name,
            socials: {
                x: nullableString(author.socials.x),
                bluesky: nullableString(author.socials.bluesky),
                linkedin: nullableString(author.socials.linkedin),
                email: nullableString(author.socials.email),
            },
            avatarUrl,
            avatarImage: assertExists(
                imageDataBySource[avatarUrl],
                `Expected responsive avatar image for ${id}`,
            ),
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

        const filePath = join(blogDirectoryPath, entry.name);
        const source = await fs.readFile(filePath, "utf8");
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
async function createBlogPostPage(
    file: BlogPostSourceFile,
    imageDataBySource: Record<string, DocumentationImageData>,
): Promise<BlogPostContentData> {
    const slug = slugForFile(file);
    const authorId = stringFrontmatter(file, "author");
    assert(isBlogAuthorId(authorId), `Expected valid author for ${file.sourceName}`);

    const publishDate = publishDateForFile(file);
    const previewImage = stringFrontmatter(file, "previewImage");
    return {
        slug,
        title: stringFrontmatter(file, "title") ?? humanizeBlogSlug(slug),
        summary: stringFrontmatter(file, "summary") ?? "",
        publishDate,
        modifiedDate: modifiedDateForFile(file, publishDate),
        authorId,
        tags: tagsForFile(file),
        previewImage,
        previewImageData: previewImage === null ? null : (imageDataBySource[previewImage] ?? null),
        previewImageAlt: stringFrontmatter(file, "previewImageAlt"),
        mdxCode: await compileMdxContent({
            body: file.body,
            imageDataBySource,
            sizes: "(max-width: 868px) calc(100vw - 48px), 820px",
        }),
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
    return parseBlogPostDate({
        value: file.frontmatter.publishDate,
        fieldName: "publishDate",
        sourceName: file.sourceName,
    });
}

/**
 * Read an authored modified date or deterministically fall back to publication.
 */
function modifiedDateForFile(file: BlogPostSourceFile, publishDate: string): string {
    const modifiedDate = parseBlogPostDate({
        value: file.frontmatter.modifiedDate ?? publishDate,
        fieldName: "modifiedDate",
        sourceName: file.sourceName,
    });
    return `${modifiedDate}T00:00:00.000Z`;
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
        modifiedDate: post.modifiedDate,
        authorId: post.authorId,
        tags: post.tags,
        previewImage: post.previewImage,
        previewImageData: post.previewImageData,
        previewImageAlt: post.previewImageAlt,
    };
}

/** Load the image build's source-to-srcset manifest. */
async function readDocumentationImageDataBySource(): Promise<
    Record<string, DocumentationImageData>
> {
    return parseDocumentationImageDataBySource(
        JSON.parse(await fs.readFile(responsiveDocumentationImageManifestPath, "utf8")),
    );
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
function toBlogSearchEntry(
    post: BlogPostContentData,
    authors: BlogAuthorById,
): DocumentationSearchEntry {
    return {
        type: "blog",
        title: post.title,
        url: createBlogPostUrl(post.slug),
        tags: createDocumentationSearchTags({
            type: "blog",
            authorName: authors[post.authorId].name,
            tags: post.tags,
        }),
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
