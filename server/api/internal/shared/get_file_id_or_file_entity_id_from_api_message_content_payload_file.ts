import {ApiMessageContentPayloadFileRequest} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Extract a `FileId` or `FileEntityId` from an API message file wrapper.
 */
export function getFileIdOrFileEntityIdFromApiMessageContentPayloadFile(
    file: ApiMessageContentPayloadFileRequest,
): FileId | FileEntityId {
    switch (file.element.type) {
        case "File":
            return file.element.file.id;
        case "Preview":
            return getFileEntityIdFromApiMessageContentPayloadFile(file.element.reference);
        default:
            throw exhaustive(file.element);
    }
}

function getFileEntityIdFromApiMessageContentPayloadFile(
    reference: Extract<
        ApiMessageContentPayloadFileRequest["element"],
        {type: "Preview"}
    >["reference"],
): FileEntityId {
    switch (reference.type) {
        case "Channel":
            return `Channel:${reference.id}`;
        case "Chat":
            return `Chat:${reference.id}`;
        case "Document":
            return `Document:${reference.id}`;
        case "Post":
            return `Post:${reference.id}`;
        case "Task":
            return `Task:${reference.id}`;
        case "TaskCollection":
            return `TaskCollection:${reference.id}`;
        case "Site":
            return `Site:${reference.id}`;
        default:
            throw exhaustive(reference);
    }
}
