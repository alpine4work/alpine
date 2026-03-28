import {Root} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
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

    {
        const firstChild = root.children[0];

        if (firstChild?.type === "heading" && firstChild.depth === 1) {
            root.children.shift();
            title = printMarkdownPhrasingContentText(firstChild.children);
        }
    }

    if (pageLink) {
        const pageLinkPath = new UrlPath(pageLink.path);
        pageNumber = parseInt(pageLinkPath.searchParams.get("page") ?? "1", 10);

        const lastChild = root.children[root.children.length - 1];

        if (
            lastChild?.type === "paragraph" &&
            lastChild.children.length === 1 &&
            lastChild.children[0]!.type === "link" &&
            lastChild.children[0].url.startsWith("/")
        ) {
            const nextPageLinkPath = new UrlPath(lastChild.children[0].url);

            if (
                pageLinkPath.pathname === nextPageLinkPath.pathname &&
                nextPageLinkPath.searchParams.get("page") === `${pageNumber + 1}`
            ) {
                root.children.pop();
                isLastPage = false;
            }
        }
    }

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
        return {
            type: "TailPage",
            pageNumber,
            isLastPage,
            content,
        };
    }
}
