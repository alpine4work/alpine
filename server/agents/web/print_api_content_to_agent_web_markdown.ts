import escapeHtml from "escape-html";
import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {Html, RootContent} from "mdast";
import {
    printAgentWebPageLinkLabel,
    printAgentWebPageLinkPathname,
} from "~/server/agents/web/agent_web_page_link.js";
import {printAgentWebPageLinkKey} from "~/server/agents/web/agent_web_page_link_key.js";
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
import {InternalError} from "~/shared/error/error.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";

type ApiContentAgentWebMarkdownPrinterState = {
    readonly documentId: DocumentId | null;
    lastDocumentCommentThreadNumber: number | null;
};

export async function printApiContentToAgentWebMarkdown(
    storage: AgentWebSessionStorage,
    content: ApiContentResponse,
    options?: {documentId?: DocumentId | null},
) {
    const markdownTree = await printApiContentToAgentWebMarkdownTree(storage, content, options);
    return printMarkdownTree(markdownTree);
}

export async function printApiContentToAgentWebMarkdownTree(
    storage: AgentWebSessionStorage,
    content: ApiContentResponse,
    {documentId = null}: {documentId?: DocumentId | null} = emptyObject,
) {
    const state: ApiContentAgentWebMarkdownPrinterState = {
        documentId,
        lastDocumentCommentThreadNumber: null,
    };

    const node = printApiContentToMarkdownTree(content, {
        spaceId: storage.spaceId,
        withCommentTagHtml: true,
    });

    let hasAnyChildNodeChanged = false;

    const newChildNodes = await runAllPromises(
        node.children.map(async childNode => {
            const newChildNode = await traverseApiContentMarkdownNode(storage, childNode, state);
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
    state: ApiContentAgentWebMarkdownPrinterState,
): Promise<RootContent> {
    // Traverse children first. This gives us our best chance at deterministically
    // ordering `storage` function calls (so any functions that produce a sequence,
    // e.g. `link-1`, `link-2`, etc.) produce that sequence in a deterministic order.
    if ("children" in node) {
        let hasAnyChildNodeChanged = false;

        const newChildNodes = await runAllPromises(
            node.children.map(async childNode => {
                const newChildNode = await traverseApiContentMarkdownNode(
                    storage,
                    childNode,
                    state,
                );
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

    switch (node.type) {
        // Headings from `ApiContent` should always start at level 2. That way we can add
        // level 1 headings elsewhere in the agent context (e.g. document titles) without
        // fear of conflict.
        case "heading": {
            assert(node.depth <= 3);
            const newDepth = (node.depth + 1) as 2 | 3 | 4;
            return {...node, depth: newDepth};
        }
        case "html": {
            return traverseApiContentMarkdownHtmlNode(storage, node, state);
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
                const pageLinkKey = printAgentWebPageLinkKey(pageLink);

                let dedupeNumber = 1;
                let pageLinkPathname = printAgentWebPageLinkPathname(pageLink, dedupeNumber);

                const [initialActualPageLink, latestPageLinkPathname] = await runAllPromises([
                    storage.pageLinkByPathname.get(pageLinkPathname),
                    storage.latestPageLinkPathnameByKey.get(pageLinkKey),
                ]);

                let actualPageLink = initialActualPageLink;

                while (
                    actualPageLink !== undefined &&
                    printAgentWebPageLinkKey(actualPageLink) !== pageLinkKey
                ) {
                    dedupeNumber++;
                    pageLinkPathname = printAgentWebPageLinkPathname(pageLink, dedupeNumber);
                    actualPageLink = await storage.pageLinkByPathname.get(pageLinkPathname);
                }

                if (actualPageLink === undefined || !isDeepEqual(actualPageLink, pageLink)) {
                    await storage.pageLinkByPathname.put(pageLinkPathname, pageLink);
                }

                // We write in sequence instead of in parallel because if we load
                // `pageLinkPathname` from `latestPageLinkPathnameByKey` and it doesn't exist in
                // `pageLinkByPathname` the agent is going to have a bad time. Since we'll throw a
                // redirection error followed by a not found error when the agent tries to read the
                // redirection.
                if (latestPageLinkPathname !== pageLinkPathname) {
                    await storage.latestPageLinkPathnameByKey.put(pageLinkKey, pageLinkPathname);
                }

                const originalPageLinkLabel = printAgentWebPageLinkLabel(pageLink);

                // We encode the fact that this is a short account mention by using a label that's
                // different from what you'd expect when printing `pageLink`.
                const pageLinkLabel =
                    mentionElement.target.type === "Account" && mentionElement.isAccountShortName
                        ? mentionElement.target.shortName
                        : originalPageLinkLabel;

                let pageLinkPath = pageLinkPathname;

                // If we weren't able to encode the fact that this is a short account mention by
                // using the short account name in the label, then add a hash part to the path.
                // When resolving the path we should ignore the hash part (which mirrors web server
                // behavior, the hash part isn't sent to the server it's only visible on the
                // client).
                //
                // We shouldn't see this much in practice because the client shouldn't set
                // `isAccountShortName` if the short name is identical to the long name.
                if (
                    mentionElement.target.type === "Account" &&
                    mentionElement.isAccountShortName &&
                    mentionElement.target.shortName === originalPageLinkLabel
                ) {
                    pageLinkPath += "#short";
                }

                return {
                    type: "link",
                    url: pageLinkPath,
                    children: [{type: "text", value: pageLinkLabel}],
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
    state: ApiContentAgentWebMarkdownPrinterState,
): Promise<Html> {
    let anchorTagState: {
        href: {
            isOpen: boolean;
            attributeEndIndex: number;
            data: {startIndex: number; endIndex: number; value: string} | null;
        } | null;
    } | null = null;

    let commentTagState: {
        id: {
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
                    case "comment": {
                        commentTagState = {id: null};
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

                if (commentTagState) {
                    if (commentTagState.id?.data) {
                        const {documentId} = state;

                        // Safe since `printApiContentToMarkdown()` should only print `data-comment` if
                        // with a valid `DocumentCommentThreadId`.
                        const commentThreadId = assertId<DocumentCommentThreadId>(
                            commentTagState.id.data.value,
                        );

                        replacements.push({
                            startIndex: commentTagState.id.data.startIndex,
                            endIndex: commentTagState.id.data.endIndex,
                            string: storage.mutex.withLock(async () => {
                                if (!documentId) {
                                    throw new InternalError(
                                        "`documentId` is required when printing comment marks",
                                    );
                                }

                                const id: `${DocumentId}-${DocumentCommentThreadId}` = `${documentId}-${commentThreadId}`;

                                let number = await storage.documentCommentThreadNumberById.get(id);

                                // Optimization: Avoid a `list()` call to get the next number if
                                // `lastDocumentCommentThreadNumber + 1` isn't already in use.
                                if (number === undefined && state.lastDocumentCommentThreadNumber) {
                                    number = state.lastDocumentCommentThreadNumber + 1;

                                    const actualId =
                                        await storage.documentCommentThreadIdByNumber.get(
                                            `${documentId}-${number}`,
                                        );

                                    // If the number isn't in use then let's use it!
                                    if (actualId === undefined) {
                                        await storage.documentCommentThreadNumberById.put(
                                            id,
                                            number,
                                        );
                                        await storage.documentCommentThreadIdByNumber.put(
                                            `${documentId}-${number}`,
                                            commentThreadId,
                                        );
                                    } else if (`${documentId}-${actualId}` !== id) {
                                        // If the number is in use but by a different comment thread then we'll need to
                                        // make a `list()` call to figure out the right number.
                                        number = undefined;
                                    }
                                }

                                // Make a `list()` call to figure out the total number of comment threads we've
                                // seen and use a comment thread number that's one more than that.
                                if (number === undefined) {
                                    const threads =
                                        await storage.documentCommentThreadNumberById.list({
                                            prefix: `${documentId}-`,
                                        });

                                    number = threads.size + 1;

                                    await storage.documentCommentThreadNumberById.put(id, number);
                                    await storage.documentCommentThreadIdByNumber.put(
                                        `${documentId}-${number}`,
                                        commentThreadId,
                                    );
                                }

                                if (
                                    state.lastDocumentCommentThreadNumber === null ||
                                    state.lastDocumentCommentThreadNumber < number
                                ) {
                                    state.lastDocumentCommentThreadNumber = number;
                                }

                                return `${number}`;
                            }),
                        });
                    }

                    commentTagState = null;
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

                if (commentTagState && attributeName === "id") {
                    commentTagState.id = {
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
                if (commentTagState?.id?.isOpen) addAttributeData(commentTagState.id);
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
                if (commentTagState?.id?.isOpen) addAttributeEntity(commentTagState.id);
                if (tableTagState?.dataWidth?.isOpen) addAttributeEntity(tableTagState.dataWidth);
                if (tableTagState?.dataColumnWidths?.isOpen)
                    addAttributeEntity(tableTagState.dataColumnWidths);
            },
            onattribend: () => {
                if (anchorTagState?.href?.isOpen) {
                    anchorTagState.href.isOpen = false;
                }

                if (commentTagState?.id?.isOpen) {
                    commentTagState.id.isOpen = false;
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
        replacements
            // We must apply replacements in reverse order to avoid index shifting.
            .sort((a, b) => b.startIndex - a.startIndex)
            .map(async ({startIndex, endIndex, string}) => ({
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
        let truncatedUrl = url;

        // Don't allow the user to type a link starting with `/`. The agent may think it
        // can use the `read` tool call to lookup the link but it can't. This also allows
        // our page parsing logic (e.g. `agent_web_document_page.ts`) to reliably assume a
        // link that starts with `/` is an Alpine web page.
        //
        // Any links that start with `/` we prefix with `https://alpine.inc` since if you
        // clicked on such a link in the product that's where one would expect the link
        // would take you. In practice, when you try to open the URL from the product we
        // open `about:blank#blocked`.
        if (truncatedUrl.startsWith("/")) {
            truncatedUrl = `https://alpine.inc${truncatedUrl}`;
        }

        truncatedUrl = truncateUrlForAgentWebMarkdown(truncatedUrl);
        if (url === truncatedUrl) return url;

        const urlsForTruncatedUrl = await storage.dedupeNumberByTruncatedUrlAndUrl.list({
            prefix: `${truncatedUrl} `,
        });

        let dedupeNumber = urlsForTruncatedUrl.get(`${truncatedUrl} ${url}`);
        const hadDedupeNumber = dedupeNumber !== undefined;

        if (dedupeNumber === undefined) {
            dedupeNumber = urlsForTruncatedUrl.size + 1;

            await storage.dedupeNumberByTruncatedUrlAndUrl.put(
                `${truncatedUrl} ${url}`,
                dedupeNumber,
            );
        }

        const actualTruncatedUrl = addDedupeNumberToTruncatedAgentWebMarkdownUrl(
            truncatedUrl,
            dedupeNumber,
        );

        if (!hadDedupeNumber) await storage.urlByTruncatedUrl.put(actualTruncatedUrl, url);

        return actualTruncatedUrl;
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
