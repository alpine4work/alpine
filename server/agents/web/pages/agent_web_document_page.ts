import {Parent, Root} from "mdast";
import {AgentWebContextWithoutStorage} from "~/server/agents/web/agent_web_context.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

export type AgentWebDocumentPage = {
    readonly type: "Document";
    readonly title: string;
    readonly content: ApiContentResponse;
};

export type AgentWebDocumentPageWithMetadata = AgentWebDocumentPage & {
    readonly metadata: AgentWebDocumentPageMetadata;
};

export type AgentWebDocumentPageMetadata = {
    readonly id: DocumentId;
    readonly version: number;
};

export async function readAgentWebDocumentPage(
    context: AgentWebContextWithoutStorage,
    id: DocumentId,
): Promise<AgentWebDocumentPageWithMetadata> {
    const {
        data: {document},
    } = await context.api.get(context.span, "/documents/{id}", {params: {path: {id}}});

    return {
        type: "Document",
        title: document.title,
        content: document.content,
        metadata: {
            id,
            version: document.version,
        },
    };
}

export async function updateAgentWebDocumentPage(
    context: AgentWebContextWithoutStorage,
    {id, version: oldVersion}: AgentWebDocumentPageMetadata,
    newPage: AgentWebDocumentPage,
): Promise<AgentWebDocumentPageMetadata & {type: "Document"}> {
    // NOCOMMIT: Make sure we test that this endpoint is idempotent!
    const {
        data: {document},
    } = await context.api.put(context.span, "/documents/{id}", {
        params: {path: {id}},
        body: {
            document: {
                version: oldVersion,
                title: newPage.title,
                content: newPage.content,
            },
        },
    });

    return {
        type: "Document",
        id,
        version: document.version,
    };
}

export async function printAgentWebDocumentPage(
    storage: AgentWebSessionStorage,
    id: DocumentId,
    page: AgentWebDocumentPage,
): Promise<Root> {
    const root = await printApiContentToAgentWebMarkdownTree(storage, page.content, {
        documentId: id,
    });

    root.children.unshift({
        type: "heading",
        depth: 1,
        children: [{type: "text", value: page.title}],
    });

    return root;
}

export async function parseAgentWebDocumentPage(
    storage: AgentWebSessionStorage,
    id: DocumentId | null,
    root: Root,
): Promise<AgentWebDocumentPage> {
    let title: string;

    {
        const firstChild = root.children[0];

        if (firstChild?.type === "heading" && firstChild.depth === 1) {
            root.children.shift();
            title = printMarkdownPhrasingContentText(firstChild.children);
        } else {
            throw new InvalidArgumentError("Missing title in document", {
                displayMessage: errorDisplayMessage`A title is required for documents. Try again but make sure the document starts with a Markdown h1 (e.g. \`# My Document\`).`,
            });
        }
    }

    const traverse = (node: Parent) => {
        for (const childNode of node.children) {
            if ("children" in childNode) {
                traverse(childNode);
            }

            if (childNode.type === "heading" && childNode.depth === 1) {
                throw new InvalidArgumentError("Documents can only have a single heading level 1", {
                    displayMessage: errorDisplayMessage`A document can only have one Markdown h1 (e.g. \`# My Document\`) and the h1 must be placed at the start of the document. You added an additional Markdown h1 ${quoteMarkdown(childNode.children)}. Try again but remove the additional Markdown h1 or make it an h2 (e.g. \`## My Sub-heading\`).`,
                });
            }
        }
    };

    traverse(root);

    const content = await parseApiContentFromAgentWebMarkdownTree(storage, root, {
        documentId: id,
    });

    return {type: "Document", title, content};
}
