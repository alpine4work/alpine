import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.js";
import {
    ApiMentionReferenceResponse,
    ApiSearchResult,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function createApiReferenceAgentWebPageStoredLink(
    reference: ApiMentionReferenceResponse | ApiSearchResult,
): AgentWebPageStoredLink {
    switch (reference.type) {
        case "Account":
        case "Chat":
        case "Channel":
        case "Document":
        case "Post":
        case "Task":
        case "TaskCollection":
        case "Site": {
            return reference;
        }
        case "ChatMessage": {
            return {
                type: "ChatMessage",
                id: reference.id,
                index: reference.index,
                authorShortName: reference.author.shortName,
                bodySnippet: flatBodyMatch(reference.bodyMatch),
            };
        }
        case "DocumentMessage": {
            return {
                type: "DocumentMessage",
                id: reference.id,
                threadId: reference.threadId,
                index: reference.index,
                authorShortName: reference.author.shortName,
                bodySnippet: flatBodyMatch(reference.bodyMatch),
            };
        }
        case "PostMessage": {
            return {
                type: "PostMessage",
                id: reference.id,
                index: reference.index,
                authorShortName: reference.author.shortName,
                bodySnippet: flatBodyMatch(reference.bodyMatch),
            };
        }
        case "TaskMessage": {
            return {
                type: "TaskMessage",
                id: reference.id,
                index: reference.index,
                authorShortName: reference.author.shortName,
                bodySnippet: flatBodyMatch(reference.bodyMatch),
            };
        }
        default:
            throw exhaustive(reference);
    }
}

function flatBodyMatch(bodyMatch: ReadonlyArray<{readonly text: string}>): string {
    let bodySnippet = "";
    for (const {text} of bodyMatch) bodySnippet += text;
    return bodySnippet;
}
