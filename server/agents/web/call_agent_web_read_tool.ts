import {addHours} from "date-fns";
import {Root} from "mdast";
import {getApiReference} from "~/server/agents/api/api_client.js";
import {parseAgentWebBytes} from "~/server/agents/web/agent_web_bytes.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPage, AgentWebPageMetadata} from "~/server/agents/web/agent_web_page.js";
import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {AgentWebPageRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.js";
import {AgentWebPageStoredLinkKeyObject} from "~/server/agents/web/agent_web_page_stored_link_key.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {truncateAgentWebReadResponse} from "~/server/agents/web/call_agent_web_scroll_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {agentWebBytesDefaultLimit} from "~/server/agents/web/default_agent_web_bytes_limit.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {
    normalizeAgentWebAccountPage,
    parseAgentWebAccountPage,
    printAgentWebAccountPage,
    readAgentWebAccountPage,
} from "~/server/agents/web/pages/agent_web_account_page.js";
import {
    normalizeAgentWebChannelPage,
    parseAgentWebChannelPage,
    printAgentWebChannelPage,
    readAgentWebChannelPage,
} from "~/server/agents/web/pages/agent_web_channel_page.js";
import {
    normalizeAgentWebChatPage,
    parseAgentWebChatPage,
    printAgentWebChatPage,
    readAgentWebChatMessagePage,
    readAgentWebChatPage,
} from "~/server/agents/web/pages/agent_web_chat_page.js";
import {
    normalizeAgentWebDocumentPage,
    parseAgentWebDocumentPage,
    printAgentWebDocumentPage,
    readAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.js";
import {
    normalizeAgentWebDocumentThreadPage,
    parseAgentWebDocumentThreadPage,
    printAgentWebDocumentThreadPage,
    readAgentWebDocumentThreadMessagePage,
    readAgentWebDocumentThreadPage,
} from "~/server/agents/web/pages/agent_web_document_thread_page.js";
import {
    normalizeAgentWebInboxPage,
    parseAgentWebInboxPage,
    printAgentWebInboxPage,
    readAgentWebInboxPage,
} from "~/server/agents/web/pages/agent_web_inbox_page.js";
import {
    normalizeAgentWebPostPage,
    parseAgentWebPostPage,
    printAgentWebPostPage,
    readAgentWebPostMessagePage,
    readAgentWebPostPage,
} from "~/server/agents/web/pages/agent_web_post_page.js";
import {
    normalizeAgentWebTaskCollectionPage,
    parseAgentWebTaskCollectionPage,
    printAgentWebTaskCollectionPage,
    readAgentWebTaskCollectionPage,
} from "~/server/agents/web/pages/agent_web_task_collection_page.js";
import {
    normalizeAgentWebTaskMessageListPage,
    parseAgentWebTaskMessageListPage,
    printAgentWebTaskMessageListPage,
    readAgentWebTaskMessageListMessagePage,
    readAgentWebTaskMessageListPage,
} from "~/server/agents/web/pages/agent_web_task_message_list_page.js";
import {
    normalizeAgentWebTaskPage,
    parseAgentWebTaskPage,
    printAgentWebTaskPage,
    readAgentWebTaskPage,
} from "~/server/agents/web/pages/agent_web_task_page.js";
import {
    normalizeAgentWebTaskSubtasksPage,
    parseAgentWebTaskSubtasksPage,
    printAgentWebTaskSubtasksPage,
    readAgentWebTaskSubtasksPage,
} from "~/server/agents/web/pages/agent_web_task_subtasks_page.js";
import {printAgentWebError} from "~/server/agents/web/print_agent_web_error.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {getApiMentionReferenceNoun} from "~/shared/api/content/get_api_mention_reference_noun.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {parseApiMentionReferenceFromMarkdownPathnameSegmentsIfPossible} from "~/shared/api/content/parse_api_content_from_markdown_url_if_possible.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {quote} from "~/shared/helpers/string/quote.js";

export const agentWebReadResponseExpirationHours = 1;

export async function callAgentWebReadTool(
    context: AgentWebContext,
    options: {path: string; limit?: string},
): Promise<string> {
    return await context.span.withSpan("Call agent web read tool", async span => {
        try {
            const {truncatedResponse} = await actuallyCallAgentWebReadTool(
                {...context, span},
                options,
            );
            return truncatedResponse;
        } catch (error) {
            span.addException(error);
            return printAgentWebError(`Couldn\u2019t read ${quote(options.path)}`, error);
        }
    });
}

async function actuallyCallAgentWebReadTool(
    context: AgentWebContext,
    {
        path: originalPath,
        limit: limitBytesString = agentWebBytesDefaultLimit,
    }: {
        path: string;
        limit?: string;
    },
) {
    // Allow passing in an Alpine URL to the `read` tool. This will help users who copy
    // an Alpine URL from their browser and paste it into their agent. The agent can
    // then take the URL and turn it into a human-readable path and operate on that.
    if (/^https?:/.test(originalPath)) {
        let url: URL;
        try {
            url = new URL(originalPath);
        } catch (error) {
            throw InvalidArgumentError.from(error, "Failed to parse path as URL", {
                displayMessage: errorDisplayMessage`Expected ${quote(originalPath)} to be a valid URL. Try again with a valid URL, a path you\u2019ve seen before (e.g. \`/document/hello-world\`), or use the \`search\` tool to try and find what you\u2019re looking for.`,
            });
        }

        const pathnameSegments = url.pathname.slice(1).split("/");

        const reference =
            parseApiMentionReferenceFromMarkdownPathnameSegmentsIfPossible(pathnameSegments);

        if (!reference) {
            throw new InvalidArgumentError("Unrecognized URL reference", {
                displayMessage: errorDisplayMessage`Unrecognized URL path ${quote(url.pathname)}. Can only call the \`read\` tool with an Alpine URL. Try again with a valid URL, a path you\u2019ve seen before (e.g. \`/document/hello-world\`), or use the \`search\` tool to try and find what you\u2019re looking for.`,
            });
        }

        const {
            data: {reference: referenceResponse},
        } = await getApiReference(context.span, context.api, reference);

        const pathname = await createAgentWebPageStoredLinkPathname(
            context.storage,
            referenceResponse,
        );

        return {
            truncatedResponse: `Found path for URL: ${quote(pathname)}.\n\nCall the \`read\` tool again with that path to see the ${getApiMentionReferenceNoun(reference.type)}\u2019s content.`,
        };
    }

    const {path, pathname, searchParams} = normalizeAgentWebPath(originalPath);

    // The agent gives us a limit in bytes (which conventionally is understood as UTF-8
    // code units) but for convenience we treat it as UTF-16 code units since that's
    // how JavaScript strings are represented. This means in extreme cases we may
    // return a string up to 2x longer in UTF-8 code units than the requested byte
    // limit.
    const limitLength = parseAgentWebBytes(limitBytesString);

    return await getOrSetDefaultMapValue(
        context.storage.readResponseMutexByPath,
        path,
        () => new Mutex(),
    ).withLock(async () => {
        const pageLinkResult = await routeAgentWebPageLinkPathname(context.storage, pathname);

        if (!pageLinkResult) {
            throw new NotFoundError("Link not found", {
                displayMessage: errorDisplayMessage`Nothing found for path ${quote(originalPath)}. You may only read paths you\u2019ve already seen a link for. Please try calling the \`read\` tool again with a path you\u2019ve seen before. If you\u2019re trying to read something you don\u2019t have a link for then don\u2019t try making up a path. Instead try calling the \`search\` tool which will help you find what you need and will give you links which you can use with the \`read\` tool.`,
            });
        }

        const {pageLink, latestPathname} = pageLinkResult;

        // Allow the agent to observe when a path change occurs. We frame this as a
        // "redirect", like an HTTP redirect. Otherwise it may mistakingly think different
        // links that point to the same content are actually different links. This error
        // allows the agent to correct its view of the world.
        if (latestPathname !== pathname) {
            throw new FailedPreconditionError("Link was redirected", {
                displayMessage: errorDisplayMessage`This path was redirected to ${quote(latestPathname)}. Try calling the \`read\` tool again with the new path.`,
            });
        }

        const {response, metadata: pageMetadata} = await readAgentWebPageLink(
            context,
            pathname,
            pageLink,
            {
                searchParams,
                limitLength,
                printPage: async page => {
                    assert(pageLink.type !== "Skill");
                    assert(page.type !== "Skill");

                    const response = await printAgentWebPageToMarkdownForReadTool(
                        context.storage,
                        pageLink,
                        page,
                    );
                    return response;
                },
            },
        );

        // In non-production environments, parse the response back into the underlying page
        // object just to make sure there are no parse errors. We don't do this in
        // production as a performance optimization.
        if (process.env.NODE_ENV !== "production" && pageMetadata.type !== "Skill") {
            const responseTree = parseMarkdownTree(response);

            try {
                await parseAgentWebPageForTest(context.storage, pageMetadata, responseTree);
            } catch (error) {
                throw InternalError.from(
                    error,
                    "Couldn\u2019t parse agent web page returned by `readAgentWebPageLink()`",
                );
            }
        }

        // Find all the newline indexes in our response. So the `scroll` tool can easily
        // return a slice of the response.
        const newlineIndexes: Array<number> = [];

        for (let index = 0; index < response.length; index++) {
            if (response[index] === "\n") {
                newlineIndexes.push(index);
            }
        }

        // There's implicitly a newline at the end of the response. This also means
        // `newlineIndexes` is non-empty.
        newlineIndexes.push(response.length);

        const readResponse = {
            expirationTime: addHours(new Date(), agentWebReadResponseExpirationHours),
            pageMetadata,
            response,
            newlineIndexes,
        };

        await context.storage.readResponseByPath.put(path, readResponse);

        if (response.length <= limitLength) {
            return {readResponse, truncatedResponse: response};
        } else {
            return {
                readResponse,
                truncatedResponse: truncateAgentWebReadResponse(
                    {response, newlineIndexes},
                    {offsetNewline: 0, limitLength, isScrollTool: false},
                ),
            };
        }
    });
}

async function printAgentWebPageToMarkdownForReadTool(
    storage: AgentWebSessionStorage,
    pageLink: Exclude<AgentWebPageLink, {type: "Skill"}>,
    page: Exclude<AgentWebPage, {type: "Skill"}>,
): Promise<string> {
    // We should always normalize agent web markdown before printing. The following
    // property is not true in all cases:
    // `isDeepEqual(parse(print(page)), normalize(page))`. But this property is true:
    // `isDeepEqual(parse(print(normalize(page))), normalize(page))`.
    //
    // (The property `isDeepEqual(parse(print(page)), normalize(page))` does hold in
    // all cases for plain API content to Markdown printing/parsing. Specifically agent
    // web Markdown doesn't have this property.)
    //
    // The specific reason is when there are mentions that reference the same
    // underlying data but have different `title`s or other hydrated response data we
    // need to set all mentions to the same `title` so that way we're only storing one
    // value for `title` in `storage` and so when we parse we're always getting exactly
    // one `title` back as well.
    page = normalizeAgentWebPage(page);

    const tree = await printAgentWebPage(storage, pageLink, page);

    const markdown = printMarkdownTree(tree);

    return markdown.trimEnd();
}

async function readAgentWebPageLink(
    context: AgentWebContext,
    pathname: string,
    // We intentionally use the "key object" type so the code within this function
    // doesn't rely on `title` or any extra data we include in the full link object to
    // print a friendly path for the agent.
    pageLink: AgentWebPageStoredLinkKeyObject | AgentWebPageRoutedLink,
    options: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebPage) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebPageMetadata}> {
    switch (pageLink.type) {
        case "Skill": {
            return {
                response: pageLink.content,
                metadata: {type: "Skill"},
            };
        }
        case "Account": {
            return await readAgentWebAccountPage(context, pageLink.id, options);
        }
        case "Document": {
            return await readAgentWebDocumentPage(context, pageLink.id, options);
        }
        case "Inbox": {
            return await readAgentWebInboxPage(context, pageLink.account, options);
        }
        case "DocumentThread": {
            return await readAgentWebDocumentThreadPage(
                context,
                pageLink.document.id,
                pageLink.threadId,
                options,
            );
        }
        case "DocumentMessage": {
            return await readAgentWebDocumentThreadMessagePage(
                context,
                pageLink.id,
                pageLink.threadId,
                pageLink.index,
                options,
            );
        }
        case "File": {
            // TODO(#agents-web): How should we return a file via the CLI or MCP?
            throw new UnimplementedError("Reading a file is unimplemented");
        }
        case "Channel": {
            return await readAgentWebChannelPage(context, pageLink.id, options);
        }
        case "Chat": {
            return await readAgentWebChatPage(context, pageLink.id, options);
        }
        case "ChatMessage": {
            return await readAgentWebChatMessagePage(context, pageLink.id, pageLink.index, options);
        }
        case "Post": {
            return await readAgentWebPostPage(context, pageLink.id, options);
        }
        case "PostMessage": {
            return await readAgentWebPostMessagePage(context, pageLink.id, pageLink.index, options);
        }
        case "Task": {
            return await readAgentWebTaskPage(context, pageLink.id, options);
        }
        case "TaskCollection": {
            return await readAgentWebTaskCollectionPage(context, pageLink.id, options);
        }
        case "TaskMessage": {
            return await readAgentWebTaskMessageListMessagePage(
                context,
                pageLink.id,
                pageLink.index,
                options,
            );
        }
        case "TaskMessageList": {
            return await readAgentWebTaskMessageListPage(context, pageLink.task.id, options);
        }
        case "TaskSubtasks": {
            return await readAgentWebTaskSubtasksPage(context, pageLink.task.id, options);
        }
        case "Site": {
            // TODO(#agents-web): Implement sites API and agent web format.
            throw new UnimplementedError("Reading a site is unimplemented");
        }
        default:
            throw exhaustive(pageLink);
    }
}

