import fs from "fs/promises";
import {join, normalize} from "path";
import {documentationApiHomeUrl} from "~/client/web/docs/documentation_api_home_url.js";
import {
    DocumentationApiModel,
    DocumentationApiOperation,
} from "~/client/web/docs/documentation_api_model.js";
import {
    DocumentationApiPageData,
    GeneratedDocumentationPageData,
} from "~/client/web/docs/documentation_mdx_page.js";
import {
    DocumentationNavTree,
    createDocumentationDocUrl,
    getFirstDocumentationSlug,
} from "~/client/web/docs/documentation_nav.js";
import {GeneratedDocumentationApiNav} from "~/client/web/docs/generated_documentation.js";
import {
    DocumentationSearchIndex,
    parseDocumentationSearchIndex,
} from "~/client/web/docs/search_documentation_entries.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";

const generatedDocumentationDirectoryPath = join(
    runfilesPath,
    "cyberworlds/client/web/docs/generated",
);

const generatedPagesDirectoryPath = join(generatedDocumentationDirectoryPath, "pages");

/**
 * Load the generated guide navigation tree from Bazel runfiles.
 */
async function loadGeneratedDocumentationNavTree(): Promise<DocumentationNavTree> {
    const json = await readGeneratedJson("guides_nav.json");
    assert(isDocumentationNavTree(json), "Expected generated guides nav JSON");
    return json;
}

/**
 * Load the generated docs search index used by the browser search dialog.
 */
async function loadGeneratedDocumentationSearchIndex(): Promise<DocumentationSearchIndex> {
    return parseDocumentationSearchIndex(await readGeneratedJson("search_metadata.json"));
}

/**
 * Resolve the first generated guide URL so `/docs` can redirect to it.
 */
export async function loadFirstGeneratedDocumentationUrl(): Promise<string | null> {
    const navTree = await loadGeneratedDocumentationNavTree();
    const firstSlug = getFirstDocumentationSlug(navTree.nodes);
    return firstSlug === null ? null : createDocumentationDocUrl(firstSlug);
}

/**
 * Load a generated guide page and its navigation tree for a route slug.
 */
export async function loadGeneratedDocumentationPage(slug: string): Promise<{
    navTree: DocumentationNavTree;
    page: GeneratedDocumentationPageData;
    searchIndex: DocumentationSearchIndex;
} | null> {
    const [navTree, searchIndex] = await runAllPromises([
        loadGeneratedDocumentationNavTree(),
        loadGeneratedDocumentationSearchIndex(),
    ]);
    if (navTree.filePathBySlug[slug] === undefined) return null;

    const page = await readGeneratedPageJson(createDocumentationDocUrl(slug));
    if (!isGeneratedDocumentationPageData(page)) return null;
    return {navTree, page, searchIndex};
}

/**
 * Load the generated API model parsed from the OpenAPI specification.
 */
async function loadGeneratedDocumentationApiModel(): Promise<DocumentationApiModel> {
    const json = await readGeneratedJson("api_model.json");
    assert(isDocumentationApiModel(json), "Expected generated API model JSON");
    return json;
}

/**
 * Load the generated API navigation tree used by every API docs page.
 */
export async function loadGeneratedDocumentationApiNav(): Promise<GeneratedDocumentationApiNav> {
    const json = await readGeneratedJson("api_nav.json");
    assert(isGeneratedDocumentationApiNav(json), "Expected generated API nav JSON");
    return json;
}

/**
 * Load the generated API overview MDX page and shared API navigation data.
 */
export async function loadGeneratedDocumentationApiHomePage(): Promise<{
    model: DocumentationApiModel;
    apiNav: GeneratedDocumentationApiNav;
    page: DocumentationApiPageData;
    searchIndex: DocumentationSearchIndex;
} | null> {
    return await loadGeneratedDocumentationApiMdxPage(documentationApiHomeUrl);
}

/**
 * Load a generated API MDX page by its URL.
 */
export async function loadGeneratedDocumentationApiMdxPage(url: string): Promise<{
    model: DocumentationApiModel;
    apiNav: GeneratedDocumentationApiNav;
    page: DocumentationApiPageData;
    searchIndex: DocumentationSearchIndex;
} | null> {
    const [model, apiNav, searchIndex, page] = await runAllPromises([
        loadGeneratedDocumentationApiModel(),
        loadGeneratedDocumentationApiNav(),
        loadGeneratedDocumentationSearchIndex(),
        readGeneratedPageJson(url),
    ]);
    if (!isDocumentationApiPageData(page)) return null;
    return {model, apiNav, page, searchIndex};
}

