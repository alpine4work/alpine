import {ApiContentMentionInlineElementTargetPathObject} from "~/server/api/markdown/parse_api_content_mention_inline_element_target_path.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function getApiContentMentionInlineElementTargetPathNoun(
    type: Exclude<ApiContentMentionInlineElementTargetPathObject["type"], "Account">,
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
