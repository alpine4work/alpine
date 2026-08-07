import {Root} from "mdast";
import {
    AgentDocumentPageLink,
    AgentLocalDocumentPageLink,
} from "~/server/agents/bots/deprecated/internal/link_references/agent_link.js";
import {
    getAgentLocalDocumentContentIfExists,
    putAgentLocalDocumentContent,
} from "~/server/agents/bots/deprecated/internal/link_references/agent_local_document_content_collection.js";
import {createAgentDocumentPagesAndReturnFirstPage} from "~/server/agents/bots/deprecated/internal/link_references/create_agent_document_pages_and_get_first_page.js";
import {createAgentLinkNotFoundError} from "~/server/agents/bots/deprecated/internal/link_references/create_agent_link_not_found_error.js";
import {printAgentLinkPath} from "~/server/agents/bots/deprecated/internal/link_references/print_agent_link_path.js";
import {printApiContentToAgentMarkdownTree} from "~/server/agents/bots/deprecated/internal/print_api_content_to_agent_markdown.js";
import {AgentWebhookRequest} from "~/server/agents/bots/internal/agent_durable_object_base.js";
import {DurableObjectTransactionInterface} from "~/server/cloudflare/durable_object_storage_collection.js";
import {visitAndProduceApiContent} from "~/shared/api/content/visit_and_produce_api_content.open_source.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";

/**
 * Loads the content of the current page and renders link to the next pages. When
 * paginating through documents, we don't provide links to already-visited pages.
 * This means that the agent can't go backward to a preious page.
 *
 * For example
 *
 * ```markdown
 * Document page content in the form of a list of elements
 *
 * [Next Page »](/document/my-document?page=3)
 * ```
 */
export async function loadAgentDocumentPageLinkContent({
    tracer,
    transaction,
    request,
    link,
    tokenLimitFactor,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: Pick<AgentWebhookRequest, "apiClient" | "spaceId">;
    link: AgentDocumentPageLink;
    tokenLimitFactor: number;
}): Promise<Root> {
    const pageLink = await getLocalDocumentPageLink({
        tracer,
        transaction,
        request,
        link,
        tokenLimitFactor,
    });

    const document = await getAgentLocalDocumentContentIfExists(
        transaction,
        `/local/document/${link.documentId}-${pageLink.localDocumentVersion}`,
    );

    if (!document) {
        throw createAgentLinkNotFoundError(printAgentLinkPath(link));
    }

    const pageElements = document.content.elements.slice(
        pageLink.pageStartElementIndex,
        pageLink.pageEndElementIndexExclusive,
    );

    const pageContentTree = await printApiContentToAgentMarkdownTree(
        transaction,
        visitAndProduceApiContent(
            {elements: pageElements},
            {
                // Remove comment marks from the document content since there's no way for the
                // agent to currently read document comments so the comment mark is merely wasted
                // tokens.
                //
                // TODO(calebmer, #ai): Provide agents a way to see all the comments in a document.
                // We're thinking about implementing this as a separate
                // `/document/${title}-comments` link that has all the comments in the document and
                // further links to read each comment thread individually.
                visitInlineElement: element => {
                    if (!element.marks) return;
                    const newMarks = element.marks.filter(mark => mark.type !== "Comment");
                    if (newMarks.length === element.marks.length) return;
                    element.marks = newMarks;
                },
            },
        ),
    );

    const children: Root["children"] = [];

    if (pageLink.previousPageAgentLinkString) {
        children.push({
            type: "paragraph",
            children: [
                {
                    type: "link",
                    url: pageLink.previousPageAgentLinkString,
                    children: [{type: "text", value: "« Previous page"}],
                },
            ],
        });
    }

    // Include the document title in the first page.
    if (pageLink.pageStartElementIndex === 0) {
        children.push({
            type: "heading",
            depth: 1,
            children: [{type: "text", value: document.title}],
        });
    }

    for (const element of pageContentTree.children) {
        children.push(element);
    }

    if (pageLink.nextPageAgentLinkString) {
        children.push({
            type: "paragraph",
            children: [
                {
                    type: "link",
                    url: pageLink.nextPageAgentLinkString,
                    children: [{type: "text", value: "Next page »"}],
                },
            ],
        });
    }

    return {
        type: "root",
        children,
    };
}

// The first page of a `DocumentPageLink` is the Document itself and is not created
// with a `localDocumentPage`. In this case, we must fetch the document, create the
// page links for all pages (except the first page) and return the page bounds of
// the first page.
async function getLocalDocumentPageLink(options: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: Pick<AgentWebhookRequest, "apiClient" | "spaceId">;
    link: AgentDocumentPageLink;
    tokenLimitFactor: number;
}): Promise<AgentLocalDocumentPageLink> {
    if (!options.link.localDocumentPage) {
        const documentPageLink = await fetchDocumentContentAndGetFirstPage(options);
        if (!documentPageLink.localDocumentPage) {
            throw new InternalError("Failed to create document pages.");
        }

        return documentPageLink.localDocumentPage;
    }

    return options.link.localDocumentPage;
}

async function fetchDocumentContentAndGetFirstPage({
    tracer,
    transaction,
    request,
    link,
    tokenLimitFactor,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: Pick<AgentWebhookRequest, "apiClient" | "spaceId">;
    link: AgentDocumentPageLink;
    tokenLimitFactor: number;
}): Promise<AgentDocumentPageLink> {
    const {
        data: {document},
    } = await request.apiClient.get(tracer, "/documents/{id}", {
        params: {path: {id: link.documentId}},
    });

    const documentKey = await putAgentLocalDocumentContent(transaction, link.documentId, document);

    // Notably does not create a page link for the first page of the document. The
    // first page in a document will only ever be read when the LLM calls `read_link`
    // on the document.
    return await createAgentDocumentPagesAndReturnFirstPage(transaction, {
        documentKey,
        originalLinkPathObject: link,
        tokenLimitFactor,
    });
}