/**
 * Load route data for an API operation reference page.
 */
export async function loadGeneratedDocumentationApiOperationRouteData(slug: string): Promise<{
    model: DocumentationApiModel;
    apiNav: GeneratedDocumentationApiNav;
    operation: DocumentationApiOperation;
    searchIndex: DocumentationSearchIndex;
} | null> {
    const [model, apiNav, searchIndex] = await runAllPromises([
        loadGeneratedDocumentationApiModel(),
        loadGeneratedDocumentationApiNav(),
        loadGeneratedDocumentationSearchIndex(),
    ]);
    const operation = model.operationsBySlug[slug];
    if (operation === undefined) return null;
    return {model, apiNav, operation, searchIndex};
}

/**
 * Load route data for an API schema reference page.
 */
export async function loadGeneratedDocumentationApiSchemaRouteData(name: string): Promise<{
    model: DocumentationApiModel;
    apiNav: GeneratedDocumentationApiNav;
    searchIndex: DocumentationSearchIndex;
} | null> {
    const [model, apiNav, searchIndex] = await runAllPromises([
        loadGeneratedDocumentationApiModel(),
        loadGeneratedDocumentationApiNav(),
        loadGeneratedDocumentationSearchIndex(),
    ]);
    if (model.schemas[name] === undefined) return null;
    return {model, apiNav, searchIndex};
}

/**
 * Read a top-level generated JSON artifact.
 */
async function readGeneratedJson(path: string): Promise<unknown> {
    return JSON.parse(await fs.readFile(join(generatedDocumentationDirectoryPath, path), "utf8"));
}

/**
 * Read a generated page JSON artifact if the URL maps to one.
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
 * Convert a docs URL into the generated page JSON path it owns.
 */
function generatedPageFilePath(url: string): string | null {
    const decoded = decodeGeneratedDocumentationUrl(url);
    if (decoded === null) return null;

    // Pages are nested by URL under the generated pages directory. Normalize and
    // verify the result so malformed paths cannot escape the runfiles tree.
    const normalized = normalize(
        join(generatedPagesDirectoryPath, `${decoded.replace(/^\/+/, "")}.json`),
    );
    if (
        normalized !== generatedPagesDirectoryPath &&
        !normalized.startsWith(`${generatedPagesDirectoryPath}/`)
    ) {
        return null;
    }
    return normalized;
}

/**
 * Decode a generated docs URL while treating malformed escapes as no-match.
 */
function decodeGeneratedDocumentationUrl(url: string): string | null {
    try {
        return decodeURIComponent(url);
    } catch {
        return null;
    }
}

/**
 * Check whether a generated JSON read failed because the page does not exist.
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
 * Runtime guard for generated guide nav JSON.
 */
function isDocumentationNavTree(value: unknown): value is DocumentationNavTree {
    return (
        isPlainObject(value) && Array.isArray(value.nodes) && isPlainObject(value.filePathBySlug)
    );
}

/**
 * Runtime guard for generated guide page JSON.
 */
function isGeneratedDocumentationPageData(value: unknown): value is GeneratedDocumentationPageData {
    return (
        isPlainObject(value) &&
        typeof value.slug === "string" &&
        typeof value.title === "string" &&
        (typeof value.description === "string" || value.description === null) &&
        typeof value.mdxCode === "string" &&
        Array.isArray(value.toc)
    );
}

/**
 * Runtime guard for generated API MDX page JSON.
 */
function isDocumentationApiPageData(value: unknown): value is DocumentationApiPageData {
    return (
        isPlainObject(value) &&
        typeof value.name === "string" &&
        typeof value.title === "string" &&
        typeof value.url === "string" &&
        typeof value.isHome === "boolean" &&
        (typeof value.description === "string" || value.description === null) &&
        typeof value.mdxCode === "string" &&
        Array.isArray(value.toc)
    );
}

/**
 * Runtime guard for generated API navigation JSON.
 */
function isGeneratedDocumentationApiNav(value: unknown): value is GeneratedDocumentationApiNav {
    return (
        isPlainObject(value) &&
        Array.isArray(value.pages) &&
        Array.isArray(value.groups) &&
        Array.isArray(value.schemaNames)
    );
}

/**
 * Runtime guard for generated API model JSON.
 */
function isDocumentationApiModel(value: unknown): value is DocumentationApiModel {
    return (
        isPlainObject(value) &&
        typeof value.serverUrl === "string" &&
        Array.isArray(value.groups) &&
        Array.isArray(value.schemaNames) &&
        isPlainObject(value.operationsBySlug) &&
        isPlainObject(value.schemas)
    );
}
