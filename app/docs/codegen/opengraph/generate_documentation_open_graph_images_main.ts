// Must run before importing the logo component compiled with React Refresh.
import "~/server/helpers/node/register_noop_react_refresh.js";

import fs from "fs/promises";
import {dirname, join, normalize, resolve} from "path";
import {
    DocumentationOpenGraphImageDocument,
    renderDocumentationOpenGraphImage,
} from "~/app/docs/codegen/opengraph/render_documentation_open_graph_image.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {DocumentationApiMethod} from "~/shared/docs/documentation_api_model.js";
import {
    GeneratedDocumentationOpenGraphImage,
    GeneratedDocumentationOpenGraphImageDocument,
} from "~/shared/docs/generated_documentation.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {asyncIterableFromIterable} from "~/shared/helpers/iterable/async_iterable_from_iterable.js";
import {parallelProcessAsyncIterable} from "~/shared/helpers/iterable/parallel_process_async_iterable.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.open_source.js";

const staticFilesDirectoryPath = join(runfilesPath, "cyberworlds/app/static/files");

/** Render every generated page description into the production image tree. */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    assert(
        args.length === 2,
        "Expected an Open Graph image manifest path and output directory path",
    );
    const manifestPath = resolve(assertExists(args[0]));
    const outputDirectoryPath = resolve(assertExists(args[1]));

    await fs.mkdir(outputDirectoryPath, {recursive: true});
    const images = parseGeneratedDocumentationOpenGraphImages(
        JSON.parse(await fs.readFile(manifestPath, "utf8")) as unknown,
    );

    // Sharp and font rendering are memory-intensive, so cap concurrency while still
    // parallelizing enough images to keep production builds quick.
    await parallelProcessAsyncIterable(
        asyncIterableFromIterable(images),
        image => writeOpenGraphImage(image, outputDirectoryPath),
        {concurrency: 8},
    );
}

/** Validate the generated JSON before passing it to the image renderer. */
function parseGeneratedDocumentationOpenGraphImages(
    value: unknown,
): Array<GeneratedDocumentationOpenGraphImage> {
    assert(Array.isArray(value), "Expected generated Open Graph image array");
    assert(
        value.every(isGeneratedDocumentationOpenGraphImage),
        "Expected valid generated Open Graph image inputs",
    );
    return value;
}

/** Check one generated page URL and serializable renderer document. */
function isGeneratedDocumentationOpenGraphImage(
    value: unknown,
): value is GeneratedDocumentationOpenGraphImage {
    return (
        isPlainObject(value) &&
        typeof value.pageUrl === "string" &&
        value.pageUrl.startsWith("/") &&
        isGeneratedDocumentationOpenGraphImageDocument(value.document)
    );
}

/** Check the renderer fields shared through the generated JSON manifest. */
function isGeneratedDocumentationOpenGraphImageDocument(
    value: unknown,
): value is GeneratedDocumentationOpenGraphImageDocument {
    if (!isPlainObject(value) || typeof value.title !== "string") return false;

    switch (value.type) {
        case "BlogHome":
            return true;
        case "Blog":
            return (
                isPlainObject(value.author) &&
                typeof value.author.name === "string" &&
                typeof value.author.avatarUrl === "string"
            );
        case "Documentation":
            return value.description === undefined || typeof value.description === "string";
        case "APIReference":
            return (
                (value.description === undefined || typeof value.description === "string") &&
                (value.method === undefined || isDocumentationApiMethod(value.method))
            );
        default:
            return false;
    }
}

/** Check the HTTP methods supported by API reference image badges. */
function isDocumentationApiMethod(value: unknown): value is DocumentationApiMethod {
    return (
        value === "GET" ||
        value === "POST" ||
        value === "PUT" ||
        value === "PATCH" ||
        value === "DELETE"
    );
}

/** Render and write one image at the file path derived from its public URL. */
async function writeOpenGraphImage(
    {pageUrl, document}: GeneratedDocumentationOpenGraphImage,
    outputDirectoryPath: string,
): Promise<void> {
    const filePath = normalize(join(outputDirectoryPath, pageUrl.replace(/^\/+/, ""), "og.png"));
    assert(filePath.startsWith(`${outputDirectoryPath}/`), "Expected safe Open Graph image path");

    await fs.mkdir(dirname(filePath), {recursive: true});
    await fs.writeFile(
        filePath,
        Uint8Array.from(
            await renderDocumentationOpenGraphImage(await loadRendererDocument(document)),
        ),
    );
}

/**
 * Resolve serializable blog avatar URLs into the bytes required by the renderer.
 */
async function loadRendererDocument(
    document: GeneratedDocumentationOpenGraphImageDocument,
): Promise<DocumentationOpenGraphImageDocument> {
    switch (document.type) {
        case "Blog": {
            const avatarPath = normalize(
                join(staticFilesDirectoryPath, document.author.avatarUrl.replace(/^\/+/, "")),
            );
            assert(
                avatarPath.startsWith(`${staticFilesDirectoryPath}/`),
                "Expected safe blog author avatar path",
            );
            return {
                type: "Blog",
                title: document.title,
                author: {
                    name: document.author.name,
                    avatar: await fs.readFile(avatarPath),
                },
            };
        }
        case "BlogHome":
        case "Documentation":
        case "APIReference":
            return document;
        default:
            throw exhaustive(document);
    }
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
