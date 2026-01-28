import {ApiMentionTarget} from "~/shared/api/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function getApiMentionTargetNoun(
    type: Exclude<ApiMentionTarget["type"], "Account">,
): string {
    switch (type) {
        case "Channel":
            return "channel";
        case "Document":
            return "document";
        case "Post":
            return "post";
        case "Task":
            return "task";
        case "TaskCollection":
            return "task collection";
        default:
            throw exhaustive(type);
    }
}
