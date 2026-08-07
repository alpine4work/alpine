import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {MessageDraftsTable} from "~/server/messaging/drafts/internal/message_drafts_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {
    MessageDraftSurface,
    getMessageDraftSurfaceKey,
} from "~/shared/messaging/message_draft_surface.js";

/**
 * Deletes a message draft item permanently if one exists.
 */
export async function clearMessageDraft(
    context: ServerSessionActionContext,
    {spaceId, surface}: {spaceId: SpaceId; surface: MessageDraftSurface},
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId);

    await MessageDraftsTable.deleteItemWithKeyIfExists(context, {
        partitionType: "SpaceAccount",
        sortRangeType: "Draft",
        spaceId,
        accountId: context.actor.getAccountId(),
        surfaceKey: getMessageDraftSurfaceKey(surface),
    });
}
