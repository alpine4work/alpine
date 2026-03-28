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
        case "Channel":
        case "Document":
        case "Task":
        case "TaskCollection": {
            return target;
        }
        case "Chat": {
            return {
                type: "ChatMessages",
                id: target.id,
                preview: {
                    type: "Title",
                    title: target.title,
                },
            };
        }
        case "ChatMessage": {
            return {
                type: "ChatMessages",
                id: target.id,
                preview: {
                    type: "Message",
                    index: target.index,
                    authorShortName: target.author.shortName,
                    bodySnippet: flatBodyMatch(target.bodyMatch),
                },
            };
        }
        case "DocumentMessage": {
            return {
                type: "DocumentMessages",
                id: target.id,
                threadId: target.threadId,
                preview: {
                    index: target.index,
                    authorShortName: target.author.shortName,
                    bodySnippet: flatBodyMatch(target.bodyMatch),
                },
            };
        }
        case "Post": {
            return {
                type: "PostMessages",
                id: target.id,
                preview: {
                    type: "Title",
                    title: target.title,
                },
            };
        }
        case "PostMessage": {
            return {
                type: "PostMessages",
                id: target.id,
                preview: {
                    type: "Message",
                    index: target.index,
                    authorShortName: target.author.shortName,
                    bodySnippet: flatBodyMatch(target.bodyMatch),
                },
            };
        }
        case "TaskMessage": {
            return {
                type: "TaskMessages",
                id: target.id,
                preview: {
                    index: target.index,
                    authorShortName: target.author.shortName,
                    bodySnippet: flatBodyMatch(target.bodyMatch),
                },
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
