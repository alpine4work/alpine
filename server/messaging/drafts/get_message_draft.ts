import {getMessageContentReferencesForNode} from "~/server/content/get_content_references.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getMessageDraftFiles} from "~/server/messaging/drafts/get_message_draft_files.js";
import {MessageDraftsTable} from "~/server/messaging/drafts/internal/message_drafts_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    MessageDraftWithFiles,
    emptyMessageDraftWithFiles,
} from "~/shared/messaging/message_draft_schema.js";
import {
    MessageDraftSurface,
    getMessageDraftSurfaceKey,
} from "~/shared/messaging/message_draft_surface.js";

/**
 * Loads a message draft for a surface, hydrating any stored file ids into file
 * models the client can render immediately.
 */
export async function getMessageDraft(
    context: ServerSessionActionContext,
    {
        spaceId,
        surface,
        withAttachFileBeforeCreateMessage = false,
    }: {
        spaceId: SpaceId;
        surface: MessageDraftSurface;
        withAttachFileBeforeCreateMessage?: boolean;
    },
): Promise<MessageDraftWithFiles> {
    await authorizeSpaceAccess(context, spaceId);

    const item = await MessageDraftsTable.getItemIfExists(context, {
        partitionType: "SpaceAccount",
        sortRangeType: "Draft",
        spaceId,
        accountId: context.actor.getAccountId(),
        surfaceKey: getMessageDraftSurfaceKey(surface),
    });

    if (!item) {
        return emptyMessageDraftWithFiles;
    }

    const [references, files] = await runAllPromises([
        getMessageContentReferencesForNode(context, spaceId, item.content),
        getMessageDraftFiles(context, {
            spaceId,
            surface,
            fileIds: item.fileIds,
            withAttachFileBeforeCreateMessage,
        }),
    ]);

    return {
        content: {
            doc: item.content,
            references,
        },
        parent: item.parent,
        fileIds: item.fileIds,
        files,
        version: item.version,
    };
}
