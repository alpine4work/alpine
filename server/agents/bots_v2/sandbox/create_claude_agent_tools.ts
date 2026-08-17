import {createSdkMcpServer, tool} from "@anthropic-ai/claude-agent-sdk";
import {z} from "zod";
import {AgentWebMessageStreamSession} from "~/server/agents/bots_v2/sandbox/agent_web_message_stream_session.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {
    AgentWebPageLinkKey,
    AgentWebPageLinkKeyObject,
    printAgentWebPageLinkKey,
} from "~/server/agents/web/agent_web_page_link_key.open_source.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.open_source.js";
import {callAgentWebDeleteTool} from "~/server/agents/web/call_agent_web_delete_tool.js";
import {callAgentWebFindTool} from "~/server/agents/web/call_agent_web_find_tool.open_source.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {callAgentWebScrollTool} from "~/server/agents/web/call_agent_web_scroll_tool.open_source.js";
import {
    callAgentWebSearchTool,
    defaultAgentWebSearchResultLimit,
} from "~/server/agents/web/call_agent_web_search_tool.open_source.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.open_source.js";
import {
    agentWebBytesDefaultLimit,
    agentWebBytesFindDefaultLimit,
    agentWebBytesFindDefaultMatchLimit,
} from "~/server/agents/web/default_agent_web_bytes_limit.open_source.js";
import {isFileCodeContentType} from "~/shared/files/file_content_type.open_source.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export function createClaudeAgentMcpServer(
    getContext: () => AgentWebContext,
    messageRef: {current: AgentWebMessageStreamSession | null},
) {
    let lastReadWebPageLinkKey: AgentWebPageLinkKey | null = null;

    const pushReadPageLinkToolCall = (pageLink: AgentWebPageLinkKeyObject) => {
        if (!messageRef.current) return;

        const pageLinkKey = printAgentWebPageLinkKey(pageLink);

        // Don't emit a read tool call for the same page twice in a row.
        if (lastReadWebPageLinkKey === pageLinkKey) return;
        lastReadWebPageLinkKey = pageLinkKey;

        switch (pageLink.type) {
            case "Account":
            case "Channel":
            case "Chat":
            case "Document":
            case "Post":
            case "Task":
            case "TaskCollection":
            case "Site": {
                messageRef.current.pushToolCall(getContext().span, {
                    type: "Read",
                    reference: pageLink,
                });
                break;
            }
            case "ChatMessage":
                pushReadPageLinkToolCall({...pageLink, type: "Chat"});
                break;
            case "DocumentThread":
            case "DocumentMessage":
                pushReadPageLinkToolCall(pageLink.document);
                break;
            case "PostMessage":
                pushReadPageLinkToolCall({...pageLink, type: "Post"});
                break;
            case "TaskMessage":
                pushReadPageLinkToolCall({...pageLink, type: "Task"});
                break;
            case "TaskMessageList":
            case "TaskSubtasks":
                pushReadPageLinkToolCall(pageLink.task);
                break;
            case "File":
            case "Skill":
            case "Inbox":
            case "Space":
            case "MyAccount":
            case "TaskView":
                // TODO: Tool call for everything you can read!
                break;
            default:
                throw exhaustive(pageLink);
        }
    };

    const readTool = tool(
        "read",
        "Read any page",
        {
            path: z.string().describe("Path to something in Alpine (e.g. `/doc/hello-world`)"),
            limit: z
                .string()
                .default(agentWebBytesDefaultLimit)
                .describe(`How much to read (in bytes, e.g. ${agentWebBytesDefaultLimit})`),
        },
        async args => {
            const context = getContext();

            const result = await callAgentWebReadTool(context, args);

            if (!result.isError) {
                pushReadPageLinkToolCall(result.pageLink);
            }

            if (result.response.type === "String") {
                return {
                    isError: result.isError,
                    content: [{type: "text", text: result.response.string}],
                };
            }

            switch (result.response.contentType) {
                // Claude supported image types:
                // https://platform.claude.com/docs/en/build-with-claude/vision#supported-formats
                case "image/jpeg":
                case "image/png":
                case "image/gif":
                case "image/webp": {
                    const content = await result.response.fetch(async (stream, response) => {
                        const buffer = await response.arrayBuffer();
                        return encodeBase64(new Uint8Array(buffer));
                    });

                    return {
                        content: [
                            {
                                type: "image",
                                mimeType: result.response.contentType,
                                data: content,
                            },
                        ],
                    };
                }

                // All other file types can be attached as resources:
                // https://code.claude.com/docs/en/agent-sdk/custom-tools#resources
                default: {
                    // The two supported path formats right now for the `read` tool are
                    // `/file/demo-image.png` style paths and `https://` style paths. The `https://`
                    // version is already a valid URI.
                    const uri = args.path.startsWith("/") ? `alpine:/${args.path}` : args.path;

                    // Code formats are text based and so we can provide them as text instead of
                    // binary. Which hopefully helps Claude understand the file better.
                    if (isFileCodeContentType(result.response.contentType)) {
                        const content = await result.response.fetch(async (stream, response) => {
                            return await response.text();
                        });

                        return {
                            content: [
                                {
                                    type: "resource",
                                    resource: {
                                        uri,
                                        mimeType: result.response.contentType,
                                        text: content,
                                    },
                                },
                            ],
                        };
                    } else {
                        const content = await result.response.fetch(async (stream, response) => {
                            const buffer = await response.arrayBuffer();
                            return encodeBase64(new Uint8Array(buffer));
                        });

                        return {
                            content: [
                                {
                                    type: "resource",
                                    resource: {
                                        uri,
                                        mimeType: result.response.contentType,
                                        blob: content,
                                    },
                                },
                            ],
                        };
                    }
                }
            }
        },
        {
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
    );

    const updateTool = tool(
        "update",
        "Update any page",
        {
            path: z.string().describe("Path to something in Alpine (e.g. `/doc/hello-world`)"),
            updates: z.array(
                z.object({
                    old: z.string().describe("Old content to remove"),
                    new: z.string().describe("New content to insert"),
                    replaceAll: z
                        .boolean()
                        .default(false)
                        .describe("Should be false 99.9% of the time"),
                }),
            ),
        },
        async args => {
            const {isError, response} = await callAgentWebUpdateTool(getContext(), args);

            return {isError, content: [{type: "text", text: response}]};
        },
        {
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
    );

    const createTool = tool(
        "create",
        "Create a new page",
        {
            type: z.string().describe("Type of thing are we creating (e.g. `document`)"),
            content: z.string().describe("Contents of the new page"),
        },
        async args => {
            const context = getContext();

            const result = await callAgentWebCreateTool(context, args);

            // TODO: Tool call for everything you can create!
            if (
                !result.isError &&
                (result.pageLink.type === "Document" ||
                    result.pageLink.type === "Post" ||
                    result.pageLink.type === "Task" ||
                    result.pageLink.type === "TaskCollection")
            ) {
                messageRef.current?.pushToolCall(context.span, {
                    type: "Create",
                    reference: result.pageLink,
                });
            }

            return {isError: result.isError, content: [{type: "text", text: result.response}]};
        },
        {
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
    );

    const deleteTool = tool(
        "delete",
        "Delete a page",
        {
            path: z.string().describe("Path to something in Alpine (e.g. `/doc/hello-world`)"),
        },
        async args => {
            const {isError, response} = await callAgentWebDeleteTool(getContext(), args);

            return {isError, content: [{type: "text", text: response}]};
        },
        {
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
    );

    const searchTool = tool(
        "search",
        "Search for anything in Alpine",
        {
            query: z.string().describe("Search query (plain English, no special syntax)"),
            limit: z
                .number()
                .default(defaultAgentWebSearchResultLimit)
                .describe("Max number of search results"),
        },
        async args => {
            const context = getContext();

            messageRef.current?.pushToolCall(context.span, {
                type: "Search",
                query: args.query,
            });

            const {isError, response} = await callAgentWebSearchTool(context, args);

            return {isError, content: [{type: "text", text: response}]};
        },
        {
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
    );

    const scrollTool = tool(
        "scroll",
        "See more of a page from `read` that\u2019s larger than `limit`",
        {
            path: z.string().describe("Path to something you\u2019ve previously read"),
            offset: z.number().describe("Number of lines to skip past"),
            limit: z
                .string()
                .default(agentWebBytesDefaultLimit)
                .describe(`How much to read (in bytes, e.g. ${agentWebBytesDefaultLimit})`),
        },
        async args => {
            const {isError, response} = await callAgentWebScrollTool(getContext(), args);

            return {isError, content: [{type: "text", text: response}]};
        },
        {
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
    );

    const findTool = tool(
        "find",
        "Look for a pattern on a specific page from `read`",
        {
            path: z.string().describe("Path to something you\u2019ve previously read"),
            pattern: z.string().describe("Regex pattern to find on the page"),
            offset: z.number().default(0).describe("Number of matches to skip past"),
            limit: z
                .number()
                .default(agentWebBytesFindDefaultLimit)
                .describe("Max number of matches to find"),
            matchLimit: z
                .string()
                .default(agentWebBytesFindDefaultMatchLimit)
                .describe(
                    `How much to read for each match (in bytes, e.g. ${agentWebBytesFindDefaultMatchLimit})`,
                ),
        },
        async args => {
            const {isError, response} = await callAgentWebFindTool(getContext(), args);

            return {isError, content: [{type: "text", text: response}]};
        },
        {
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
    );

    return createSdkMcpServer({
        name: "alpine",
        version: "1.0.0",
        instructions:
            "Tools for reading/writing content in Alpine. Use the `alpine` skill to learn more about these tools and Alpine markdown formats.",
        // We only enable write tools in development. In production we need the user to
        // approve the write.
        //
        // TODO(#claude-bot): Implement approvals
        tools:
            process.env.NODE_ENV !== "production"
                ? [readTool, updateTool, createTool, deleteTool, searchTool, scrollTool, findTool]
                : [readTool, searchTool, scrollTool, findTool],
    });
}
