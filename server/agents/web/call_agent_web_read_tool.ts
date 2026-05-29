import {addHours} from "date-fns";
import {Root} from "mdast";
import * as prettier from "prettier";
import * as markdownPrettierPlugin from "prettier/plugins/markdown";
import {parseAgentWebBytes} from "~/server/agents/web/agent_web_bytes.js";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {
    AgentWebPage,
    AgentWebPageMetadata,
    AgentWebPageWithMetadata,
} from "~/server/agents/web/agent_web_page.js";
import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {
    AgentWebPageLinkKeyObject,
    printAgentWebPageLinkKey,
} from "~/server/agents/web/agent_web_page_link_key.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {truncateAgentWebReadResponse} from "~/server/agents/web/call_agent_web_scroll_tool.js";
import {createAgentWebPageLinkPathname} from "~/server/agents/web/internal/create_agent_web_page_link_pathname.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
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
import {parseMarkdownTree} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {FailedPreconditionError, InternalError, NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

export const agentWebReadResponseExpirationHours = 1;

export async function callAgentWebReadTool(
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

    return getOrSetDefaultMapValue(
        context.storage.readResponseMutexByPath,
        path,
        () => new Mutex(),
    ).withLock(async () => {
        const pageLink = await context.storage.pageLinkByPathname.get(pathname);

        if (!pageLink) {
            throw new NotFoundError("Link not found", {
                displayMessage: errorDisplayMessage`Nothing found for path \`${originalPath}\`. You may only read paths you\u2019ve already seen a link for. Please try calling the \`read\` tool again with a path you\u2019ve seen before. If you\u2019re trying to read something you don\u2019t have a link for then don\u2019t try making up a path. Instead try calling the \`search\` tool which will help you find what you need and will give you links which you can use with the \`read\` tool.`,
            });
        }

        const pageLinkKey = printAgentWebPageLinkKey(pageLink);

        const latestPageLinkPathnameForKeyPromise = (async () => {
            const latestPageLinkPathnameForKey =
                await context.storage.latestPageLinkPathnameByKey.get(pageLinkKey);

            // Allow the agent to observe when a path change occurs. We frame this as a
            // "redirect", like an HTTP redirect. Otherwise it may mistakingly think different
            // links that point to the same content are actually different links. This error
            // allows the agent to correct its view of the world.
            //
            // `latestPageLinkPathnameForKey` may be undefined in certain race conditions
            // because it's written after we write to `pageLinkByPathname`.
            if (
                latestPageLinkPathnameForKey !== undefined &&
                latestPageLinkPathnameForKey !== pathname
            ) {
                throw new FailedPreconditionError("Link was redirected", {
                    displayMessage: errorDisplayMessage`This path was redirected to \`${latestPageLinkPathnameForKey}\`. Try calling the \`read\` tool again with the new path.`,
                });
            }
        })();

        const [, {response, metadata: pageMetadata}] = await runAllPromises([
            latestPageLinkPathnameForKeyPromise,
            readAgentWebPageLink(context, pageLink, {
                searchParams,
                limitLength,
                printPage: async page => {
                    // Before we print and mutate storage, wait to see if this path was redirected
                    // (this promise throws if the path was redirected).
                    await latestPageLinkPathnameForKeyPromise;

                    const response = await printAgentWebPageToMarkdownForReadTool(
                        context.storage,
                        page,
                    );
                    return response;
                },
                createPageLinkPathname: async pageLink => {
                    // Before we create a link and mutate storage, wait to see if this path was
                    // redirected (this promise throws if the path was redirected).
                    await latestPageLinkPathnameForKeyPromise;

                    return await createAgentWebPageLinkPathname(context.storage, pageLink);
                },
            }),
        ]);

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

        await context.storage.readResponseByPath.put(path, {
            expirationTime: addHours(new Date(), agentWebReadResponseExpirationHours),
            pageMetadata,
            response,
            newlineIndexes,
        });

        if (response.length <= limitLength) {
            return response;
        } else {
            return truncateAgentWebReadResponse(
                {response, newlineIndexes},
                {offsetNewline: 0, limitLength, isScrollTool: false},
            );
        }
    });
}

async function printAgentWebPageToMarkdownForReadTool(
    storage: AgentWebSessionStorage,
    page: AgentWebPageWithMetadata,
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

    const tree = await printAgentWebPage(storage, page);

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

function readAgentWebPageLink(
    // We intentionally use the "without storage" type since this function shouldn't be
    // mutating storage! All storage mutating functions are provided through `options`.
    // For example `printPage` and `createPageLinkPathname`. So you're only allowed to
    // read from the API and then when you need storage you can use the functions
    // available in `options`.
    //
    // We don't want to write to storage here because we execute this in parallel with
    // a read that may cause us to throw a redirect error. We don't want to write to
    // storage if we're not going to return the results of those writes.
    context: AgentWebContextWithoutStorage,
    // We intentionally use the "key object" type so the code within this function
    // doesn't rely on `title` or any extra data we include in the full link object to
    // print a friendly path for the agent.
    pageLink: AgentWebPageLinkKeyObject,
    options: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebPageWithMetadata) => Promise<string>;
        createPageLinkPathname: (pageLink: AgentWebPageLink) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebPageMetadata}> {
    switch (pageLink.type) {
        case "Document": {
            return readAgentWebDocumentPage(context, pageLink.id, options);
        }
        case "Chat": {
            return readAgentWebChatPage(context, pageLink.id, options);
        }
        case "ChatMessage": {
            return readAgentWebChatMessagePage(context, pageLink.id, pageLink.index, options);
        }
        default:
            throw exhaustive(pageLink);
    }
}

function normalizeAgentWebPage(page: AgentWebPageWithMetadata): AgentWebPageWithMetadata {
    switch (page.type) {
        case "Document": {
            return normalizeAgentWebDocumentPage(page);
        }
        case "Chat": {
            return normalizeAgentWebChatPage(page);
        }
        default:
            throw exhaustive(page);
    }
}

function printAgentWebPage(
    storage: AgentWebSessionStorage,
    page: AgentWebPageWithMetadata,
): Promise<Root> {
    switch (page.type) {
        case "Document": {
            return printAgentWebDocumentPage(storage, page.metadata.id, page);
        }
        case "Chat": {
            return printAgentWebChatPage(storage, page.metadata.id, page);
        }
        default:
            throw exhaustive(page);
    }
}

async function parseAgentWebPageForTest(
    storage: AgentWebSessionStorage,
    pageMetadata: AgentWebPageMetadata,
    response: Root,
): Promise<AgentWebPage> {
    assert(process.env.NODE_ENV !== "production");

    switch (pageMetadata.type) {
        case "Document": {
            return await parseAgentWebDocumentPage(storage, pageMetadata.id, response);
        }
        case "Chat": {
            return await parseAgentWebChatPage(storage, pageMetadata.id, response);
        }
        default:
            throw exhaustive(pageMetadata);
    }
}
