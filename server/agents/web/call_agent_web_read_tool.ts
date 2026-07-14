import {addHours} from "date-fns";
import {Root} from "mdast";
import * as prettier from "prettier";
import * as markdownPrettierPlugin from "prettier/plugins/markdown";
import {parseAgentWebBytes} from "~/server/agents/web/agent_web_bytes.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPage, AgentWebPageMetadata} from "~/server/agents/web/agent_web_page.js";
import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {AgentWebPageRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.js";
import {AgentWebPageStoredLinkKeyObject} from "~/server/agents/web/agent_web_page_stored_link_key.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {truncateAgentWebReadResponse} from "~/server/agents/web/call_agent_web_scroll_tool.js";
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
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
import {
    FailedPreconditionError,
    InternalError,
    NotFoundError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

export const agentWebReadResponseExpirationHours = 1;

export async function callAgentWebReadTool(
    context: AgentWebContext,
    options: {path: string; limit: string},
): Promise<string> {
    const {truncatedResponse} = await actuallyCallAgentWebReadTool(context, options);
    return truncatedResponse;
}

async function actuallyCallAgentWebReadTool(
    context: AgentWebContext,
    {path: originalPath, limit: limitBytesString}: {path: string; limit: string},
) {
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
                displayMessage: errorDisplayMessage`Nothing found for path \`${originalPath}\`. You may only read paths you\u2019ve already seen a link for. Please try calling the \`read\` tool again with a path you\u2019ve seen before. If you\u2019re trying to read something you don\u2019t have a link for then don\u2019t try making up a path. Instead try calling the \`search\` tool which will help you find what you need and will give you links which you can use with the \`read\` tool.`,
            });
        }

        const {pageLink, latestPathname} = pageLinkResult;

        // Allow the agent to observe when a path change occurs. We frame this as a
        // "redirect", like an HTTP redirect. Otherwise it may mistakingly think different
        // links that point to the same content are actually different links. This error
        // allows the agent to correct its view of the world.
        if (latestPathname !== pathname) {
            throw new FailedPreconditionError("Link was redirected", {
                displayMessage: errorDisplayMessage`This path was redirected to \`${latestPathname}\`. Try calling the \`read\` tool again with the new path.`,
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
        // production for performance.
        if (process.env.NODE_ENV !== "production") {
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
    pageLink: AgentWebPageLink,
    page: AgentWebPage,
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

    let string = printMarkdownTree(tree);

    // Use Prettier to print our Markdown before sending it to the LLM. We hypothesize
    // this will lead to better performance from the LLM since Prettier formatting is
    // more "standard" than micromark's (used by `printMarkdownTree()`) default
    // formatting.
    string = await prettier.format(string, {
        parser: "markdown",
        endOfLine: "lf",
        printWidth: 80,
        tabWidth: 2,
        // We never wrap text within paragraphs at 80 characters. This is entirely
        // presentational. Two reasons why we think it's bad for LLMs:
        //
        // 1. Pagination via newlines ends up being more semantic since it's close to
        //    paginating by paragraphs in a long document.
        //
        // 2. We're guessing LLMs are trained on vastly more text without presentational
        //    line breaks than text with presentational line breaks. So the LLM should be
        //    slightly more intelligent when not presented with text that has
        //    presentational line breaks.
        //
        // Wrapping at 80 characters is good for a human reader but not necessarily for an
        // LLM reader.
        proseWrap: "never",
        plugins: [markdownPrettierPlugin],
    });

    string = string.trim();

    return string;
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
        case "Account": {
            return await readAgentWebAccountPage(context, pageLink.id, options);
        }
        case "Document": {
            return await readAgentWebDocumentPage(context, pageLink.id, options);
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
            throw new UnimplementedError("NOCOMMIT");
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
        case "Site": {
            throw new UnimplementedError("NOCOMMIT");
        }
        default:
            throw exhaustive(pageLink);
    }
}

function normalizeAgentWebPage(page: AgentWebPage): AgentWebPage {
    switch (page.type) {
        case "Account": {
            return normalizeAgentWebAccountPage(page);
        }
        case "Document": {
            return normalizeAgentWebDocumentPage(page);
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
        case "Post": {
            return normalizeAgentWebPostPage(page);
        }
        default:
            throw exhaustive(page);
    }
}

function printAgentWebPage(
    storage: AgentWebSessionStorage,
    pageLink: AgentWebPageLink,
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
            throw new UnimplementedError("NOCOMMIT");
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
        case "Site": {
            throw new UnimplementedError("NOCOMMIT");
        }
        default:
            throw exhaustive(pageLink);
    }
}

async function parseAgentWebPageForTest(
    storage: AgentWebSessionStorage,
    pageMetadata: AgentWebPageMetadata,
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
        default:
            throw exhaustive(pageMetadata);
    }
}
