/**
 * Aspect ratio of letter paper. https://en.wikipedia.org/wiki/Letter_(paper_size)
 */
const letterPaperAspectRatio = 17 / 22;

/**
 * Get the height for a file entity preview (e.g. an embedded document, channel, or
 * task) based on the number of items in its row and the container width.
 *
 * - 1 file: `defaultPreviewHeight`.
 * - 2 files: midpoint between the 1-file and 3-file heights.
 * - 3 files: height that gives a letter paper aspect ratio for each third of the
 *   container width.
 */
export function getFileEntityPreviewHeight({
    fileCount,
    maxFileCount,
    blockWidth,
    defaultPreviewHeight,
    aspectRatio = letterPaperAspectRatio,
}: {
    fileCount: number;
    maxFileCount: number;
    blockWidth: number;
    defaultPreviewHeight: number;
    aspectRatio?: number;
}): number {
    const startHeight = defaultPreviewHeight;

    if (fileCount <= 1) {
        return startHeight;
    }

    const endHeight = blockWidth / maxFileCount / aspectRatio;

    if (fileCount <= 2) {
        return startHeight + (endHeight - startHeight) / 2;
    }

    return endHeight;
}
