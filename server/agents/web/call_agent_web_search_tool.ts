import {Link, ListItem, Paragraph, PhrasingContent, RootContent} from "mdast";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {
    AgentWebPageStoredLink,
    printAgentWebPageStoredLinkLabel,
} from "~/server/agents/web/agent_web_page_stored_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {
    ApiSearchMessageResultResponse,
    splitApiSearchMessageResultBodyMatch,
} from "~/server/agents/web/internal/split_api_search_message_result_body_match.js";
import {printAgentWebError} from "~/server/agents/web/print_agent_web_error.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
import {
    ApiSearchResultBodyMatch,
    ApiSearchResultResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

/**
 * The maximum number of results we ask the Alpine search API for.
 */
export const defaultAgentWebSearchResultLimit = 10;

/**
 * Searches the agent's Alpine space and returns the results as Markdown lists of
 * links. The agent can follow a result link with the `read` tool.
 *
 * Alpine search supports natural language filters (e.g. "documents created
 * yesterday"). Results that matched a filter are grouped into a "Filtered results"
 * section per filter, followed by an "Other results" section for results that only
 * matched the keyword search.
 */
export async function callAgentWebSearchTool(
    context: AgentWebContext,
    options: {query: string; limit?: number},
): Promise<string> {
    return await context.span.withSpan("Call agent web search tool", async span => {
        try {
            return await actuallyCallAgentWebSearchTool({...context, span}, options);
        } catch (error) {
            span.addException(error);

            return printAgentWebError(`Couldn\u2019t search`, error);
        }
    });
}

async function actuallyCallAgentWebSearchTool(
    context: AgentWebContext,
    {query, limit = defaultAgentWebSearchResultLimit}: {query: string; limit?: number},
): Promise<string> {
    const {data} = await context.api.get(context.span, "/spaces/{id}/search", {
        params: {
            path: {id: context.spaceId},
            query: {query, limit},
        },
    });
    if (data.results.length === 0) return "No results found.\n";

    // Group results by the summary of the natural language filter they matched, if
    // any. Results that didn't match a filter only matched the keyword search.
    const resultsByParsedFilterSummary = new Map<string, Array<ApiSearchResultResponse>>();
    const otherResults: Array<ApiSearchResultResponse> = [];

    for (const result of data.results) {
        if (!result.parsedFilter) {
            otherResults.push(result);
        } else {
            getOrSetDefaultMapValue(
                resultsByParsedFilterSummary,
                result.parsedFilter.summary,
                () => [],
            ).push(result);
        }
    }

    const content: Array<MaybePromise<RootContent>> = [];

    for (const [matchedFilterSummary, matchedFilterResults] of resultsByParsedFilterSummary) {
        content.push(
            {
                type: "heading",
                depth: 2,
                children: [
                    {
                        type: "text",
                        value:
                            (matchedFilterSummary[0]?.toUpperCase() ?? "") +
                            matchedFilterSummary.slice(1),
                    },
                ],
            },
            (async () => {
                const matchedFilterListItems = await runAllPromises(
                    matchedFilterResults.map(result =>
                        createAgentWebSearchResultListItem(context.storage, result),
                    ),
                );

                return {type: "list", ordered: true, children: matchedFilterListItems};
            })(),
        );
    }

    if (otherResults.length > 0) {
        if (resultsByParsedFilterSummary.size > 0) {
            content.push(
                {
                    type: "heading",
                    depth: 2,
                    children: [{type: "text", value: "Other"}],
                },
                {
                    type: "paragraph",
                    children: [
                        {
                            type: "text",
                            value: "The following results don\u2019t match any natural language filter but Alpine thought they might be relevant anyway. Use your best judgement when determining if they\u2019re actually useful for responding to the user\u2019s request.",
                        },
                    ],
                },
            );
        }

        content.push(
            (async () => {
                const otherListItems = await runAllPromises(
                    otherResults.map(result =>
                        createAgentWebSearchResultListItem(context.storage, result),
                    ),
                );

                return {
                    type: "list",
                    ordered: true,
                    children: otherListItems,
                };
            })(),
        );
    }

    const markdown = printMarkdownTree({type: "root", children: await runAllPromises(content)});

    return markdown.trimEnd();
}

async function createAgentWebSearchResultListItem(
    storage: AgentWebSessionStorage,
    result: ApiSearchResultResponse,
): Promise<ListItem> {
    switch (result.type) {
        case "ChatMessage":
        case "DocumentMessage":
        case "PostMessage":
        case "TaskMessage": {
            return await createAgentWebSearchMessageResultListItem(storage, result);
        }
        case "Account":
        case "Channel":
        case "Chat":
        case "Document":
        case "Post":
        case "Site":
        case "Task":
        case "TaskCollection": {
            return await createAgentWebSearchEntityResultListItem(storage, result);
        }
        default:
            throw exhaustive(result);
    }
}

async function createAgentWebSearchEntityResultListItem(
    storage: AgentWebSessionStorage,
    result: Exclude<ApiSearchResultResponse, ApiSearchMessageResultResponse>,
): Promise<ListItem> {
    const resultLinkPathname = await createAgentWebPageStoredLinkPathname(storage, result);

    const resultLink: Link = {
        type: "link",
        url: resultLinkPathname,
        children: [{type: "text", value: printAgentWebPageStoredLinkLabel(result)}],
    };

    const bodyMatchContent = intoPhrasingContent(result.bodyMatch);

    const bodyMatchParagraph: Paragraph | null =
        bodyMatchContent.length > 0 ? {type: "paragraph", children: bodyMatchContent} : null;

    return {
        type: "listItem",
        children: [
            {type: "paragraph", children: [resultLink]},
            ...(bodyMatchParagraph ? [bodyMatchParagraph] : []),
        ],
    };
}

async function createAgentWebSearchMessageResultListItem(
    storage: AgentWebSessionStorage,
    result: ApiSearchMessageResultResponse,
): Promise<ListItem> {
    const {preview, newBodyMatch} = splitApiSearchMessageResultBodyMatch(result);

    let resultLink: AgentWebPageStoredLink;

    switch (result.type) {
        case "ChatMessage": {
            resultLink = {
                type: "ChatMessage",
                id: result.id,
                index: result.index,
                authorShortName: result.author.shortName,
                preview: flatBodyMatch(preview),
            };
            break;
        }
        case "DocumentMessage": {
            resultLink = {
                type: "DocumentMessage",
                id: result.id,
                threadId: result.threadId,
                index: result.index,
                authorShortName: result.author.shortName,
                preview: flatBodyMatch(preview),
            };
            break;
        }
        case "PostMessage": {
            resultLink = {
                type: "PostMessage",
                id: result.id,
                index: result.index,
                authorShortName: result.author.shortName,
                preview: flatBodyMatch(preview),
            };
            break;
        }
        case "TaskMessage": {
            resultLink = {
                type: "TaskMessage",
                id: result.id,
                index: result.index,
                authorShortName: result.author.shortName,
                preview: flatBodyMatch(preview),
            };
            break;
        }
        default:
            throw exhaustive(result);
    }

    const resultLinkPathname = await createAgentWebPageStoredLinkPathname(storage, resultLink);

    return {
        type: "listItem",
        children: [
            {
                type: "paragraph",
                children: [
                    {
                        type: "link",
                        url: resultLinkPathname,
                        // Preserve bold marks in the link label for the match.
                        children: [
                            {type: "text", value: `${result.author.shortName}: `},
                            ...intoPhrasingContent(preview),
                        ],
                    },
                    ...intoPhrasingContent(newBodyMatch),
                ],
            },
        ],
    };
}

function intoPhrasingContent(bodyMatch: ApiSearchResultBodyMatch | null): Array<PhrasingContent> {
    if (!bodyMatch) return [];

    return bodyMatch.map(({text, isMatch}) => {
        const textContent: PhrasingContent = {type: "text", value: text};
        if (!isMatch) return textContent;
        return {type: "strong", children: [textContent]};
    });
}

function flatBodyMatch(bodyMatch: ReadonlyArray<{text: string}>): string {
    let bodySnippet = "";
    for (const {text} of bodyMatch) bodySnippet += text;
    return bodySnippet;
}
