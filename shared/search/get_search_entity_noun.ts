import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SearchDynamicEntityType} from "~/shared/search/search_entity_id.js";

/**
 * Get a user friendly noun for the search entity.
 */
export function getSearchEntityNoun(type: SearchDynamicEntityType): string {
    switch (type) {
        case "Account":
            return "person";
        case "Document":
            return "document";
        case "DocumentComment":
            return "document comment";
        case "Channel":
            return "channel";
        case "Chat":
            return "chat";
        case "ChatMessage":
            return "chat message";
        case "Task":
            return "task";
        case "TaskCollection":
            return "task collection";
        case "TaskComment":
            return "task comment";
        case "Post":
            return "post";
        case "PostComment":
            return "post comment";
        default:
            throw exhaustive(type);
    }
}