function normalizeAgentWebPage(
    page: Exclude<AgentWebPage, {type: "Skill"}>,
): Exclude<AgentWebPage, {type: "Skill"}> {
    switch (page.type) {
        case "Account": {
            return normalizeAgentWebAccountPage(page);
        }
        case "Document": {
            return normalizeAgentWebDocumentPage(page);
        }
        case "Inbox": {
            return normalizeAgentWebInboxPage(page);
        }
        case "DocumentThread": {
            return normalizeAgentWebDocumentThreadPage(page);
        }
        case "Channel": {
            return normalizeAgentWebChannelPage(page);
        }
        case "Chat": {
            return normalizeAgentWebChatPage(page);
        }
        case "TaskMessageList": {
            return normalizeAgentWebTaskMessageListPage(page);
        }
        case "Task": {
            return normalizeAgentWebTaskPage(page);
        }
        case "TaskCollection": {
            return normalizeAgentWebTaskCollectionPage(page);
        }
        case "TaskSubtasks": {
            return normalizeAgentWebTaskSubtasksPage(page);
        }
        case "Post": {
            return normalizeAgentWebPostPage(page);
        }
        default:
            throw exhaustive(page);
    }
}

function printAgentWebPage(
    storage: AgentWebSessionStorage,
    pageLink: Exclude<AgentWebPageLink, {type: "Skill"}>,
    page: AgentWebPage,
): Promise<Root> {
    switch (pageLink.type) {
        case "Account": {
            assert(page.type === "Account");
            return printAgentWebAccountPage(storage, pageLink.id, page);
        }
        case "Document": {
            assert(page.type === "Document");
            return printAgentWebDocumentPage(storage, pageLink.id, page);
        }
        case "Inbox": {
            assert(page.type === "Inbox");
            return printAgentWebInboxPage(storage, pageLink.account.id, page);
        }
        case "DocumentThread": {
            assert(page.type === "DocumentThread");
            return printAgentWebDocumentThreadPage(storage, pageLink, page);
        }
        case "DocumentMessage": {
            assert(page.type === "DocumentThread");
            return printAgentWebDocumentThreadPage(
                storage,
                {threadId: pageLink.threadId, document: {id: pageLink.id}},
                page,
            );
        }
        case "File": {
            // TODO(#agents-web): How should we return a file via the CLI or MCP?
            throw new UnimplementedError("Reading a file is unimplemented");
        }
        case "Channel": {
            assert(page.type === "Channel");
            return printAgentWebChannelPage(storage, pageLink.id, page);
        }
        case "Chat": {
            assert(page.type === "Chat");
            return printAgentWebChatPage(storage, pageLink.id, page);
        }
        case "ChatMessage": {
            assert(page.type === "Chat");
            return printAgentWebChatPage(storage, pageLink.id, page);
        }
        case "Post": {
            assert(page.type === "Post");
            return printAgentWebPostPage(storage, pageLink.id, page);
        }
        case "PostMessage": {
            assert(page.type === "Post");
            return printAgentWebPostPage(storage, pageLink.id, page);
        }
        case "Task": {
            assert(page.type === "Task");
            return printAgentWebTaskPage(storage, pageLink.id, page);
        }
        case "TaskCollection": {
            assert(page.type === "TaskCollection");
            return printAgentWebTaskCollectionPage(storage, pageLink.id, page);
        }
        case "TaskMessage": {
            assert(page.type === "TaskMessageList");
            return printAgentWebTaskMessageListPage(storage, pageLink.id, page);
        }
        case "TaskMessageList": {
            assert(page.type === "TaskMessageList");
            return printAgentWebTaskMessageListPage(storage, pageLink.task.id, page);
        }
        case "TaskSubtasks": {
            assert(page.type === "TaskSubtasks");
            return printAgentWebTaskSubtasksPage(storage, pageLink.task.id, page);
        }
        case "Site": {
            // TODO(#agents-web): Implement sites API and agent web format.
            throw new UnimplementedError("Reading a site is unimplemented");
        }
        default:
            throw exhaustive(pageLink);
    }
}

