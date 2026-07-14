import {countTokens as countO200kBaseTokens} from "gpt-tokenizer/esm/encoding/o200k_base";
import {
    agentDocumentFirstPageTokenLimit,
    agentPaginationTokenLimitGrowthFactor,
} from "~/server/agents/bots/internal/deprecated/agent_limits.js";
import {
    AgentDocumentPageLink,
    AgentLocalDocumentPageLink,
} from "~/server/agents/bots/internal/deprecated/link_references/agent_link.js";
import {putAgentDocumentPageLink} from "~/server/agents/bots/internal/deprecated/link_references/agent_link_collection.js";
import {
    AgentLocalDocumentKey,
    getAgentLocalDocumentContentIfExists,
} from "~/server/agents/bots/internal/deprecated/link_references/agent_local_document_content_collection.js";
import {createAgentLinkNotFoundError} from "~/server/agents/bots/internal/deprecated/link_references/create_agent_link_not_found_error.js";
import {printAgentLinkPath} from "~/server/agents/bots/internal/deprecated/link_references/print_agent_link_path.js";
import {DurableObjectStorageInterface} from "~/server/cloudflare/durable_object_storage_collection.js";
import {visitApiContent} from "~/shared/api/content/visit_api_content.js";
import {ApiContentBlockElementResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

// Estimate token count for `ApiContent`.
//
// This is generally an under count of the actual tokens we'd get when printing to
// markdown because we don't count markdown formatting tokens. Just the raw
// underlying text. The order of magnitude should be correct, though.
function estimateApiContentBlockElementTokenCount(element: ApiContentBlockElementResponse): number {
    let tokenCount = 0;
    visitApiContent(
        {elements: [element]},
        {
            // NOTE(ifitzsimmons): This recurses through the current element and counts the
            // total number of tokens for the root and all children. A slight optimization
            // would be to break out of the recursion loop as soon as a child element pushes
            // the token count over the limit. However, we shouldn't do this unless we have a
            // really strong reason. As is, this would likely only come up for really large
            // tables (because it will visit every cell in the table) and the table would have
            // have to be pretty massive to make a meaningful difference.
            visitInlineElement: element => {
                switch (element.type) {
                    case "Text": {
                        tokenCount += countO200kBaseTokens(element.text);
                        break;
                    }
                    case "Mention": {
                        tokenCount += countO200kBaseTokens(element.reference.title ?? "");
                        break;
                    }
                    case "Break": {
                        break;
                    }
                    default:
                        throw exhaustive(element);
                }
            },
        },
    );

    return tokenCount;
}

type PageBoundary = {
    startElementIndex: number;
    endElementIndexExclusive: number;
    pageNumber: number;
};

/**
 * Given a document that has been loaded into the agent's local storage, create all
 * of the pages for that document _except for the first page_ by splitting elements
 * based on token limits. Returns the AgentLink to the first page of the
 * document.\*
 */
export async function createAgentDocumentPagesAndReturnFirstPage(
    storage: DurableObjectStorageInterface,
    {
        documentKey,
        originalLinkPathObject,
        tokenLimitFactor,
    }: {
        documentKey: AgentLocalDocumentKey;
        originalLinkPathObject: AgentDocumentPageLink;
        tokenLimitFactor: number;
    },
): Promise<AgentDocumentPageLink> {
    const document = await getAgentLocalDocumentContentIfExists(storage, documentKey);

    if (!document) {
        throw createAgentLinkNotFoundError(printAgentLinkPath(originalLinkPathObject));
    }

    const {elements} = document.content;
    const pageBoundaries: Array<PageBoundary> = [];

    let currentPageStartIndex = 0;
    let currentPageTokenCount = 0;
    let currentPageNumber = 1;
    let tokenLimitForPage = Math.floor(agentDocumentFirstPageTokenLimit * tokenLimitFactor);

    for (let i = 0; i < elements.length; i++) {
        const element = elements[i]!;

        // Estimate token count for this single element
        const elementTokenCount = estimateApiContentBlockElementTokenCount(element);

        // If adding this element would exceed the limit and we have at least one element,
        // create a page boundary
        if (
            currentPageTokenCount + elementTokenCount > tokenLimitForPage &&
            i > currentPageStartIndex
        ) {
            pageBoundaries.push({
                startElementIndex: currentPageStartIndex,
                endElementIndexExclusive: i,
                pageNumber: currentPageNumber,
            });

            currentPageStartIndex = i;
            currentPageTokenCount = elementTokenCount;
            currentPageNumber += 1;

            // Similar to the way we increase page sizes when paginating through messages,
            // we'll also increase each subsequent document page size. Since we store the whole
            // document in memory on first read, we bake the exponential page growth into the
            // page creation process.
            //
            // The agent spends reasoning tokens between page reads trying to decide whether to
            // read more or to stop. If the agent is trying to pull in a lot of context that
            // requires paginating through many pages, it will spend a lot of unnecessary
            // reasoning tokens.
            //
            // By increasing the token exponentially as it paginates, we can spend less
            // reasoning tokens and return results faster.
            tokenLimitForPage = Math.floor(
                tokenLimitForPage * agentPaginationTokenLimitGrowthFactor,
            );
        } else {
            currentPageTokenCount += elementTokenCount;
        }
    }

    // Add the last page if there are any remaining elements
    if (currentPageStartIndex < elements.length) {
        pageBoundaries.push({
            startElementIndex: currentPageStartIndex,
            endElementIndexExclusive: elements.length,
            pageNumber: currentPageNumber,
        });
    }

    // create links for every page except for the first page. The first page is
    // returned when the LLM calls `read_link` on a document, so we shouldn't create a
    // separate link for it. We can think of the `read_link` call on the document as a
    // reference to the first page of document content.
    await runAllPromises(
        pageBoundaries.slice(1).map(async pageBoundary => {
            const link = createDocumentPageLink(pageBoundary);
            await putAgentDocumentPageLink(storage, link);
        }),
    );

    if (!pageBoundaries[0]) {
        throw new InternalError("Failed to create document pages.");
    }

    return createDocumentPageLink(pageBoundaries[0]);

    // Helper to create page options for a given boundary
    function createDocumentPageLink(boundary: PageBoundary): AgentDocumentPageLink {
        const localDocumentPageLink: AgentLocalDocumentPageLink = {
            localDocumentVersion: getLocalDocumentVersion(documentKey),
            pageNumber: boundary.pageNumber,
            documentKey,
            pageStartElementIndex: boundary.startElementIndex,
            pageEndElementIndexExclusive: boundary.endElementIndexExclusive,
            // The agent should not be able to navigate backwards. All pages are represented a
            // singly-linked list of pages.
            previousPageAgentLinkString: null,
            // Have to initialize this to null so that we can print the link path for next
            // page.
            nextPageAgentLinkString: null,
        };
        const nextPageAgentLinkString =
            boundary.pageNumber < pageBoundaries.length
                ? printAgentLinkPath({
                      ...originalLinkPathObject,
                      localDocumentPage: {
                          ...localDocumentPageLink,
                          pageNumber: boundary.pageNumber + 1,
                      },
                  } as AgentDocumentPageLink)
                : null;
        return {
            ...originalLinkPathObject,
            localDocumentPage: {
                ...localDocumentPageLink,
                nextPageAgentLinkString,
            },
        };
    }
}

// Given a document key `/local/document/${documentId}-${version}`, returns the
// version.
function getLocalDocumentVersion(documentKey: AgentLocalDocumentKey) {
    const documentVersionLabel = documentKey.slice(1).split("/")[2];

    if (!documentVersionLabel) {
        throw new InvalidArgumentError("Invalid document key");
    }

    const [, version] = documentVersionLabel.split("-");

    if (!version || !/^\d+$/.test(version)) {
        throw new InvalidArgumentError("Invalid document key");
    }

    const versionNumber = parseInt(version, 10);
    if (!Number.isInteger(versionNumber) || versionNumber <= 0) {
        throw new InvalidArgumentError("Invalid document key");
    }

    return versionNumber;
}
