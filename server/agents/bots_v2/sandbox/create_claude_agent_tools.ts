import {createSdkMcpServer, tool} from "@anthropic-ai/claude-agent-sdk";
import {z} from "zod";
import {AgentWebMessageStreamSession} from "~/server/agents/bots_v2/sandbox/agent_web_message_stream_session.js";
import {claudeAgentWriteToolInputShapes} from "~/server/agents/bots_v2/sandbox/claude_agent_write_tool_input_shapes.js";
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
import {intoApiMessageStreamToolCallPart} from "~/server/agents/web/into_api_message_stream_tool_call_part.js";
import {agentToolAnnotations} from "~/shared/agents/agent_tool_annotations.js";
import {isFileCodeContentType} from "~/shared/files/file_content_type.open_source.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.open_source.js";

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

        const toolCall = intoApiMessageStreamToolCallPart({type: "Read", pageLink});
        if (toolCall !== null) {
            messageRef.current.pushToolCall(getContext().span, toolCall);
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
        {annotations: agentToolAnnotations.read},
    );

    const updateTool = tool(
        "update",
        "Update any page",
        claudeAgentWriteToolInputShapes.update,
        async args => {
            const context = getContext();
            const result = await callAgentWebUpdateTool(context, args);

            if (!result.isError) {
                const toolCall = intoApiMessageStreamToolCallPart({
                    type: "Update",
                    pageLink: result.pageLink,
                });
                if (toolCall !== null) messageRef.current?.pushToolCall(context.span, toolCall);
            }

            return {
                isError: result.isError,
                content: [{type: "text", text: result.response}],
            };
        },
        {annotations: agentToolAnnotations.update},
    );

    const createTool = tool(
        "create",
        "Create a new page",
        claudeAgentWriteToolInputShapes.create,
        async args => {
            const context = getContext();

            const result = await callAgentWebCreateTool(context, args);

            if (!result.isError) {
                const toolCall = intoApiMessageStreamToolCallPart({
                    type: "Create",
                    pageLink: result.pageLink,
                });
                if (toolCall !== null) messageRef.current?.pushToolCall(context.span, toolCall);
            }

            return {isError: result.isError, content: [{type: "text", text: result.response}]};
        },
        {annotations: agentToolAnnotations.create},
    );

    const deleteTool = tool(
        "delete",
        "Delete a page",
        claudeAgentWriteToolInputShapes.delete,
        async args => {
            const {isError, response} = await callAgentWebDeleteTool(getContext(), args);

            return {isError, content: [{type: "text", text: response}]};
        },
        {annotations: agentToolAnnotations.delete},
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

            const toolCall = intoApiMessageStreamToolCallPart({type: "Search", query: args.query});
            if (toolCall !== null) messageRef.current?.pushToolCall(context.span, toolCall);

            const {isError, response} = await callAgentWebSearchTool(context, args);

            return {isError, content: [{type: "text", text: response}]};
        },
        {annotations: agentToolAnnotations.search},
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
        {annotations: agentToolAnnotations.scroll},
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
        {annotations: agentToolAnnotations.find},
    );

    return createSdkMcpServer({
        name: "alpine",
        version: "1.0.0",
        instructions:
            "Tools for reading/writing content in Alpine. Use the `alpine` skill to learn more about these tools and Alpine markdown formats.",
        // All tools are always registered. In production, calls to the write tools are
        // gated behind user approvals by the `canUseTool` gate (see
        // `create_claude_agent_can_use_tool.ts`).
        tools: [readTool, updateTool, createTool, deleteTool, searchTool, scrollTool, findTool],
    });
}
