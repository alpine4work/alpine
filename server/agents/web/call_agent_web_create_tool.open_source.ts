import {addHours} from "date-fns";
import {Root} from "mdast";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {AgentWebPageMetadata} from "~/server/agents/web/agent_web_page.open_source.js";
import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.open_source.js";
import {AgentWebPageLinkKeyObject} from "~/server/agents/web/agent_web_page_link_key.open_source.js";
import {agentWebReadResponseExpirationHours} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {createAgentWebPageLinkPathname} from "~/server/agents/web/create_agent_web_page_link_pathname.open_source.js";
import {normalizeAgentWebStaticText} from "~/server/agents/web/internal/normalize_agent_web_static_text.open_source.js";
import {
    createAgentWebChannelPage,
    parseAgentWebChannelPage,
} from "~/server/agents/web/pages/agent_web_channel_page.open_source.js";
import {
    createAgentWebChatPage,
    parseAgentWebChatPage,
} from "~/server/agents/web/pages/agent_web_chat_page.open_source.js";
import {
    createAgentWebDocumentPage,
    parseAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.open_source.js";
import {
    createAgentWebDocumentThreadPage,
    parseAgentWebDocumentThreadPageAndReturnDocumentPath,
} from "~/server/agents/web/pages/agent_web_document_thread_page.open_source.js";
import {
    createAgentWebPostPage,
    parseAgentWebPostPage,
} from "~/server/agents/web/pages/agent_web_post_page.open_source.js";
import {
    createAgentWebTaskCollectionPage,
    parseAgentWebTaskCollectionPage,
} from "~/server/agents/web/pages/agent_web_task_collection_page.open_source.js";
import {
    createAgentWebTaskPage,
    parseAgentWebTaskPage,
} from "~/server/agents/web/pages/agent_web_task_page.open_source.js";
import {printAgentWebError} from "~/server/agents/web/print_agent_web_error.open_source.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.open_source.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

export async function callAgentWebCreateTool(
    context: AgentWebContext,
    options: {
        // TODO(#agents-web): Make `type` strongly typed. we should be able to pass a union
        // of possible types to this
        type: string;
        content: string;
    },
): Promise<
    | {isError: false; response: string; pageLink: AgentWebPageLinkKeyObject}
    | {isError: true; response: string}
> {
    return await context.span.withSpan("Call agent web create tool", async span => {
        const additionalOutput: Array<string> = [];

        try {
            const result = await actuallyCallAgentWebCreateTool({...context, span}, options, {
                addAdditionalOutput: output => additionalOutput.push(output.trim()),
            });

            let {response} = result;

            if (additionalOutput.length > 0) {
                response += `\n\n${additionalOutput.join("\n\n")}`;
            }

            return {isError: false, response, pageLink: result.pageLink};
        } catch (error) {
            span.addException(error);

            const type = parseCallAgentWebCreateToolType(options.type);

            let response = printAgentWebError(
                `Couldn\u2019t create${type !== null ? ` ${type}` : ""}`,
                error,
            );

            if (additionalOutput.length > 0) {
                response += `\n\n${additionalOutput.join("\n\n")}`;
            }

            return {isError: true, response};
        }
    });
}

async function actuallyCallAgentWebCreateTool(
    context: AgentWebContext,
    {
        type,
        content,
    }: {
        type: string;
        content: string;
    },
    {addAdditionalOutput}: {addAdditionalOutput: (information: string) => void},
): Promise<{
    pageLink: AgentWebPageLinkKeyObject;
    response: string;
}> {
    const actualType = parseCallAgentWebCreateToolType(type);

    if (actualType === null) {
        throw new InvalidArgumentError("Can\u2019t create unrecognized `type`", {
            displayMessage: errorDisplayMessage`Unrecognized type ${quote(type)}. To see everything you can create, call the \`read\` tool with \`/skill/create\`. Try again with a different type.`,
        });
    }

    const contentTree = parseMarkdownTree(content);

    // Not all updates are going to be atomic. If we make an update that's not atomic
    // and it fails then we need to know if part of the update succeeded. If part of
    // the update succeeded then we need to delete our entry from `readResponseByPath`
    // since it's invalid. The agent will need to re-read the path.
    //
    // TODO(calebmer, #agents-web): Once we have an update that might have a partial
    // success then write a test to make sure in the partial success case we clean
    // `readResponseByPath`!
    let isPartialSuccess = false;

    const contextWithPartialSuccessDetection: AgentWebContext = {
        ...context,
        api: {
            get: context.api.get.bind(context.api),
            put: async (...args: any): Promise<any> => {
                // eslint-disable-next-line prefer-spread
                const value = await context.api.put.apply(context.api, args);
                isPartialSuccess = true;
                return value;
            },
            post: async (...args: any): Promise<any> => {
                // eslint-disable-next-line prefer-spread
                const value = await context.api.post.apply(context.api, args);
                isPartialSuccess = true;
                return value;
            },
            delete: async (...args: any): Promise<any> => {
                // eslint-disable-next-line prefer-spread
                const value = await context.api.delete.apply(context.api, args);
                isPartialSuccess = true;
                return value;
            },
            patch: async (...args: any): Promise<any> => {
                // eslint-disable-next-line prefer-spread
                const value = await context.api.patch.apply(context.api, args);
                isPartialSuccess = true;
                return value;
            },
        },
    };

    let pageMetadata: AgentWebPageMetadata;
    let pageLink: AgentWebPageLink;
    let pageLinkLabel: string;
    try {
        ({pageMetadata, pageLink, pageLinkLabel} = await createAgentWebPageLink(
            contextWithPartialSuccessDetection,
            actualType,
            contentTree,
            {addAdditionalOutput},
        ));
    } catch (error) {
        if (isPartialSuccess) {
            addAdditionalOutput(
                "This create was a partial success. Try to figure out which parts of the create were successful before trying again.",
            );
        }

        throw error;
    }

    const pageLinkPathname = await createAgentWebPageLinkPathname(context.storage, pageLink);

    // Find all the newline indexes in our content. So the `scroll` tool can easily
    // return a slice of the content.
    const newlineIndexes: Array<number> = [];

    for (let index = 0; index < content.length; index++) {
        if (content[index] === "\n") {
            newlineIndexes.push(index);
        }
    }

    // There's implicitly a newline at the end of the content. This also means
    // `newlineIndexes` is non-empty.
    newlineIndexes.push(content.length);

    // Add the exact content to storage so the agent can call `update` and `scroll`
    // tools on the content.
    await getOrSetDefaultMapValue(
        context.storage.readResponseMutexByPath,
        pageLinkPathname,
        () => new Mutex(),
    ).withLock(async () => {
        await context.storage.readResponseByPath.put(pageLinkPathname, {
            expirationTime: addHours(new Date(), agentWebReadResponseExpirationHours).getTime(),
            pageMetadata,
            response: content,
            newlineIndexes,
        });
    });

    const markdown = printMarkdownTree({
        type: "root",
        children: [
            {
                type: "paragraph",
                children: [
                    {type: "text", value: `Create was successful. New ${actualType}: `},
                    {
                        type: "link",
                        url: pageLinkPathname,
                        children: [{type: "text", value: pageLinkLabel}],
                    },
                    {type: "text", value: "."},
                ],
            },
        ],
    });

    return {
        pageLink,
        response: markdown.trimEnd(),
    };
}

type CallAgentWebCreateToolType =
    | "document"
    | "chat"
    | "channel"
    | "post"
    | "task"
    | "task collection"
    | "document comment thread";

function parseCallAgentWebCreateToolType(originalType: string): CallAgentWebCreateToolType | null {
    // Stem and lowercase whatever random stuff the agent decides to throw at us.
    // Though we tell the agent to use whatever is in the path prefix (e.g. `document`
    // in `/document/cool-thing`, but we want to support `documents`).
    //
    // Also normalize pascal case `DocumentThread` or `DocumentsThread`, whatever, to
    // kebab-case.
    const type = normalizeAgentWebStaticText(originalType);

    switch (type) {
        case "doc":
        case "document":
            return "document";
        case "chat":
            return "chat";
        case "channel":
            return "channel";
        case "post":
            return "post";
        case "task":
            return "task";
        case "task-collect":
            return "task collection";
        case "doc-thread":
        case "document-thread":
        case "doc-comment-thread":
        case "document-comment-thread":
        case "doc-comment":
        case "document-comment":
            return "document comment thread";
        default:
            return null;
    }
}

async function createAgentWebPageLink(
    context: AgentWebContext,
    type: CallAgentWebCreateToolType,
    content: Root,
    options: {addAdditionalOutput: (output: string) => void},
): Promise<{
    pageMetadata: AgentWebPageMetadata;
    pageLink: AgentWebPageLink;
    pageLinkLabel: string;
}> {
    switch (type) {
        case "document": {
            const newPage = await parseAgentWebDocumentPage(context.storage, null, content);

            const pageMetadata = await createAgentWebDocumentPage(context, newPage);

            const title = newPage.title.length === 0 ? "Untitled" : newPage.title;

            return {
                pageMetadata,
                pageLink: {
                    type: "Document",
                    id: pageMetadata.id,
                    title,
                },
                pageLinkLabel: title,
            };
        }
        case "chat": {
            const newPage = await parseAgentWebChatPage(context.storage, null, content);

            const {pageMetadata, pageLink} = await createAgentWebChatPage(
                context,
                newPage,
                options,
            );

            return {
                pageMetadata,
                pageLink,
                pageLinkLabel: pageLink.title,
            };
        }
        case "channel": {
            const newPage = await parseAgentWebChannelPage(context.storage, null, content);

            const {pageMetadata, pageLink} = await createAgentWebChannelPage(context, newPage);

            return {
                pageMetadata,
                pageLink,
                pageLinkLabel: pageLink.title,
            };
        }
        case "post": {
            const newPage = await parseAgentWebPostPage(context.storage, null, content);

            const {pageMetadata, pageLink} = await createAgentWebPostPage(
                context,
                newPage,
                options,
            );

            return {
                pageMetadata,
                pageLink,
                pageLinkLabel: pageLink.title,
            };
        }
        case "task": {
            const newPage = await parseAgentWebTaskPage(context.storage, null, content);

            const {pageMetadata, pageLink} = await createAgentWebTaskPage(
                context,
                newPage,
                options,
            );

            return {
                pageMetadata,
                pageLink,
                pageLinkLabel: pageLink.title.length > 0 ? pageLink.title : "Untitled",
            };
        }
        case "task collection": {
            const newPage = await parseAgentWebTaskCollectionPage(context.storage, null, content);

            const {pageMetadata, pageLink} = await createAgentWebTaskCollectionPage(
                context,
                newPage,
                options,
            );

            return {
                pageMetadata,
                pageLink,
                pageLinkLabel: pageLink.title.length > 0 ? pageLink.title : "Untitled",
            };
        }
        case "document comment thread": {
            const {page: newPage, documentPath} =
                await parseAgentWebDocumentThreadPageAndReturnDocumentPath(
                    context.storage,
                    null,
                    content,
                );

            const {pageMetadata, pageLink} = await createAgentWebDocumentThreadPage(
                context,
                documentPath,
                newPage,
                options,
            );

            return {
                pageMetadata,
                pageLink,
                pageLinkLabel: "thread",
            };
        }
        default:
            throw exhaustive(type);
    }
}
