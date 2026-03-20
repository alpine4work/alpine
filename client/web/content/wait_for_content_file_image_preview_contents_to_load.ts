import {internalWaitForContentFileImagePreviewContentsToLoad} from "~/client/web/content/internal/content_file_preview.js";

/**
 * If there are any images mounted and waiting to load then this promise will
 * resolve only after all those images have finished loading.
 */
export const waitForContentFileImagePreviewContentsToLoad =
    internalWaitForContentFileImagePreviewContentsToLoad;
