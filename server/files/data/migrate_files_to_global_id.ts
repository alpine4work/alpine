import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {FilesTable} from "~/server/files/data/internal/files_table.js";

/**
 * Backfills file records and attachment targets from the old schema into the new
 * "File2" partition.
 *
 * ### What it migrates
 *
 * 1. File metadata: scanned from old "Space"/"File" sort range (keyed by
 *    `spaceId` + `fileId`) and written to "File2"/"Attributes" (keyed by `fileId`
 *    only, with `spaceId` as a regular attribute).
 *
 * 2. Attachment targets: scanned from old "File" partition (keyed by `spaceId` +
 *    `fileId`) and written to "File2" partition (keyed by `fileId` only) with the
 *    same sort range type and attributes.
 *
 * File metadata uses `createItemIfNoneExists` so that if the item was already
 * dual-written by the application (at a higher `updateLockVersion`) we don't
 * overwrite it. Attachment targets use `createOrReplaceItem` since they are never
 * updated after creation.
 */
export async function runMigrateFilesToGlobalPartitionMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    for await (const item of FilesTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [
            {partitionType: "Space", sortRangeType: "File"},
            {partitionType: "File", sortRangeType: "ChatMessagesAttachmentTarget"},
            {partitionType: "File", sortRangeType: "DocumentAttachmentTarget"},
            {partitionType: "File", sortRangeType: "DocumentCommentsAttachmentTarget"},
            {partitionType: "File", sortRangeType: "PostAttachmentTarget"},
            {partitionType: "File", sortRangeType: "PostDraftAttachmentTarget"},
            {partitionType: "File", sortRangeType: "PostCommentsAttachmentTarget"},
            {partitionType: "File", sortRangeType: "TaskNotesAttachmentTarget"},
            {partitionType: "File", sortRangeType: "TaskCommentsAttachmentTarget"},
        ],
    })) {
        if (item.partitionType === "Space" && item.sortRangeType === "File") {
            await FilesTable.createItemIfNoneExists(context, {
                partitionType: "File2",
                sortRangeType: "Attributes",
                fileId: item.fileId,
                spaceId: item.spaceId,
                contentType: item.contentType,
                contentLength: item.contentLength,
                uploaderId: item.uploaderId,
                isUploading: item.isUploading,
                alternative: item.alternative,
                analysis: null,
                hasProcessedNullAlternative: item.hasProcessedNullAlternative,
                preview: item.preview,
                transcript: null,
            });
        } else if (item.partitionType === "File") {
            // Write to File2 with the same sort range type, dropping spaceId from the
            // partition key.
            const {spaceId: _spaceId, ...rest} = item;
            await FilesTable.createOrReplaceItem(context, {
                ...rest,
                partitionType: "File2",
            } as any);
        }
    }
}
