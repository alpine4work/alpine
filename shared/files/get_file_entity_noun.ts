import {FileEntityIdObject} from "~/shared/files/file_entity_id.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Get a user friendly, English, noun for the file entity.
 */
export function getFileEntityNoun(type: FileEntityIdObject["type"]): string {
    switch (type) {
        case "Document":
            return "document";
        case "Task":
            return "task";
        case "TaskCollection":
            return "task collection";
        case "Channel":
            return "channel";
        case "Chat":
            return "chat";
        case "Post":
            return "post";
        case "Site":
            return "site";
        default:
            throw exhaustive(type);
    }
}

/**
 * Get a user friendly, English, noun for the file entity. This noun is capitalized
 * so you can use it at the start of a sentence (following English formatting
 * rules). Unlike `getFileEntityNoun()` which returns the file entity noun in
 * lowercase.
 */
export function getFileEntityStartOfSentenceNoun(type: FileEntityIdObject["type"]): string {
    switch (type) {
        case "Document":
            return "Document";
        case "Task":
            return "Task";
        case "TaskCollection":
            return "Task collection";
        case "Channel":
            return "Channel";
        case "Chat":
            return "Chat";
        case "Post":
            return "Post";
        case "Site":
            return "Site";
        default:
            throw exhaustive(type);
    }
}