async function parseAgentWebPageForTest(
    storage: AgentWebSessionStorage,
    pageMetadata: Exclude<AgentWebPageMetadata, {type: "Skill"}>,
    response: Root,
): Promise<AgentWebPage> {
    assert(process.env.NODE_ENV !== "production");

    switch (pageMetadata.type) {
        case "Account": {
            return await parseAgentWebAccountPage(storage, pageMetadata.id, response);
        }
        case "Document": {
            return await parseAgentWebDocumentPage(storage, pageMetadata.id, response);
        }
        case "Inbox": {
            return await parseAgentWebInboxPage(storage, pageMetadata.id, response);
        }
        case "DocumentThread": {
            return await parseAgentWebDocumentThreadPage(
                storage,
                {document: {id: pageMetadata.id}, threadId: pageMetadata.threadId},
                response,
            );
        }
        case "Channel": {
            return await parseAgentWebChannelPage(storage, pageMetadata.id, response);
        }
        case "Chat": {
            return await parseAgentWebChatPage(storage, pageMetadata.id, response);
        }
        case "Post": {
            return await parseAgentWebPostPage(storage, pageMetadata.id, response);
        }
        case "Task": {
            return await parseAgentWebTaskPage(storage, pageMetadata.id, response);
        }
        case "TaskCollection": {
            return await parseAgentWebTaskCollectionPage(storage, pageMetadata.id, response);
        }
        case "TaskMessageList": {
            return await parseAgentWebTaskMessageListPage(storage, pageMetadata.id, response);
        }
        case "TaskSubtasks": {
            return await parseAgentWebTaskSubtasksPage(storage, pageMetadata.id, response);
        }
        default:
            throw exhaustive(pageMetadata);
    }
}
