import {produce} from "immer";
import {Parent, Root} from "mdast";
import {AgentWebContextWithoutStorage} from "~/server/agents/web/agent_web_context.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {unzipKeysFromApiContentResponse} from "~/shared/api/markdown/zip_or_unzip_keys_from_api_content_response.js";
import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {hasHtmlOpenTag} from "~/shared/helpers/html/has_html_open_tag.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

export type AgentWebDocumentPage = {
    readonly type: "Document";
    readonly title: string;
    readonly content: ApiContentResponseWithoutKeys;
};

export type AgentWebDocumentPageMetadata = {
    readonly type: "Document";
    readonly id: DocumentId;
    readonly version: number;
    readonly keys: ReadonlyArray<ApiContentKey>;
};

export type AgentWebDocumentPageWithMetadata = AgentWebDocumentPage & {
    readonly metadata: AgentWebDocumentPageMetadata;
};

export async function readAgentWebDocumentPage(
    context: AgentWebContextWithoutStorage,
    id: DocumentId,
    {printPage}: {printPage: (page: AgentWebDocumentPageWithMetadata) => Promise<string>},
): Promise<{response: string; metadata: AgentWebDocumentPageMetadata}> {
    const {
        data: {document},
    } = await context.api.get(context.span, "/documents/{id}", {params: {path: {id}}});

    const {content, keys} = unzipKeysFromApiContentResponse(document.content);

    const page: AgentWebDocumentPageWithMetadata = {
        type: "Document",
        title: document.title,
        content,
        metadata: {
            type: "Document",
            id,
            version: document.version,
            keys,
        },
    };

    const response = await printPage(page);

    return {
        response,
        metadata: page.metadata,
    };
}

export async function createAgentWebDocumentPage(
    context: AgentWebContextWithoutStorage,
    newPage: AgentWebDocumentPage,
): Promise<AgentWebDocumentPageMetadata> {
    const {
        data: {document},
    } = await context.api.post(context.span, "/documents", {
        body: {
            spaceId: context.spaceId,
            document: {
                title: newPage.title,
                content: newPage.content,
            },
        },
    });

    const {keys} = unzipKeysFromApiContentResponse(document.content);

    return {
        type: "Document",
        id: document.id,
        version: document.version,
        keys,
    };
}

export async function updateAgentWebDocumentPage(
    context: AgentWebContextWithoutStorage,
    {id, version: oldVersion}: AgentWebDocumentPageMetadata,
    newPage: AgentWebDocumentPage,
): Promise<AgentWebDocumentPageMetadata> {
    const {
        data: {document},
    } = await context.api.patch(context.span, "/documents/{id}", {
        params: {path: {id}},
        body: {
            document: {
                version: oldVersion,
                title: newPage.title,
                content: newPage.content,
            },
        },
    });

    const {keys} = unzipKeysFromApiContentResponse(document.content);

    return {
        type: "Document",
        id,
        version: document.version,
        keys,
    };
}

export function normalizeAgentWebDocumentPage<Page extends AgentWebDocumentPage>(page: Page): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            normalizer.normalize(page.content);
        });
    });
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
                displayMessage: errorDisplayMessage`A title is required for documents. Try again but make sure the document starts with a markdown h1 (e.g. \`# My Document\`).`,
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
                    displayMessage: errorDisplayMessage`A document can only have one markdown h1 (e.g. \`# My Document\`) and the h1 must be placed at the start of the document. You added an additional markdown h1 ${quoteMarkdown(childNode.children)}. Try again but remove the additional markdown h1 or make it an h2 (e.g. \`## My Sub-heading\`).`,
                });
            }

            if (
                id === null &&
                childNode.type === "html" &&
                hasHtmlOpenTag(childNode.value, tagName => tagName === "comment")
            ) {
                throw new InvalidArgumentError("Can\u2019t add comments when creating a document", {
                    displayMessage: errorDisplayMessage`Can\u2019t create \`<comment>\`s while creating a document. First create the document without comments and then add the \`<comment>\`s in after.`,
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
