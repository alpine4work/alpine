import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.open_source.js";

/**
 * Converts a per-mimetype files map into the `importer.uploaded` span data fields
 * with category breakdowns.
 *
 * Used by both the validation and conversion spans to emit consistent per-site
 * file metrics.
 */
export function buildSiteFileSpanData(
    files: ReadonlyMap<string, {readonly expectedCount: number; readonly size: number}>,
): NonNullable<TracerEventData["importer"]>["uploaded"] {
    let fileCount = 0;
    let fileTotalSize = 0;
    let imageCount = 0;
    let imageTotalSize = 0;
    let videoCount = 0;
    let videoTotalSize = 0;
    let audioCount = 0;
    let audioTotalSize = 0;

    for (const [contentType, stats] of files) {
        fileCount += stats.expectedCount;
        fileTotalSize += stats.size;

        if (contentType.startsWith("image/")) {
            imageCount += stats.expectedCount;
            imageTotalSize += stats.size;
        } else if (contentType.startsWith("video/")) {
            videoCount += stats.expectedCount;
            videoTotalSize += stats.size;
        } else if (contentType.startsWith("audio/")) {
            audioCount += stats.expectedCount;
            audioTotalSize += stats.size;
        }
    }

    return {
        fileCount,
        fileTotalSize,
        imageCount,
        imageTotalSize,
        videoCount,
        videoTotalSize,
        audioCount,
        audioTotalSize,
    };
}
