import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/content/message_content_schema.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {MessageDraft, MessageDraftWithFiles} from "~/shared/messaging/message_draft_schema.js";

/**
 * Creates the initial editor state for a `<MessageInput>`.
 *
 * If we already have a message draft (for example, it was prefetched before the
 * input mounted) we initialize with the draft's content directly with the
 * selection at the end of the content.
 */
export function createInitialMessageInputState({
    spaceId,
    draft = null,
}: {
    spaceId: SpaceId;
    draft?: MessageDraft | MessageDraftWithFiles | null;
}): ContentEditorState<MessageContentWithReferences> {
    if (draft) {
        return ContentEditorState.create({
            spaceId,
            content: draft.content,
            selection: "end",
        });
    }

    return ContentEditorState.create({
        spaceId,
        content: emptyMessageContentWithReferences,
    });
}
