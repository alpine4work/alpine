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
    AgentWebPageWithMetadata,
    intoAgentWebPageMetadata,
} from "~/server/agents/web/agent_web_page.js";
import {
    AgentWebPageLinkKeyObject,
    printAgentWebPageLinkKey,
} from "~/server/agents/web/agent_web_page_link_key.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {truncateAgentWebReadResponse} from "~/server/agents/web/call_agent_web_scroll_tool.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {
    printAgentWebDocumentPage,
    readAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.js";
import {printMarkdownTree} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {FailedPreconditionError, NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
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

        let cachedPrintedPagePromise: Promise<{
            page: AgentWebPageWithMetadata;
            response: string;
        }> | null = null;

        // Allow an agent web page reader to get the UTF-16 code unit length of a `page` it
        // generates. This is intended to be used for pagination so the reader can make
        // sure its page comes in under the requested limit.
        //
        // We cache the printed string so if the reader returns the exact page then we
        // don't have to print it again.
        const computeLength = (page: AgentWebPageWithMetadata) => {
            const previousCachedPrintedPagePromise = cachedPrintedPagePromise;

            cachedPrintedPagePromise = (async () => {
                const previousCachedPrintedPage = await previousCachedPrintedPagePromise;
                if (previousCachedPrintedPage?.page === page) return previousCachedPrintedPage;

                const response = await printAgentWebPageToMarkdownForReadTool(
                    context.storage,
                    page,
                );
                return {page, response};
            })();

            return cachedPrintedPagePromise.then(({response}) => response.length);
        };

        const [latestPageLinkPathnameForKey, page] = await runAllPromises([
            context.storage.latestPageLinkPathnameByKey.get(pageLinkKey),
            readAgentWebPageLink(context, pageLink, {searchParams, limitLength, computeLength}),
        ]);

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

        // TypeScript is so so dumb in this case. `countBytes()` assigns this variable
        // which is called by `readAgentWebPageLink()`.
        cachedPrintedPagePromise = cachedPrintedPagePromise as any;

        const cachedPrintedPage = await cachedPrintedPagePromise;

        const response =
            cachedPrintedPage?.page === page
                ? cachedPrintedPage.response
                : await printAgentWebPageToMarkdownForReadTool(context.storage, page);

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
            pageMetadata: intoAgentWebPageMetadata(page),
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
    // mutating storage! It should only be reading data from the API. We'll print the
    // page to Markdown later (which requires writing to storage).
    //
    // We don't want to write to storage here because we execute this in parallel with
    // a read that may cause us to throw a redirect error.
    context: AgentWebContextWithoutStorage,
    // We intentionally use the "key object" type so the code within this function
    // doesn't rely on `title` or any extra data we include in the full link object to
    // print a friendly path for the agent.
    pageLink: AgentWebPageLinkKeyObject,
    options: {
        searchParams: URLSearchParams;
        limitLength: number;
        computeLength: (page: AgentWebPageWithMetadata) => Promise<number>;
    },
): Promise<AgentWebPageWithMetadata> {
    switch (pageLink.type) {
        case "Document": {
            return readAgentWebDocumentPage(context, pageLink.id);
        }
        default:
            throw exhaustive(pageLink);
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
        default:
            throw exhaustive(page);
    }
}
