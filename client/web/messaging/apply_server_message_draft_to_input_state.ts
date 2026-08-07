import {MessageInputFile} from "~/client/web/content/messaging/add_message_input_files.js";
import {createMessageInputFilesFromMessageDraft} from "~/client/web/content/messaging/create_message_input_files_from_message_draft.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {createInitialMessageInputState} from "~/client/web/messaging/create_initial_message_input_state.js";
import {hasMessageInputContent} from "~/client/web/messaging/has_message_input_content.js";
import {MessageInputDraftSyncState} from "~/client/web/messaging/message_input_draft_sync_state.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {MessageDraft, MessageDraftWithFiles} from "~/shared/messaging/message_draft_schema.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

/**
 * The action to take when applying a server message draft to a message input's
 * state.
 *
 * LocalWins: The local draft is ahead of the server draft, so don't apply anything
 * from the server draft.
 *
 * ApplyFiles: The server draft has files that should be applied, but don't
 * overwrite any local content.
 *
 * Apply: The server draft has content and possibly files and/or a reply target
 * that should be applied to the input. `<MessageInput>` applies `parentToApply` at
 * most once per draft surface, so a draft can't re-apply a reply target the user
 * has since cleared.
 */
export type ApplyServerMessageDraftToInputStateResult =
    | {
          type: "LocalWins";
          draftSyncState: MessageInputDraftSyncState;
      }
    | {
          type: "ApplyFiles";
          files: ReadonlyArray<MessageInputFile>;
          draftSyncState: MessageInputDraftSyncState;
      }
    | {
          type: "Apply";
          state: ContentEditorState<MessageContentWithReferences>;
          files: ReadonlyArray<MessageInputFile>;
          parentToApply: MessageContentPayloadParent | null;
          draftSyncState: MessageInputDraftSyncState;
      };

function createDraftSyncStateForServerDraft(
    serverDraft: MessageDraft | MessageDraftWithFiles,
    resolvedState: ContentEditorState<MessageContentWithReferences>,
): MessageInputDraftSyncState {
    return {
        lastDraftSent: {
            state: resolvedState,
            parent: serverDraft.parent,
            fileIds: serverDraft.fileIds,
        },
        hasRemoteDraftContent: hasMessageInputContent({
            contentDoc: serverDraft.content.doc,
            parent: serverDraft.parent,
            fileIds: serverDraft.fileIds,
        }),
    };
}

/**
 * Applies a server draft to `<MessageInput>` state, respecting any local edits
 * that are already ahead of the server copy.
 */
export function applyServerMessageDraftToInputState({
    serverDraft,
    spaceId,
    currentState,
    currentParent,
    currentFileIds,
}: {
    serverDraft: MessageDraft | MessageDraftWithFiles;
    spaceId: SpaceId;
    currentState: ContentEditorState<MessageContentWithReferences>;
    currentParent: MessageContentPayloadParent | null;
    currentFileIds: ReadonlyArray<FileId | FileEntityId>;
}): ApplyServerMessageDraftToInputStateResult {
    const hasLocalDraftContent = hasMessageInputContent({
        contentDoc: currentState.getDoc(),
        parent: currentParent,
        fileIds: currentFileIds,
    });

    if (hasLocalDraftContent) {
        const draftSyncState: MessageInputDraftSyncState = {
            lastDraftSent: null,
            hasRemoteDraftContent: hasMessageInputContent({
                contentDoc: serverDraft.content.doc,
                parent: serverDraft.parent,
                fileIds: serverDraft.fileIds,
            }),
        };

        // Completing a draft's late file hydration isn't a content conflict. If the input
        // shows no files yet but the draft now has hydrated ones (for example a lite draft
        // whose files loaded after its text was applied at mount) add them without
        // disturbing the local text. `lastDraftSent` stays null so a local text edit is
        // still saved; the trade-off is one redundant save when the text is unchanged.
        if (currentFileIds.length === 0) {
            const files = createMessageInputFilesFromMessageDraft(serverDraft);
            if (files.length > 0) return {type: "ApplyFiles", files, draftSyncState};
        }

        return {type: "LocalWins", draftSyncState};
    }

    const newState = isContentEmpty(serverDraft.content.doc)
        ? null
        : createInitialMessageInputState({spaceId, draft: serverDraft});

    const resolvedState = newState ?? currentState;

    return {
        type: "Apply",
        state: resolvedState,
        files: createMessageInputFilesFromMessageDraft(serverDraft),
        parentToApply: serverDraft.parent,
        draftSyncState: createDraftSyncStateForServerDraft(serverDraft, resolvedState),
    };
}
