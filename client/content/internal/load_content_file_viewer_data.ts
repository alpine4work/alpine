import {Tree} from "@lezer/common";
import {
    hammerModulePromise,
    maxContentFileImageViewerMobilePreviewSize,
} from "~/client/content/internal/content_file_image_viewer_mobile.js";
import {isHtmlImageElementLoadedAndDecoded} from "~/client/helpers/elements/is_html_image_element_loaded_and_decoded.js";
import {getIsMobileWithoutListening} from "~/client/remix/use_is_mobile.js";
import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import {InternalError, UnknownError} from "~/shared/error/error.js";
import {getFileContentTypeContentCodeBlockLanguageIdIfExists} from "~/shared/files/file_content_type.js";
import {FileModel} from "~/shared/files/file_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export type ContentFileViewerLoaderData =
    | {
          readonly type: "Image";
          readonly image: InstanceType<typeof Image> | null;
      }
    // NOCOMMIT:
    // | {
    //       readonly type: "Pdf";
    //       readonly iframeElement: HTMLIFrameElement | null;
    //   }
    | {
          readonly type: "Code";
          readonly code: string;
          readonly codeTree: Tree | null;
      };

/**
 * Load the data needed to render `<ContentFileViewerModal>`. We will wait for
 * a short period of time for this data to load before opening our
 * `<ContentFileViewerModal>`. That way we won't show any loading spinners to
 * the user if data loads quickly.
 *
 * We use the same "loader data" naming convention as Remix routes since it's
 * conceptually similar but this has nothing to do with Remix's loader data
 * implementation.
 */
export async function loadContentFileViewerData(options: {
    spaceId: SpaceId;
    signedUrlSearch: string;
    file: FileModel;
    temporaryContainerElement: HTMLDivElement;
}): Promise<ContentFileViewerLoaderData | null> {
    switch (options.file.contentType) {
        case "application/octet-stream": {
            // TODO(calebmer, #files): Implement
            return null;
        }
        case "image/apng":
        case "image/avif":
        case "image/gif":
        case "image/jpeg":
        case "image/png":
        case "image/svg+xml":
        case "image/webp":
        case "image/bmp":
        case "image/ico":
        case "image/tiff":
        case "image/heif": {
            return loadContentFileImageViewer(options);
        }
        case "application/pdf":
        case "application/msword":
        case "application/vnd.ms-excel":
        case "application/vnd.ms-powerpoint":
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
            // NOCOMMIT: Explain?
            return null;
            // NOCOMMIT:
            // return loadContentFilePdfViewer(options);
        }
        case "video/webm":
        case "video/mp4":
        case "video/quicktime":
        case "video/mpeg":
        case "video/x-matroska": {
            // TODO(calebmer, #files): Implement
            return null;
        }
        case "audio/mpeg":
        case "audio/wav":
        case "audio/webm":
        case "audio/ogg":
        case "audio/mp4": {
            // TODO(calebmer, #files): Implement
            return null;
        }
        case "text/plain":
        case "text/javascript":
        case "text/html":
        case "text/css":
        case "application/sql":
        case "text/x-python":
        case "text/x-typescript":
        case "application/x-sh":
        case "text/x-java":
        case "application/json":
        case "text/markdown":
        case "text/x-csharp":
        case "text/x-c++src":
        case "text/x-csrc":
        case "application/x-httpd-php":
        case "text/x-go":
        case "application/yaml":
        case "application/x-powershell":
        case "text/rust":
        case "text/x-kotlin":
        case "application/x-ruby":
        case "text/x-lua":
        case "application/xml":
        case "application/vnd.dart":
        case "text/x-swift":
        case "text/x-asm":
        case "application/wasm":
        case "text/x-scala":
        case "text/x-r":
        case "text/x-elixir":
        case "text/x-objcsrc":
        case "text/x-perl":
        case "text/x-haskell":
        case "text/x-solidity":
        case "text/x-clojure":
        case "text/x-erlang":
        case "text/x-ocaml": {
            return loadContentFileCodeViewer(options);
        }
        default:
            throw exhaustive(options.file.contentType);
    }
}

