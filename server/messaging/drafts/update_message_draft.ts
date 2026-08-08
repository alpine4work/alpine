import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {MessageDraftsTable} from "~/server/messaging/drafts/internal/message_drafts_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {
    MessageDraftSurface,
    getMessageDraftSurfaceKey,
} from "~/shared/messaging/message_draft_surface.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

// Tolerate timestamps from clients up to 5 minutes ahead of our server
const draftVersionFutureToleranceMs = 1000 * 60 * 5;

export async function updateMessageDraft(
    context: ServerSessionActionContext,
    {
        spaceId,
        surface,
        content,
        parent,
        fileIds = emptyArray,
        version,
    }: {
        spaceId: SpaceId;
        surface: MessageDraftSurface;
        content: MessageContent;
        parent: MessageContentPayloadParent | null;
        fileIds?: ReadonlyArray<FileId | FileEntityId>;
        version: HybridLogicalTime;
    },
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId);

    const accountId = context.actor.getAccountId();
    const surfaceKey = getMessageDraftSurfaceKey(surface);

    if (version[0] - Date.now() > draftVersionFutureToleranceMs) {
        throw new InvalidArgumentError("Draft version timestamp is too far in the future");
    }

    await MessageDraftsTable.updateItem(
        context,
        {
            partitionType: "SpaceAccount",
            sortRangeType: "Draft",
            spaceId,
            accountId,
            surfaceKey,
        },
        item => {
            const existingVersion = item ? item.version : zeroHybridLogicalTime;
            if (compareHybridLogicalTimes(version, existingVersion) <= 0) {
                return item;
            }

            return {
                partitionType: "SpaceAccount" as const,
                sortRangeType: "Draft" as const,
                spaceId,
                accountId,
                surfaceKey,
                content,
                parent,
                fileIds,
                version,
                createdTime: item?.createdTime ?? new Date(),
            };
        },
        {withNoopUpdateLockVersionConditionCheck: true},
    );
}
