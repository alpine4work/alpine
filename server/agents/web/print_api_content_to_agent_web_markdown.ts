import escapeHtml from "escape-html";
import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {Html, RootContent} from "mdast";
import {printAgentWebPageKey} from "~/server/agents/web/agent_web_page_key.js";
import {
    printAgentWebPageLinkLabel,
    printAgentWebPageLinkPath,
} from "~/server/agents/web/agent_web_page_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createApiTargetAgentWebPageLink} from "~/server/agents/web/create_api_target_agent_web_page_link.js";
import {
    printApiContentToMarkdownTree,
    printMarkdownTree,
} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {
    ApiContentMentionInlineElementResponse,
    ApiContentResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export async function printApiContentToAgentWebMarkdown(
    storage: AgentWebSessionStorage,
    content: ApiContentResponse,
    {spaceId}: {spaceId: SpaceId},
) {
    const markdownTree = await printApiContentToAgentWebMarkdownTree(storage, content, {spaceId});
    return printMarkdownTree(markdownTree);
}

async function printApiContentToAgentWebMarkdownTree(
    storage: AgentWebSessionStorage,
    content: ApiContentResponse,
    {spaceId}: {spaceId: SpaceId},
) {
    const node = printApiContentToMarkdownTree(content, {
        spaceId,
        // Our LLMs don't need to know the width of columns in a table. The potentially
        // long floats will consume a lot of tokens and may confuse the LLM.
        withSimpleCommentMarkHtml: true,
    });

    let hasAnyChildNodeChanged = false;

    const newChildNodes = await runAllPromises(
        node.children.map(async childNode => {
            const newChildNode = await traverseApiContentMarkdownNode(storage, childNode);
            hasAnyChildNodeChanged ||= newChildNode !== childNode;
            return newChildNode;
        }),
    );

    if (!hasAnyChildNodeChanged) return node;

    return {
        ...node,
        // Trust that our traverse function created the right type of nodes here.
        children: newChildNodes as any,
    };
}

async function traverseApiContentMarkdownNode(
    storage: AgentWebSessionStorage,
    node: RootContent,
): Promise<RootContent> {
    // Traverse children first. This gives us our best chance at deterministically
    // ordering `storage` function calls (so any functions that produce a sequence,
    // e.g. `link-1`, `link-2`, etc.) produce that sequence in a deterministic order.
    if ("children" in node) {
        let hasAnyChildNodeChanged = false;

        const newChildNodes = await runAllPromises(
            node.children.map(async childNode => {
                const newChildNode = await traverseApiContentMarkdownNode(storage, childNode);
                hasAnyChildNodeChanged ||= newChildNode !== childNode;
                return newChildNode;
            }),
        );

        if (hasAnyChildNodeChanged) {
            node = {
                ...node,
                // Trust that our traverse function created the right type of nodes here.
                children: newChildNodes as any,
            };
        }
    }

    // Headings from `ApiContent` should always start at level 2. That way we can add
    // level 1 headings elsewhere in the agent context (e.g. document titles) without
    // fear of conflict.
    switch (node.type) {
        case "heading": {
            assert(node.depth <= 3);
            const newDepth = (node.depth + 1) as 2 | 3 | 4;
            return {...node, depth: newDepth};
        }
        case "html": {
            return traverseApiContentMarkdownHtmlNode(storage, node);
        }
        case "link": {
            // TODO(ifitzsimmons, #ai): As implemented, non-mentionable content (e.g. a chat
            // message) will be replaced with a missing link. It may make more sense to create
            // an actual link to the message when possible.
            if (!node.data?.mentionElement) {
                return {
                    ...node,
                    url: await printAgentWebMarkdownUrl(storage, node.url),
                };
            }

            // This `mentionElement` will always be a response specialization because we print
            // `ApiContentResponse`.
            const mentionElement = node.data
                .mentionElement as ApiContentMentionInlineElementResponse;

            return storage.mutex.withLock(async () => {
                const pageLink = createApiTargetAgentWebPageLink(mentionElement.target);
                const pageKey = printAgentWebPageKey(pageLink);

                let dedupeNumber = 1;
                let pageLinkPath = printAgentWebPageLinkPath(pageLink, dedupeNumber);

                let actualPageKey = await storage.pageKeyByLinkPath.get(pageLinkPath);

                while (actualPageKey !== undefined && actualPageKey !== pageKey) {
                    dedupeNumber++;
                    pageLinkPath = printAgentWebPageLinkPath(pageLink, dedupeNumber);
                    actualPageKey = await storage.pageKeyByLinkPath.get(pageLinkPath);
                }

                if (actualPageKey === undefined) {
                    await storage.pageKeyByLinkPath.put(pageLinkPath, pageKey);
                    await storage.lastPageLinkPathByKey.put(pageKey, pageLinkPath);
                }

                return {
                    type: "link",
                    url: pageLinkPath,
                    children: [{type: "text", value: printAgentWebPageLinkLabel(pageLink)}],
                };
            });
        }
        default:
            return node;
    }
}

async function traverseApiContentMarkdownHtmlNode(
    storage: AgentWebSessionStorage,
    node: Html,
): Promise<Html> {
    let anchorTagState: {
        href: {
            isOpen: boolean;
            attributeEndIndex: number;
            data: {startIndex: number; endIndex: number; value: string} | null;
        } | null;
    } | null = null;

    let tableTagState: {
        dataWidth: {
            isOpen: boolean;
            attributeEndIndex: number;
            data: {startIndex: number; endIndex: number; value: string} | null;
        } | null;
        dataColumnWidths: {
            isOpen: boolean;
            attributeEndIndex: number;
            data: {startIndex: number; endIndex: number; value: string} | null;
        } | null;
    } | null = null;

    const replacements: Array<{startIndex: number; endIndex: number; string: Promise<string>}> = [];

    const tokenizer = new HtmlTokenizer(
        {},
        {
            ontext: noop,
            ontextentity: noop,

            onopentagname: (startIndex, endIndex) => {
                const tagName = node.value.slice(startIndex, endIndex).toLowerCase();

                switch (tagName) {
                    case "a": {
                        anchorTagState = {href: null};
                        break;
                    }
                    case "table": {
                        tableTagState = {dataWidth: null, dataColumnWidths: null};
                        break;
                    }
                }
            },
            onopentagend: () => {
                if (anchorTagState) {
                    if (anchorTagState.href?.data) {
                        replacements.push({
                            startIndex: anchorTagState.href.data.startIndex,
                            endIndex: anchorTagState.href.data.endIndex,
                            string: printAgentWebMarkdownUrl(
                                storage,
                                anchorTagState.href.data.value,
                            ).then(escapeHtml),
                        });
                    }

                    anchorTagState = null;
                }

                if (tableTagState) {
                    // Shorten `data-width` to 2 digits of precision. If there's a conflicting width at
                    // that precision then add a digit of precision and try again.
                    if (tableTagState.dataWidth?.data) {
                        const width = JSON.parse(tableTagState.dataWidth.data.value);

                        // Should be safe to assume this since `data-width` is always produced by
                        // `printApiContentToMarkdown()` with `JSON.stringify()`.
                        assert(typeof width === "number" && !isNaN(width));

                        replacements.push({
                            startIndex: tableTagState.dataWidth.data.startIndex,
                            endIndex: tableTagState.dataWidth.data.endIndex,
                            string: storage.mutex.withLock(async () => {
                                let fractionDigits = 2;
                                let truncatedWidth = toFixedWithoutTrailingZeros(
                                    width,
                                    fractionDigits,
                                );

                                let expectedWidth =
                                    await storage.tableWidthByTruncatedWidth.get(truncatedWidth);

                                while (expectedWidth !== undefined && expectedWidth !== width) {
                                    fractionDigits++;
                                    truncatedWidth = toFixedWithoutTrailingZeros(
                                        width,
                                        fractionDigits,
                                    );

                                    expectedWidth =
                                        await storage.tableWidthByTruncatedWidth.get(
                                            truncatedWidth,
                                        );
                                }

                                if (expectedWidth === undefined) {
                                    await storage.tableWidthByTruncatedWidth.put(
                                        truncatedWidth,
                                        width,
                                    );
                                }

                                return truncatedWidth;
                            }),
                        });
                    }

                    if (tableTagState.dataColumnWidths?.data) {
                        const columnWidths = JSON.parse(
                            `[${tableTagState.dataColumnWidths.data.value}]`,
                        ) as Array<number>;

                        // Should be safe to assume this since `data-column-widths` is always produced by
                        // `printApiContentToMarkdown()` with `JSON.stringify()`.
                        assert(
                            Array.isArray(columnWidths) &&
                                columnWidths.length > 0 &&
                                columnWidths.every(
                                    width => typeof width === "number" && !isNaN(width),
                                ),
                        );

                        replacements.push({
                            startIndex: tableTagState.dataColumnWidths.data.startIndex,
                            endIndex: tableTagState.dataColumnWidths.data.endIndex,
                            string: storage.mutex.withLock(async () => {
                                const sortedColumnWidths = [...columnWidths].sort();

                                let fractionDigits: number;

                                if (sortedColumnWidths.length < 2) {
                                    fractionDigits = 2;
                                } else {
                                    // Get the largest difference between any two column widths. We use this to figure
                                    // out the precision we need to print `data-column-widths` at to avoid printing all
                                    // zeros.
                                    const maxDifference =
                                        sortedColumnWidths[sortedColumnWidths.length - 1]! -
                                        sortedColumnWidths[sortedColumnWidths.length - 2]!;

                                    // The number of leading zeros in `maxDifference`.
                                    //
                                    // - If 1 then 0
                                    // - If 1.234 then 0
                                    // - If 0.1 then 1
                                    // - If 0.01 then 2
                                    // - If 0.01234 then 2
                                    // - If 0.005 then 3
                                    //
                                    // etc.
                                    const maxDifferenceLeadingZeros = Math.max(
                                        0,
                                        -Math.floor(Math.log10(maxDifference)),
                                    );

                                    fractionDigits = Math.max(2, maxDifferenceLeadingZeros + 1);
                                }

                                let truncatedColumnWidths = columnWidths
                                    .map(width =>
                                        toFixedWithoutTrailingZeros(width, fractionDigits),
                                    )
                                    .join(",");

                                let expectedColumnWidths =
                                    await storage.tableColumnWidthsByTruncatedColumnWidths.get(
                                        truncatedColumnWidths,
                                    );

                                while (
                                    expectedColumnWidths !== undefined &&
                                    !isDeepEqual(expectedColumnWidths, columnWidths)
                                ) {
                                    fractionDigits++;

                                    truncatedColumnWidths = columnWidths
                                        .map(width =>
                                            toFixedWithoutTrailingZeros(width, fractionDigits),
                                        )
                                        .join(",");

                                    expectedColumnWidths =
                                        await storage.tableColumnWidthsByTruncatedColumnWidths.get(
                                            truncatedColumnWidths,
                                        );
                                }

                                if (expectedColumnWidths === undefined) {
                                    await storage.tableColumnWidthsByTruncatedColumnWidths.put(
                                        truncatedColumnWidths,
                                        columnWidths,
                                    );
                                }

                                return truncatedColumnWidths;
                            }),
                        });
                    }

                    tableTagState = null;
                }
            },
            onclosetag: noop,

            onattribname: (startIndex, endIndex) => {
                const attributeName = node.value.slice(startIndex, endIndex).toLowerCase();

                if (anchorTagState && attributeName === "href") {
                    anchorTagState.href = {
                        isOpen: true,
                        attributeEndIndex: endIndex,
                        data: null,
                    };
                }

                if (tableTagState) {
                    if (attributeName === "data-width") {
                        tableTagState.dataWidth = {
                            isOpen: true,
                            attributeEndIndex: endIndex,
                            data: null,
                        };
                    }

                    if (attributeName === "data-column-widths") {
                        tableTagState.dataColumnWidths = {
                            isOpen: true,
                            attributeEndIndex: endIndex,
                            data: null,
                        };
                    }
                }
            },
            onattribdata: (startIndex, endIndex) => {
                const attributeData = node.value.slice(startIndex, endIndex);

                const addAttributeData = (state: {
                    attributeEndIndex: number;
                    data: {startIndex: number; endIndex: number; value: string} | null;
                }) => {
                    state.data ??= {startIndex, endIndex, value: ""};
                    state.data.endIndex = endIndex;
                    state.data.value += attributeData;
                };

                if (anchorTagState?.href?.isOpen) addAttributeData(anchorTagState.href);
                if (tableTagState?.dataWidth?.isOpen) addAttributeData(tableTagState.dataWidth);
                if (tableTagState?.dataColumnWidths?.isOpen)
                    addAttributeData(tableTagState.dataColumnWidths);
            },
            onattribentity: codepoint => {
                const attributeData = String.fromCodePoint(codepoint);

                const addAttributeEntity = (state: {
                    attributeEndIndex: number;
                    data: {startIndex: number; endIndex: number; value: string} | null;
                }) => {
                    const lastIndex = state.data?.endIndex ?? state.attributeEndIndex;

                    let startIndex = node.value.slice(lastIndex).indexOf("&");
                    assert(startIndex !== -1);
                    startIndex += lastIndex;

                    let endIndex = node.value.slice(startIndex + 1).indexOf(";");
                    assert(endIndex !== -1);
                    endIndex += startIndex + 1;
                    endIndex += 1;

                    state.data ??= {startIndex, endIndex, value: ""};
                    state.data.endIndex = endIndex;
                    state.data.value += attributeData;
                };

                if (anchorTagState?.href?.isOpen) addAttributeEntity(anchorTagState.href);
                if (tableTagState?.dataWidth?.isOpen) addAttributeEntity(tableTagState.dataWidth);
                if (tableTagState?.dataColumnWidths?.isOpen)
                    addAttributeEntity(tableTagState.dataColumnWidths);
            },
            onattribend: () => {
                if (anchorTagState?.href?.isOpen) {
                    anchorTagState.href.isOpen = false;
                }

                if (tableTagState?.dataWidth?.isOpen) {
                    tableTagState.dataWidth.isOpen = false;
                }

                if (tableTagState?.dataColumnWidths?.isOpen) {
                    tableTagState.dataColumnWidths.isOpen = false;
                }
            },

            oncdata: noop,
            oncomment: noop,
            ondeclaration: noop,
            onend: noop,
            onprocessinginstruction: noop,
            onselfclosingtag: noop,
        },
    );

    tokenizer.write(node.value);

    const actualReplacements = await runAllPromises(
        replacements.reverse().map(async ({startIndex, endIndex, string}) => ({
            startIndex,
            endIndex,
            string: await string,
        })),
    );

    let newValue = node.value;

    for (const {startIndex, endIndex, string} of actualReplacements) {
        newValue = newValue.slice(0, startIndex) + string + newValue.slice(endIndex);
    }

    return {...node, value: newValue};
}

/**
 * Takes a URL from content and returns a truncated URL we'll share with agents.
 * The truncated URL is unique (we use session storage to ensure this) so the full
 * URL can be later retrieved by the agent.
 */
function printAgentWebMarkdownUrl(storage: AgentWebSessionStorage, url: string): Promise<string> {
    return storage.mutex.withLock(async () => {
        const truncatedUrl = truncateUrlForAgentWebMarkdown(url);

        const dedupeNumber =
            (await storage.dedupeNumberByTruncatedUrlAndUrl.list({prefix: `${truncatedUrl} `}))
                .size + 1;

        await storage.dedupeNumberByTruncatedUrlAndUrl.put(`${truncatedUrl} ${url}`, dedupeNumber);

        return addDedupeNumberToTruncatedAgentWebMarkdownUrl(truncatedUrl, dedupeNumber);
    });
}

const maxAgentWebMarkdownUrlLength = 50;
const startPartMaxAgentWebMarkdownUrlLength = 40;
const endPartMaxAgentWebMarkdownUrlLength =
    maxAgentWebMarkdownUrlLength - startPartMaxAgentWebMarkdownUrlLength;

/**
 * Long URLs that contain some UI state are wasted tokens for agents. So we
 * truncate long URLs to 50 characters. We show the first 40 characters (which
 * should include the protocol, domain, and start of the path) since those are
 * generally the most important characters.
 */
function truncateUrlForAgentWebMarkdown(url: string): string {
    if (url.length <= maxAgentWebMarkdownUrlLength) return url;

    return (
        url.slice(0, startPartMaxAgentWebMarkdownUrlLength) +
        "…" +
        url.slice(-endPartMaxAgentWebMarkdownUrlLength)
    );
}

/**
 * If we have two URLs that truncate to the same string but are in fact different
 * (in other words: the first 40 characters and last 10 characters of two long URLs
 * are the same but the characters between are different) then we need to dedupe
 * the URL we send to the agent so we can resolve the correct URL if the agent asks
 * us to load the URL.
 *
 * We do this by adding a `#` part to the truncated URL with a dedupe number. If
 * there's already a visible `#` part in the URL then we append to the hash part
 * with `-`. This dedupe number changes the meaning of the URL so we need to make
 * sure we remove the dedupe number when we actually load the web page.
 */
function addDedupeNumberToTruncatedAgentWebMarkdownUrl(
    truncatedUrl: string,
    dedupeNumber: number,
): string {
    if (dedupeNumber === 1) return truncatedUrl;

    if (truncatedUrl.includes("#")) {
        return `${truncatedUrl}-${dedupeNumber}`;
    } else {
        return `${truncatedUrl}#${dedupeNumber}`;
    }
}

function toFixedWithoutTrailingZeros(value: number, fractionDigits: number): string {
    const string = value.toFixed(fractionDigits);

    let endIndex = string.length;

    for (let i = string.length - 1; i >= 0; i--) {
        if (string[i] !== "0") {
            endIndex = i + 1;
            break;
        }
    }

    if (string[endIndex - 1] === ".") endIndex--;

    if (endIndex === 0) return "0";

    return string.slice(0, endIndex);
}
