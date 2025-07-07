import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SearchMentionEntityType} from "~/shared/search/search_entity_id.js";

/**
 * Get a user friendly noun for the search entity.
 */
export function getSearchEntityNoun(type: SearchMentionEntityType): string {
    switch (type) {
        case "Document":
            return "document";
        case "Channel":
            return "channel";
        case "Task":
            return "task";
        case "TaskCollection":
            return "task collection";
        case "Post":
            return "post";
        default:
            throw exhaustive(type);
    }
}
