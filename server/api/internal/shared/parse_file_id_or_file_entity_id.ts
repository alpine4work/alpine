import {ApiMessageContentPayloadFile} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {FileId} from "~/shared/id/types/id_types.js";

/**
 * Extract a `FileId` or `FileEntityId` from an API message file wrapper.
 */
export function parseFileIdFromApiFileElement(
    file: ApiMessageContentPayloadFile,
): FileId | FileEntityId {
    switch (file.element.type) {
        case "File":
            return file.element.id;
        case "Preview":
            return previewTargetToFileEntityId(file.element.target);
        default:
            throw exhaustive(file.element);
    }
}

function previewTargetToFileEntityId(
    target: Extract<ApiMessageContentPayloadFile["element"], {type: "Preview"}>["target"],
): FileEntityId {
    switch (target.type) {
        case "Channel":
            return `Channel:${target.id}`;
        case "Chat":
            return `Chat:${target.id}`;
        case "Document":
            return `Document:${target.id}`;
        case "Post":
            return `Post:${target.id}`;
        case "Task":
            return `Task:${target.id}`;
        case "TaskCollection":
            return `TaskCollection:${target.id}`;
        default:
            throw exhaustive(target);
    }
}
