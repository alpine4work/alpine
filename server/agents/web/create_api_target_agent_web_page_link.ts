import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {
    ApiMentionTargetResponse,
    ApiSearchResult,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function createApiTargetAgentWebPageLink(
    target: ApiMentionTargetResponse | ApiSearchResult,
): AgentWebPageLink {
    switch (target.type) {
        case "Account":
        case "Chat":
        case "Channel":
        case "Document":
        case "Post":
        case "Task":
        case "TaskCollection": {
            return target;
        }
        case "ChatMessage": {
            return {
                type: "ChatMessage",
                id: target.id,
                index: target.index,
                authorShortName: target.author.shortName,
                bodySnippet: flatBodyMatch(target.bodyMatch),
            };
        }
        case "DocumentMessage": {
            return {
                type: "DocumentMessage",
                id: target.id,
                threadId: target.threadId,
                index: target.index,
                authorShortName: target.author.shortName,
                bodySnippet: flatBodyMatch(target.bodyMatch),
            };
        }
        case "PostMessage": {
            return {
                type: "PostMessage",
                id: target.id,
                index: target.index,
                authorShortName: target.author.shortName,
                bodySnippet: flatBodyMatch(target.bodyMatch),
            };
        }
        case "TaskMessage": {
            return {
                type: "TaskMessage",
                id: target.id,
                index: target.index,
                authorShortName: target.author.shortName,
                bodySnippet: flatBodyMatch(target.bodyMatch),
            };
        }
        default:
            throw exhaustive(target);
    }
}

function flatBodyMatch(bodyMatch: ReadonlyArray<{readonly text: string}>): string {
    let bodySnippet = "";
    for (const {text} of bodyMatch) bodySnippet += text;
    return bodySnippet;
}
