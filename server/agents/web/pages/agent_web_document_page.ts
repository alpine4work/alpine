import {Parent, Root} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {quoteMarkdown} from "~/server/agents/web/pages/internal/quote_markdown.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {UrlPath} from "~/shared/helpers/http/url_path.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

export type AgentWebDocumentPage =
    | {
          readonly type: "HeadPage";
          readonly pageNumber: 1;
          readonly isLastPage: boolean;
          readonly title: string;
          readonly content: ApiContentResponse;
      }
    | {
          readonly type: "TailPage";
          readonly pageNumber: number;
          readonly isLastPage: boolean;
          readonly content: ApiContentResponse;
      };

export async function printAgentWebDocumentPage(
    storage: AgentWebSessionStorage,
    pageLink: {
        id: DocumentId;
        path: string;
    },
    page: AgentWebDocumentPage,
): Promise<Root> {
    const root = await printApiContentToAgentWebMarkdownTree(storage, page.content, {
        documentId: pageLink.id,
    });

    if (page.type === "HeadPage") {
        root.children.unshift({
            type: "heading",
            depth: 1,
            children: [{type: "text", value: page.title}],
        });
    }

    if (!page.isLastPage) {
        const nextPageLinkPath = new UrlPath(pageLink.path);
        nextPageLinkPath.searchParams.set("page", (page.pageNumber + 1).toString());

        root.children.push({
            type: "paragraph",
            children: [
                {
                    type: "link",
                    url: nextPageLinkPath.toString(),
                    children: [{type: "text", value: "Next page »"}],
                },
            ],
        });
    }

    return root;
}

export async function parseAgentWebDocumentPage(
    storage: AgentWebSessionStorage,
    pageLink: {
        id: DocumentId;
        path: string;
    } | null,
    root: Root,
): Promise<AgentWebDocumentPage> {
    let isLastPage = true;
    let pageNumber = 1;
    let title: string | null = null;

    const pageLinkPath = pageLink ? new UrlPath(pageLink.path) : null;
    if (pageLinkPath) pageNumber = parseInt(pageLinkPath.searchParams.get("page") ?? "1", 10);

    {
        const firstChild = root.children[0];

        if (firstChild?.type === "heading" && firstChild.depth === 1) {
            root.children.shift();
            title = printMarkdownPhrasingContentText(firstChild.children);
        }
    }

    {
        const lastChild = root.children[root.children.length - 1];

        if (
            lastChild?.type === "paragraph" &&
            lastChild.children.length === 1 &&
            lastChild.children[0]!.type === "link" &&
            lastChild.children[0].url.startsWith("/")
        ) {
            const nextPageLinkPath = new UrlPath(lastChild.children[0].url);

            if (nextPageLinkPath.searchParams.has("page")) {
                if (!pageLinkPath) {
                    throw new InvalidArgumentError(
                        "Can\u2019t add pagination link when creating document",
                        {
                            displayMessage: errorDisplayMessage`You can\u2019t add a pagination link to the end of the document you\u2019re creating. To create a document, fully write out its content without splitting the content into pages. Pagination links will be added automatically when the document is read with the \`read\` tool. Try again but remove the ${quoteMarkdown(lastChild.children)} pagination link at the end of your document.`,
                        },
                    );
                } else if (
                    pageLinkPath.pathname === nextPageLinkPath.pathname &&
                    nextPageLinkPath.searchParams.get("page") === `${pageNumber + 1}`
                ) {
                    root.children.pop();
                    isLastPage = false;
                }
            }
        }
    }

    const traverse = (node: Parent) => {
        for (const childNode of node.children) {
            if ("children" in childNode) {
                traverse(childNode);
            }

            if (childNode.type === "heading" && childNode.depth === 1) {
                throw new InvalidArgumentError("Documents can only have a single heading level 1", {
                    displayMessage: errorDisplayMessage`A document can only have one Markdown h1 (e.g. \`# My Document\`) and the h1 must be placed at the beginning of the document. You added an additional Markdown h1 ${quoteMarkdown(childNode.children)}. Try again but remove the additional Markdown h1 or make it an h2 (e.g. \`## My Sub-heading\`).`,
                });
            }
        }
    };

    traverse(root);

    const content = await parseApiContentFromAgentWebMarkdownTree(storage, root, {
        documentId: pageLink?.id,
    });

    if (title !== null) {
        assert(pageNumber === 1);

        return {
            type: "HeadPage",
            pageNumber,
            isLastPage,
            title,
            content,
        };
    } else {
        if (!pageLink) {
            throw new InvalidArgumentError(
                "Can\u2019t create document as a tail page, can only create document as a head page",
                {
                    displayMessage: errorDisplayMessage`A title is required to create a document. Try again but start the new document with a Markdown h1 (e.g. \`# My Document\`).`,
                },
            );
        }

        return {
            type: "TailPage",
            pageNumber,
            isLastPage,
            content,
        };
    }
}
