import {RefObject} from "react";
import {MessageInputFile} from "~/client/web/content/messaging/add_message_input_files.js";
import {createMessageInputFilesFromMessageDraft} from "~/client/web/content/messaging/create_message_input_files_from_message_draft.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {createInitialMessageInputState} from "~/client/web/messaging/create_initial_message_input_state.js";
import {hasMessageInputContent} from "~/client/web/messaging/has_message_input_content.js";
import {MessageInputDraftSyncState} from "~/client/web/messaging/message_input_draft_sync_state.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {MessageDraft, MessageDraftWithFiles} from "~/shared/messaging/message_draft_schema.js";

/**
 * Resolves a `<MessageInput>`'s initial editor state on mount from an optional
 * restore stash or an already loaded server message draft, preferring the restore
 * stash if present.
 *
 * Call this once at mount (for example, from a `useState()` initializer) so the
 * draft's converted files — whose attachment targets are `Memo`-branded — are
 * created once and stay referentially stable for the input's lifetime.
 */
export function resolveInitialMessageInputState({
    spaceId,
    draft,
    restoreStateRef,
}: {
    spaceId: SpaceId;
    draft?: MessageDraft | MessageDraftWithFiles;
    restoreStateRef?: RefObject<{
        state: ContentEditorState<MessageContentWithReferences>;
        files: ReadonlyArray<MessageInputFile>;
        isFocused: boolean;
    } | null>;
}): {
    state: ContentEditorState<MessageContentWithReferences>;
    files: ReadonlyArray<MessageInputFile>;
    draftSyncState: MessageInputDraftSyncState | null;
} {
    const restoreState = restoreStateRef?.current;
    if (restoreState) {
        return {
            state: restoreState.state,
            files: restoreState.files,
            draftSyncState: {
                lastDraftSent: null,
                // `draft` may be stale, but treating a possibly-cleared server row as existing is
                // safe: at worst the input issues one redundant clear.
                hasRemoteDraftContent: draft
                    ? hasMessageInputContent({
                          contentDoc: draft.content.doc,
                          parent: draft.parent,
                          fileIds: draft.fileIds,
                      })
                    : false,
            },
        };
    }

    if (draft) {
        const state = createInitialMessageInputState({spaceId, draft});

        return {
            state,
            files: createMessageInputFilesFromMessageDraft(draft),
            draftSyncState: {
                lastDraftSent: {
                    state,
                    parent: draft.parent,
                    fileIds: draft.fileIds,
                },
                hasRemoteDraftContent: hasMessageInputContent({
                    contentDoc: draft.content.doc,
                    parent: draft.parent,
                    fileIds: draft.fileIds,
                }),
            },
        };
    }

    return {
        state: createInitialMessageInputState({spaceId}),
        files: emptyArray,
        draftSyncState: null,
    };
}
