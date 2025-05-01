import {FileEntityIdObject} from "~/shared/files/file_entity_id.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Get a user friendly noun for the file entity.
 */
export function getFileEntityNoun(type: FileEntityIdObject["type"]): string {
    switch (type) {
        case "Document":
            return "document";
        case "TaskCollection":
            return "task collection";
        case "Channel":
            return "channel";
        default:
            throw exhaustive(type);
    }
}
