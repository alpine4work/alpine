import {Tree} from "@lezer/common";
import {FileModelRegistryData} from "~/client/web/content/file_registry.js";
import {isHtmlImageElementLoadedAndDecoded} from "~/client/web/helpers/elements/is_html_image_element_loaded_and_decoded.js";
import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import {Platform} from "~/shared/design/core/platform.js";
import {InternalError, UnknownError} from "~/shared/error/error.open_source.js";
import {getFileContentTypeContentCodeBlockLanguageIdIfExists} from "~/shared/files/file_content_type.open_source.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * The maximum number of pixels in a preview image we'll render on mobile. If
 * `preview.width * preview.height` is greater than this we won't render the image.
 */
// This variable is here instead of `content_file_image_viewer_mobile.tsx` to avoid
// a cyclic import.
export const maxContentFileImageViewerMobilePreviewSize = 35e6;

/**
 * Must import `hammerjs` lazily since it references `window` so it's not available
 * on the server.
 */
// This variable is here instead of `content_file_image_viewer_mobile.tsx` to avoid
// a cyclic import.
export const hammerModulePromise = new Lazy(() => PromiseImmediate.resolve(import("hammerjs")));

export type ContentFileViewerLoaderData =
    | {
          readonly type: "Image";
          readonly imageElement: HTMLImageElement | null;
      }
    | {
          readonly type: "VideoMobile";
          readonly videoElement: HTMLVideoElement | null;
      }
    | {
          readonly type: "AudioMobile";
          readonly audioElement: HTMLAudioElement | null;
      }
    | {
          readonly type: "Code";
          readonly code: string;
          readonly codeTree: Tree | null;
      };

/**
 * Load the data needed to render `<ContentFileViewerModal>`. We will wait for a
 * short period of time for this data to load before opening our
 * `<ContentFileViewerModal>`. That way we won't show any loading spinners to the
 * user if data loads quickly.
 *
 * We use the same "loader data" naming convention as Remix routes since it's
 * conceptually similar but this has nothing to do with Remix's loader data
 * implementation.
 */
export async function loadContentFileViewerData({
    spaceId,
    file,
    platform,
}: {
    spaceId: SpaceId;
    file: FileModelRegistryData;
    platform: Platform;
}): Promise<ContentFileViewerLoaderData | null> {
    switch (file.contentType) {
        case "application/octet-stream": {
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
            return await loadContentFileImageViewer({spaceId, file, platform});
        }
        case "application/pdf":
        case "application/msword":
        case "application/vnd.ms-excel":
        case "application/vnd.ms-powerpoint":
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
            // We don't currently preload anything regarding PDFs. Since we can't accurately
            // tell when an `<iframe>` has finished loading. It's not just when the `load`
            // event fires since the browser will continue to load behind the scenes.
            return null;
        }
        case "video/webm":
        case "video/mp4":
        case "video/quicktime":
        case "video/mpeg":
        case "video/x-matroska": {
            if (platform === "mobile") {
                return await loadContentFileVideoViewerMobile({spaceId, file});
            } else {
                return await loadContentFileImageViewer({
                    spaceId,
                    file,
                    platform,
                    // Load the preview image when loading videos. We don't load the video itself until
                    // the user presses play.
                    asPreview: true,
                });
            }
        }
        case "audio/mpeg":
        case "audio/wav":
        case "audio/webm":
        case "audio/ogg":
        case "audio/mp4": {
            if (platform !== "mobile") return null;

            return await loadContentFileAudioViewerMobile({spaceId, file});
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
            return await loadContentFileCodeViewer({spaceId, file});
        }
        default:
            throw exhaustive(file.contentType);
    }
}

export function getContentFileViewerSrc({
    spaceId,
    file,
    asPreview = false,
}: {
    spaceId: SpaceId;
    file: FileModelRegistryData;
    asPreview?: boolean;
}): string | null {
    const resourceServiceUrl = __RESOURCE_SERVICE_URL__;
    if (asPreview) {
        if (file.preview?.type !== "Image") return null;
        if (file.preview.content === "Processing" || file.preview.content === "Error") return null;
        return `${resourceServiceUrl}/files/${spaceId}/${file.id}${file.signedUrlSearch}&variant=preview`;
    }

    if (file.alternative) {
        if (file.alternative.isProcessing || !file.alternative.ok) return null;

        return `${resourceServiceUrl}/files/${spaceId}/${file.id}${file.signedUrlSearch}&variant=${
            file.alternative.isImagePreviewContent ? "preview" : "alternative"
        }`;
    } else {
        if (file.isUploading) return null;

        return `${resourceServiceUrl}/files/${spaceId}/${file.id}${file.signedUrlSearch}`;
    }
}

