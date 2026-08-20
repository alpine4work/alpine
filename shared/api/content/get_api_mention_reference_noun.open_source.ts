import {ApiMentionReferenceRequest} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export function getApiMentionReferenceNoun(
    type: Exclude<ApiMentionReferenceRequest["type"], "Account">,
): string {
    switch (type) {
        case "Channel":
            return "channel";
        case "Chat":
            return "chat";
        case "Document":
            return "document";
        case "Post":
            return "post";
        case "Task":
            return "task";
        case "TaskCollection":
            return "task collection";
        case "Site":
            return "site";
        default:
            throw exhaustive(type);
    }
}
