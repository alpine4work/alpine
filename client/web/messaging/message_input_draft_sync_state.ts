import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

/**
 * Represents the state of the server-side message draft for a message input.
 */
export type MessageInputDraftSyncState = {
    /**
     * Content, files, and reply parent already reflected on the server. `null` when
     * local edits are ahead of the server copy.
     */
    lastDraftSent: {
        state: ContentEditorState<MessageContentWithReferences>;
        parent: MessageContentPayloadParent | null;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
    } | null;

    /**
     * Whether a non-empty draft row still exists on the server for this surface.
     */
    hasRemoteDraftContent: boolean;
};