async function loadContentFileImageViewer({
    spaceId,
    file,
    platform,
    asPreview = false,
}: {
    spaceId: SpaceId;
    file: FileModelRegistryData;
    platform: Platform;
    asPreview?: boolean;
}): Promise<ContentFileViewerLoaderData> {
    // Don't load images that exceed the maximum size we support on mobile. We won't
    // render them so don't bother loading them.
    if (
        platform === "mobile" &&
        file.preview?.type === "Image" &&
        typeof file.preview.size === "object" &&
        file.preview.size.width * file.preview.size.height >
            maxContentFileImageViewerMobilePreviewSize
    ) {
        return {type: "Image", imageElement: null};
    }

    const src = getContentFileViewerSrc({spaceId, file, asPreview});
    if (!src) return {type: "Image", imageElement: null};

    const image = new Image();
    image.decoding = "async";
    image.src = src;

    // Needed to get a proper CORS response from the resource service where our files
    // are hosted.
    image.crossOrigin = "anonymous";

    await runAllPromises([
        isHtmlImageElementLoadedAndDecoded(image),

        // Make sure `hammerjs` is imported as well. We only need it for zoomable images.
        platform === "mobile" ? hammerModulePromise.get() : null,
    ]);

    return {type: "Image", imageElement: image};
}

async function loadContentFileVideoViewerMobile({
    spaceId,
    file,
}: {
    spaceId: SpaceId;
    file: FileModelRegistryData;
}): Promise<ContentFileViewerLoaderData> {
    const src = getContentFileViewerSrc({spaceId, file});
    if (!src) return {type: "VideoMobile", videoElement: null};

    const previewSrc = getContentFileViewerSrc({
        spaceId,
        file,
        asPreview: true,
    });

    const videoElement = document.createElement("video");
    // Needed to get a proper CORS response from the resource service where our files
    // are hosted.
    videoElement.crossOrigin = "anonymous";
    videoElement.preload = "metadata";
    videoElement.controls = true;
    if (previewSrc !== null) videoElement.poster = previewSrc;
    videoElement.src = src;

    await new Promise((resolve, reject) => {
        videoElement.addEventListener("loadedmetadata", resolve);

        videoElement.addEventListener("error", () => {
            reject(new UnknownError(quote`Error loading video with source ${src}`));
        });
    });

    return {type: "VideoMobile", videoElement};
}

async function loadContentFileAudioViewerMobile({
    spaceId,
    file,
}: {
    spaceId: SpaceId;
    file: FileModelRegistryData;
}): Promise<ContentFileViewerLoaderData> {
    const src = getContentFileViewerSrc({spaceId, file});
    if (!src) return {type: "AudioMobile", audioElement: null};

    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "metadata";
    audio.controls = true;
    audio.src = src;

    await new Promise((resolve, reject) => {
        audio.addEventListener("loadedmetadata", resolve);

        audio.addEventListener("error", () => {
            reject(new UnknownError(quote`Error loading video with source ${src}`));
        });
    });

    return {type: "AudioMobile", audioElement: audio};
}

async function loadContentFileCodeViewer({
    spaceId,
    file,
}: {
    spaceId: SpaceId;
    file: FileModelRegistryData;
}): Promise<ContentFileViewerLoaderData> {
    const resourceServiceUrl = __RESOURCE_SERVICE_URL__;
    const languageId =
        getFileContentTypeContentCodeBlockLanguageIdIfExists(file.contentType) ?? "text";

    const language = contentCodeBlockLanguageById[languageId];

    const [parser, code] = await runAllPromises([
        await language.getParser()?.promise,
        (async () => {
            // eslint-disable-next-line cyberworlds/no-global-fetch
            const response = await fetch(
                `${resourceServiceUrl}/files/${spaceId}/${file.id}${file.signedUrlSearch}`,
                {mode: "cors"},
            );

            if (!response.ok) {
                throw new InternalError(
                    `Failed to fetch code file with status code ${response.status}`,
                );
            }

            return await response.text();
        })(),
    ]);

    const codeTree = parser?.parse(code) ?? null;

    return {
        type: "Code",
        code,
        codeTree,
    };
}