export function getContentFileViewerSrc({
    spaceId,
    signedUrlSearch,
    file,
}: {
    spaceId: SpaceId;
    signedUrlSearch: string;
    file: FileModel;
}): string | null {
    if (file.alternative) {
        if (file.alternative.isProcessing) return null;

        return `/files/${spaceId}/${file.id}${signedUrlSearch}&variant=${
            file.alternative.isImagePreviewContent ? "preview" : "alternative"
        }`;
    } else {
        if (file.isUploading) return null;

        return `/files/${spaceId}/${file.id}${signedUrlSearch}`;
    }
}

async function loadContentFileImageViewer({
    spaceId,
    signedUrlSearch,
    file,
}: {
    spaceId: SpaceId;
    signedUrlSearch: string;
    file: FileModel;
}): Promise<ContentFileViewerLoaderData> {
    // Don't load images that exceed the maximum size we support on mobile. We
    // won't render them so don't bother loading them.
    if (
        getIsMobileWithoutListening() &&
        file.preview?.type === "Image" &&
        typeof file.preview.size === "object" &&
        file.preview.size.width * file.preview.size.height >
            maxContentFileImageViewerMobilePreviewSize
    ) {
        return {type: "Image", image: null};
    }

    const src = getContentFileViewerSrc({
        spaceId,
        signedUrlSearch,
        file,
    });
    if (!src) return {type: "Image", image: null};

    const image = new Image();
    image.decoding = "async";
    image.src = src;

    await runAllPromises([
        isHtmlImageElementLoadedAndDecoded(image),

        // Make sure `hammerjs` is imported as well. We only need it for zoomable
        // images.
        getIsMobileWithoutListening() ? hammerModulePromise.get() : null,
    ]);

    return {type: "Image", image};
}

async function loadContentFilePdfViewer({
    spaceId,
    signedUrlSearch,
    file,
    temporaryContainerElement,
}: {
    spaceId: SpaceId;
    signedUrlSearch: string;
    file: FileModel;
    temporaryContainerElement: HTMLDivElement;
}): Promise<ContentFileViewerLoaderData> {
    const src = getContentFileViewerSrc({
        spaceId,
        signedUrlSearch,
        file,
    });
    if (!src) return {type: "Pdf", iframeElement: null};

    const iframeElement = document.createElement("iframe");
    iframeElement.src = src;

    // We need to add the `<iframe>` element to the DOM for it to start loading. So
    // our content viewer modal renders an invisible container element for
    // temporary elements we can add elements like this into. When the content
    // viewer modal unmounts this `<iframe>` should also be removed from the DOM.
    temporaryContainerElement.appendChild(iframeElement);

    try {
        await new Promise<void>((resolve, reject) => {
            iframeElement.addEventListener("load", () => resolve());
            iframeElement.addEventListener("error", () => {
                reject(new UnknownError("Failed to load PDF iframe"));
            });
        });

        return {type: "Pdf", iframeElement};
    } finally {
        iframeElement.remove();
    }
}

async function loadContentFileCodeViewer({
    spaceId,
    signedUrlSearch,
    file,
}: {
    spaceId: SpaceId;
    signedUrlSearch: string;
    file: FileModel;
}): Promise<ContentFileViewerLoaderData> {
    const languageId =
        getFileContentTypeContentCodeBlockLanguageIdIfExists(file.contentType) ?? "text";

    const language = contentCodeBlockLanguageById[languageId];

    const [parser, code] = await runAllPromises([
        await language.getParser()?.promise,
        (async () => {
            // eslint-disable-next-line no-global-fetch
            const response = await fetch(`/files/${spaceId}/${file.id}${signedUrlSearch}`);

            if (!response.ok) {
                throw new InternalError(
                    `Failed to fetch code file with status code ${response.status}`,
                );
            }

            return response.text();
        })(),
    ]);

    const codeTree = parser?.parse(code) ?? null;

    return {
        type: "Code",
        code,
        codeTree,
    };
}
