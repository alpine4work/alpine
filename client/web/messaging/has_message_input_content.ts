import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

/**
 * Whether a message input snapshot has content worth persisting or restoring:
 * non-empty editor content, a reply target, or attached files.
 */
export function hasMessageInputContent({
    contentDoc,
    parent,
    fileIds = emptyArray,
}: {
    contentDoc: MessageContentWithReferences["doc"];
    parent: MessageContentPayloadParent | null;
    fileIds?: ReadonlyArray<FileId | FileEntityId>;
}): boolean {
    return !isContentEmpty(contentDoc) || parent !== null || fileIds.length > 0;
}
