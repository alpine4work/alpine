import {UploadFileInput} from "~/client/web/content/internal/upload_file.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {
    FileAttachmentTarget,
    deserializeFileAttachmentTargetString,
} from "~/shared/files/file_attachment_target.js";
import {FileEntityId, isFileEntityId} from "~/shared/files/file_entity_id.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {parseSearchEntityIdFromUrl} from "~/shared/search/parse_search_entity_id_from_url.js";

export type FileInfo =
    | {
          readonly type: "UploadFile";
          readonly input: UploadFileInput;
      }
    | {
          readonly type: "AttachFile";
          readonly spaceId: SpaceId;
          readonly fileId: FileId;
          readonly target: FileAttachmentTarget | "Uploader";
      };

export type FileInfoWithEntity =
    | FileInfo
    | {
          readonly type: "AttachFileEntity";
          readonly spaceId: SpaceId;
          readonly fileEntityId: FileEntityId;
      };

/**
 * Iterates through all media elements in the given container element and yields an
 * object containing:
 *
 * - The discovered media element itself
 * - File information that indicates whether the file should be:
 *     - Uploaded as a new file (type: "UploadFile")
 *     - Attached from an existing file (type: "AttachFile")
 *     - Or null if no valid source is found
 */
export function* iterateFileInfosInElement(
    element: Element,
    getSpaceId: () => SpaceId,
): IterableIterator<{element: Element; info: FileInfoWithEntity | null}> {
    let currentUrl: URL | undefined;
    let resourceServiceUrl: URL | undefined;

    for (const fileElement of element.querySelectorAll("img, video, audio, object, iframe")) {
        // Handle file entity elements (serialized to DOM via `<iframe>`s) separately from
        // other file types.
        if (fileElement instanceof HTMLIFrameElement) {
            const spaceId = getSpaceId();

            const entityId = parseSearchEntityIdFromUrl(spaceId, fileElement.src);
            if (entityId === null || !isFileEntityId(entityId)) continue;

            yield {element, info: {type: "AttachFileEntity", spaceId, fileEntityId: entityId}};
            continue;
        }

        const urlString =
            fileElement instanceof HTMLImageElement
                ? fileElement.src || null
                : fileElement instanceof HTMLVideoElement || fileElement instanceof HTMLAudioElement
                  ? fileElement.src ||
                    findMapIterable(fileElement.childNodes, fileChildElement =>
                        fileChildElement instanceof HTMLSourceElement
                            ? fileChildElement.src
                            : undefined,
                    ) ||
                    null
                  : fileElement instanceof HTMLObjectElement
                    ? fileElement.data || null
                    : null;

        if (urlString === null) {
            yield {element: fileElement, info: null};
            continue;
        }

        currentUrl ??= new URL(window.location.href);
        resourceServiceUrl ??= new URL(__RESOURCE_SERVICE_URL__, currentUrl);

        let url: URL;
        try {
            url = new URL(urlString, currentUrl);
        } catch {
            // Ignore any URL parsing errors.
            continue;
        }

        // Ignore non-HTTP protocols for now. It's probably reasonable to support `data://`
        // URLs at some point.
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            continue;
        }

        // If:
        //
        // 1. The file is hosted on the same domain we're currently on; AND
        // 2. The file matches the route `/files/:spaceId/:fileId`; AND
        // 3. The file is in the same space that we're in right now; AND
        // 4. The file element has a valid `data-cy-attached` attribute
        //
        // Then the file already exists for this space. Instead of uploading a new file to
        // our backend instead we can create a new attachment for the file that already
        // exists.
        if (url.origin === currentUrl.origin || url.origin === resourceServiceUrl.origin) {
            const pathnameMatch = url.pathname.match(/^\/files\/([^/]+)\/([^/]+)$/);
            if (
                pathnameMatch &&
                isId<SpaceId>(pathnameMatch[1]!) &&
                isId<FileId>(pathnameMatch[2]!) &&
                pathnameMatch[1] === getSpaceId()
            ) {
                const spaceId = pathnameMatch[1];
                const fileId = pathnameMatch[2];

                const targetString = fileElement.getAttribute("data-cy-attached");
                let target: FileAttachmentTarget | "Uploader" | undefined;

                try {
                    if (targetString) {
                        target =
                            targetString === "uploader"
                                ? "Uploader"
                                : deserializeFileAttachmentTargetString(targetString);
                    }
                } catch (error) {
                    // This error is almost imperceivable to the user since we'll try
                    // downloading/uploading the file as a fallback. But it might be a sign that
                    // there's a bug somewhere in `data-cy-attached` generation so let's log it.
                    scheduleUncaughtError(
                        InvalidArgumentError.from(
                            error,
                            "Couldn\u2019t parse `data-cy-attached` attribute",
                        ),
                    );
                }

                if (target) {
                    yield {
                        element: fileElement,
                        info: {
                            type: "AttachFile",
                            spaceId,
                            fileId,
                            target,
                        },
                    };
                    continue;
                }
            }
        }

        yield {
            element: fileElement,
            info: {
                type: "UploadFile",
                input: {type: "Url", url},
            },
        };
    }
}
