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
import {truncateAgentWebReadResponse} from "~/server/agents/web/call_agent_web_read_more_tool.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {
    printAgentWebDocumentPage,
    readAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.js";
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
    const {path, pathname} = normalizeAgentWebPath(originalPath);
    const limitBytes = parseAgentWebBytes(limitBytesString);

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

        const [latestPageLinkPathnameForKey, page] = await runAllPromises([
            context.storage.latestPageLinkPathnameByKey.get(pageLinkKey),
            readAgentWebPageLink(context, pageLink),
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

        const response = await printAgentWebPage(context.storage, page);

        // Use Prettier to print our Markdown before sending it to the LLM. We hypothesize
        // this will lead to better performance from the LLM since Prettier formatting is
        // more "standard" than micromark's (used by `printMarkdownTree()`) default
        // formatting.
        //
        // To directly provide our Markdown AST to Prettier we provide an empty string and
        // a plugin that simply returns the `mdast` AST which Prettier understands how to
        // print. This way we don't have to call `printMarkdownTree()` only for Prettier to
        // immediately parse it back into an AST.
        let responseString = await prettier.format("ignored", {
            parser: "mdast",
            endOfLine: "lf",
            printWidth: 80,
            tabWidth: 2,
            proseWrap: "never",
            plugins: [
                {
                    parsers: {
                        mdast: {
                            parse: () => response,
                            astFormat: "mdast",
                            locStart: node => node.position?.start?.offset ?? 0,
                            locEnd: node => node.position?.end?.offset ?? 0,
                        },
                    },
                },
                markdownPrettierPlugin,
            ],
        });

        responseString = responseString.trim();

        const encoder = new TextEncoder();
        const responseBytes = encoder.encode(responseString);

        // Find all the newline indexes in our response. So the `read_more` tool can easily
        // return a slice of the response.
        const newlineByteIndexes: Array<number> = [];

        for (let index = 0; index < responseBytes.length; index++) {
            if (responseBytes[index] === 10) {
                newlineByteIndexes.push(index);
            }
        }

        // There's implicitly a newline at the end of the response. This also means
        // `newlineByteIndexes` is non-empty.
        newlineByteIndexes.push(responseBytes.length);

        await context.storage.readResponseByPath.put(path, {
            expirationTime: addHours(new Date(), agentWebReadResponseExpirationHours),
            pageMetadata: intoAgentWebPageMetadata(page),
            responseBytes,
            newlineByteIndexes,
        });

        if (responseBytes.length <= limitBytes) {
            return responseString;
        } else {
            return truncateAgentWebReadResponse(
                {responseBytes, newlineByteIndexes},
                {offsetLine: 0, limitBytes, isReadMoreTool: false},
            );
        }
    });
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
