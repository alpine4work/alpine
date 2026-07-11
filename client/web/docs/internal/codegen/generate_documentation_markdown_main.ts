// Must run before importing anything that pulls in a component (the markdown
// variants live in `.tsx` files that carry the SWC react-refresh transform).
import "~/server/helpers/node/register_noop_react_refresh.js";

import {compile} from "@mdx-js/mdx";
import fs from "fs/promises";
import {dirname, join} from "path";
import remarkGfm from "remark-gfm";
import {parse} from "yaml";
import {buildDocumentationApiCodeSamples} from "~/client/web/docs/build_api_documentation_code_samples.js";
import {createDocumentationApiPageUrl} from "~/client/web/docs/create_documentation_api_page_url.js";
import {documentationApiHomeUrl} from "~/client/web/docs/documentation_api_home_url.js";
import {
    createDocumentationApiOperationUrl,
    createDocumentationApiSchemaUrl,
} from "~/client/web/docs/documentation_api_model.js";
import {
    createDocumentationDocUrl,
    humanizeDocumentationName,
    parseDocumentationNavTree,
    parseDocumentationOrderPrefix,
} from "~/client/web/docs/documentation_nav.js";
import {parseDocumentationApiModel} from "~/client/web/docs/internal/codegen/parse_api_documentation_model.js";
import {
    createDocumentationMdxMarkdownComponents,
    documentationMdxMarkdownComponents,
} from "~/client/web/docs/internal/markdown/components/documentation_mdx_components.js";
import {
    renderApiOperationToMarkdown,
    renderDocumentationApiSchemaToMarkdown,
} from "~/client/web/docs/internal/markdown/render_api_documentation_to_markdown.js";
import {renderDocumentationMdxToMarkdown} from "~/client/web/docs/internal/markdown/render_documentation_mdx_to_markdown.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";

// The markdown content and OpenAPI spec are read from this tool's runfiles.
const runfilesPath = assertExists(process.env.RUNFILES);
const contentDirectoryPath = join(runfilesPath, "cyberworlds/client/web/docs/content");
const guidesDirectoryPath = join(contentDirectoryPath, "guides");
const apiDirectoryPath = join(contentDirectoryPath, "api");
const specificationPath = join(
    runfilesPath,
    "cyberworlds/shared/api/specification/api_specification_final.yaml",
);

// The output TreeArtifact, declared as `out_dirs` in this package's `BUILD`. Each
// page is written to `<url>.md`, so the `.md` route can map a request path
// straight to a file (`/docs/guides/tasks.md` → `pages/docs/guides/tasks.md`).
const outputDirectory = "client/web/docs/internal/codegen/pages";

type DocumentationMarkdownPage = {url: string; markdown: string};

/**
 * Generate markdown mirrors for every docs page that agents may read.
 */
async function main() {
    const pages = [...(await buildDocumentationMdxPages()), ...(await buildApiPages())];
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

type DocumentationContentSourceFile = {
    relativePath: string;
    name: string;
    frontmatter: {[key: string]: unknown};
    body: string;
};

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
 * Resolve the navigation title for slug generation.
 */
function navTitleForFile(file: DocumentationContentSourceFile): string {
    if (typeof file.frontmatter.navTitle === "string") return file.frontmatter.navTitle;
    if (typeof file.frontmatter.title === "string") return file.frontmatter.title;
    return humanizeDocumentationName(file.name);
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
