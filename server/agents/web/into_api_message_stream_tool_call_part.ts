import {AgentWebPageLinkKeyObject} from "~/server/agents/web/agent_web_page_link_key.open_source.js";
import {createAgentWebPageLinkUrl} from "~/server/agents/web/create_agent_web_page_link_url.open_source.js";
import {agentToolAnnotations} from "~/shared/agents/agent_tool_annotations.js";
import {
    ApiLabelContent,
    ApiMentionReference,
    ApiMessageStreamToolCallPartPayloadCall,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

type AgentWebToolCall =
    | {readonly type: "Read"; readonly pageLink: AgentWebPageLinkKeyObject}
    | {readonly type: "Search"; readonly query: string}
    | {readonly type: "Create"; readonly pageLink: AgentWebPageLinkKeyObject}
    | {readonly type: "Update"; readonly pageLink: AgentWebPageLinkKeyObject};

/**
 * Creates the content shown in a message stream for an Alpine agent tool call.
 */
// TODO(#agent-thinking-summary): We should strive toward better tool call
// summaries. One day, we should do things like push the summary before we call the
// toolwith something like "Updating <document>" and then once the tool call
// completes, we should update the `content` to say something like "Updated
// <document>" or "Couldn't update <document>."
export function intoApiMessageStreamToolCallPart(
    toolCall: AgentWebToolCall,
): ApiMessageStreamToolCallPartPayloadCall | null {
    switch (toolCall.type) {
        case "Read": {
            const content = intoReadContent(toolCall.pageLink);
            return content === null
                ? null
                : {
                      content,
                      annotations: agentToolAnnotations.read,
                  };
        }
        case "Search": {
            return {
                content: {
                    elements: [{type: "Text", text: `Searching \u201C${toolCall.query}\u201D`}],
                },
                annotations: agentToolAnnotations.search,
            };
        }
        case "Create": {
            return {
                content: intoCreateContent(toolCall.pageLink),
                annotations: agentToolAnnotations.create,
            };
        }
        case "Update": {
            const content = intoUpdateContent(toolCall.pageLink);
            return content === null ? null : {content, annotations: agentToolAnnotations.update};
        }
        default:
            throw exhaustive(toolCall);
    }
}

function intoReadContent(pageLink: AgentWebPageLinkKeyObject): ApiLabelContent | null {
    switch (pageLink.type) {
        case "Account":
        case "Channel":
        case "Chat":
        case "Document":
        case "Post":
        case "Site":
        case "Task":
        case "TaskCollection": {
            return {
                elements: [
                    {type: "Text", text: "Reading "},
                    {type: "Mention", reference: pageLink},
                ],
            };
        }
        case "TaskMessageList": {
            return {
                elements: [
                    {type: "Text", text: "Reading comments on "},
                    {type: "Mention", reference: pageLink.task},
                ],
            };
        }
        case "TaskSubtasks": {
            return {
                elements: [
                    {type: "Text", text: "Reading subtasks for "},
                    {type: "Mention", reference: pageLink.task},
                ],
            };
        }
        case "ChatMessage": {
            return intoLinkedReadContent({
                reference: {type: "Chat", id: pageLink.id},
                label: "chat message",
                preposition: "in",
                url: createAgentWebPageLinkUrl(pageLink),
            });
        }
        case "DocumentMessage": {
            return intoLinkedReadContent({
                reference: pageLink.document,
                label: "comment",
                preposition: "on",
                url: createAgentWebPageLinkUrl(pageLink),
            });
        }
        case "DocumentThread": {
            return intoLinkedReadContent({
                reference: pageLink.document,
                label: "comment thread",
                preposition: "on",
                url: createAgentWebPageLinkUrl(pageLink),
            });
        }
        case "PostMessage": {
            return intoLinkedReadContent({
                reference: {type: "Post", id: pageLink.id},
                label: "comment",
                preposition: "on",
                url: createAgentWebPageLinkUrl(pageLink),
            });
        }
        case "TaskMessage": {
            return intoLinkedReadContent({
                reference: {type: "Task", id: pageLink.id},
                label: "comment",
                preposition: "on",
                url: createAgentWebPageLinkUrl(pageLink),
            });
        }
        case "Inbox": {
            return {
                elements: [
                    {type: "Text", text: "Reading the inbox for "},
                    {type: "Mention", reference: pageLink.account},
                ],
            };
        }
        case "MyAccount":
            return {elements: [{type: "Text", text: "Reading my account"}]};
        case "Skill":
            // TODO(#agent-web): Follow up to make sure that `pageLink.path` makes sense here.
            // We may have to parse the name from the path.
            return {
                elements: [{type: "Text", text: `Reading the \u201C${pageLink.path}\u201D skill`}],
            };
        case "File":
            return {elements: [{type: "Text", text: "Reading a file"}]};
        case "Space":
        case "TaskView":
            // TODO(#agent-web): Tool call part for everything that agent can read.
            return null;
        default:
            throw exhaustive(pageLink);
    }
}

function intoLinkedReadContent({
    reference,
    label,
    preposition,
    url,
}: {
    readonly reference: ApiMentionReference;
    readonly label: string;
    readonly preposition: string;
    readonly url: string;
}): ApiLabelContent {
    return {
        elements: [
            {type: "Text", text: "Reading "},
            {type: "Text", text: label, marks: [{type: "Link", url}]},
            {type: "Text", text: ` ${preposition} `},
            {type: "Mention", reference},
        ],
    };
}

function intoCreateContent(pageLink: AgentWebPageLinkKeyObject): ApiLabelContent {
    switch (pageLink.type) {
        case "Document":
        case "Post":
        case "Task":
        case "TaskCollection":
        case "Channel":
        case "Chat":
        case "Site": {
            return {
                elements: [
                    {type: "Text", text: "Created "},
                    {type: "Mention", reference: pageLink},
                    {type: "Text", text: "."},
                ],
            };
        }
        case "DocumentThread": {
            const url = createAgentWebPageLinkUrl(pageLink);
            return {
                elements: [
                    {type: "Text", text: "Added "},
                    {type: "Text", text: "a new comment", marks: [{type: "Link", url}]},
                    {type: "Text", text: " to "},
                    {type: "Mention", reference: pageLink.document},
                    {type: "Text", text: "."},
                ],
            };
        }
        case "Account":
        case "ChatMessage":
        case "DocumentMessage":
        case "File":
        case "Inbox":
        case "MyAccount":
        case "PostMessage":
        case "Skill":
        case "TaskMessage":
        case "TaskMessageList":
        case "TaskSubtasks":
        case "TaskView":
        case "Space":
            throw new InvalidArgumentError(`Agents can\u2019t create content for ${pageLink.type}`);
        default:
            throw exhaustive(pageLink);
    }
}

// TODO(#agent-thinking-summary): For some of the pdates, it'd be cool if we could
// get more specific in the summary. For example, it'd be nice if we could say
// something like "Responded to message in <thread>" with link to message or
// "Updated <message>" with link to message. Other examples
//
// - Link to the document version UI when document is updated
// - Changed name/description of channel
// - Changed name of chat room
function intoUpdateContent(pageLink: AgentWebPageLinkKeyObject): ApiLabelContent | null {
    switch (pageLink.type) {
        case "Document":
        case "Post":
        case "Task":
        case "TaskCollection":
        case "Channel":
        case "Chat":
        case "Site": {
            return {
                elements: [
                    {type: "Text", text: "Updated "},
                    {type: "Mention", reference: pageLink},
                    {type: "Text", text: "."},
                ],
            };
        }
        case "TaskMessageList": {
            return {
                elements: [
                    {type: "Text", text: "Updated "},
                    {type: "Mention", reference: pageLink.task},
                    {type: "Text", text: " comments."},
                ],
            };
        }
        case "DocumentThread": {
            return intoLinkedUpdateContent(
                pageLink.document,
                "comment thread",
                createAgentWebPageLinkUrl(pageLink),
            );
        }
        case "TaskSubtasks": {
            return intoLinkedUpdateContent(
                pageLink.task,
                "subtasks",
                createAgentWebPageLinkUrl(pageLink),
            );
        }
        case "ChatMessage": {
            return intoLinkedUpdateContent(
                {type: "Chat", id: pageLink.id},
                "chat message",
                createAgentWebPageLinkUrl(pageLink),
            );
        }
        case "DocumentMessage": {
            return intoLinkedUpdateContent(
                pageLink.document,
                "document message",
                createAgentWebPageLinkUrl(pageLink),
            );
        }
        case "PostMessage": {
            return intoLinkedUpdateContent(
                {type: "Post", id: pageLink.id},
                "post message",
                createAgentWebPageLinkUrl(pageLink),
            );
        }
        case "TaskMessage": {
            return intoLinkedUpdateContent(
                {type: "Task", id: pageLink.id},
                "task message",
                createAgentWebPageLinkUrl(pageLink),
            );
        }
        case "Account":
        case "File":
        case "Inbox":
        case "MyAccount":
        case "Skill":
        case "TaskView":
        case "Space":
            return null;
        default:
            throw exhaustive(pageLink);
    }
}

function intoLinkedUpdateContent(
    reference: ApiMentionReference,
    label: string,
    url: string,
): ApiLabelContent {
    return {
        elements: [
            {type: "Text", text: "Updated "},
            {type: "Mention", reference},
            {type: "Text", text: " "},
            {type: "Text", text: label, marks: [{type: "Link", url}]},
            {type: "Text", text: "."},
        ],
    };
}
