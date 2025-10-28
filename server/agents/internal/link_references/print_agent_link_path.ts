import {
    AgentLink,
    AgentLinkPaginationType,
    AgentPaginatedMessagesListLink,
    AgentPostCommentsLink,
} from "~/server/agents/internal/link_references/agent_link.js";
import {normalizeMarkdownLinkLabelForPath} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {ApiPath} from "~/shared/api/parse_api_path.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function printAgentLinkPath(link: AgentLink) {
    switch (link.type) {
        case "Account": {
            const label = dedupeAgentLinkPath(link.name, link.dedupeNumber);
            return `/account/${label}`;
        }
        case "Channel": {
            const label = dedupeAgentLinkPath(link.name, link.dedupeNumber);
            return `/channel/${label}`;
        }
        case "ChatMessages": {
            // In case two chats have the same label, this will dedup them
            const chatMessageLabel = dedupeAgentLinkPath(
                link.label,
                // If the root message was deduped, use that number. If `rootMessage` is null,
                // then this is the root message – so use the current dedupe  number.
                // For more, see #dedupe-message-labels.
                link.rootMessage ? link.rootMessage.dedupeNumber : link.dedupeNumber,
            );
            const paginationQueryString = printPaginationQueryString(link, link.paginationType);

            return `/chat/${chatMessageLabel}${paginationQueryString}`;
        }
        case "DocumentCommentThreadComments": {
            const documentCommentThreadLabel = dedupeAgentLinkPath(
                link.label,
                // If the root message was deduped, use that number. If `rootMessage` is null,
                // then this is the root message – so use the current dedupe  number.
                // For more, see #dedupe-message-labels.
                link.rootMessage ? link.rootMessage.dedupeNumber : link.dedupeNumber,
            );
            const paginationQueryString = printPaginationQueryString(link, link.paginationType);
            return `/document-thread/${documentCommentThreadLabel}${paginationQueryString}`;
        }
        case "DocumentPage": {
            const documentLabel = dedupeAgentLinkPath(link.title, link.dedupeNumber);

            if (!link.localDocumentPage) return `/document/${documentLabel}`;

            const {localDocumentVersion} = link.localDocumentPage;
            const searchParams = new URLSearchParams();
            // NOTE(ifitzsimmons): This technically means that the first page of the document
            // will get a query parameter, but we never actually create a link for the first page.
            searchParams.set("page", link.localDocumentPage.pageNumber.toString());

            if (localDocumentVersion > 1) {
                searchParams.set("version", localDocumentVersion.toString());
            }

            const searchParamsString = searchParams.size > 0 ? `?${searchParams.toString()}` : "";

            return `/document/${documentLabel}${searchParamsString}`;
        }
        case "PostComments": {
            const postCommentLabel = dedupeAgentLinkPath(
                link.label,
                // If the root message was deduped, use that number. If `rootMessage` is null,
                // then this is the root message – so use the current dedupe  number.
                // For more, see #dedupe-message-labels.
                link.rootMessage ? link.rootMessage.dedupeNumber : link.dedupeNumber,
            );
            const paginationQueryString = printPaginationQueryString(link, link.paginationType);

            return `/post/${postCommentLabel}${paginationQueryString}`;
        }
        case "Task": {
            const taskLabel = dedupeAgentLinkPath(link.title, link.dedupeNumber);
            return `/task/${taskLabel}`;
        }
        case "TaskCollection": {
            const taskCollectionLabel = dedupeAgentLinkPath(link.name, link.dedupeNumber);
            return `/task-collection/${taskCollectionLabel}`;
        }
        case "TaskComments": {
            const taskCommentLabel = dedupeAgentLinkPath(
                link.label,
                // If the root message was deduped, use that number. If `rootMessage` is null,
                // then this is the root message – so use the current dedupe  number.
                // For more, see #dedupe-message-labels.
                link.rootMessage ? link.rootMessage.dedupeNumber : link.dedupeNumber,
            );
            const paginationQueryString = printPaginationQueryString(link, link.paginationType);

            return `/task-comments/${taskCommentLabel}${paginationQueryString}`;
        }
        default:
            throw exhaustive(link);
    }

    function dedupeAgentLinkPath(plainTextLabel: string, dedupeNumber: number | undefined): string {
        const normalizedLabel = normalizeMarkdownLinkLabelForPath(plainTextLabel);
        return `${normalizedLabel}${dedupeNumber && dedupeNumber > 1 ? `-${dedupeNumber}` : ""}`;
    }

    function printPaginationQueryString(
        link: AgentPaginatedMessagesListLink | AgentPostCommentsLink,
        paginationType: AgentLinkPaginationType,
    ): string {
        // Don't show query parameters for the first page of a list. (chunks are 0 indexed
        // while pages are 1 indexed.)
        if (paginationType === "page" && link.pageNumber === 1) return "";
        if (paginationType === "chunk" && link.pageNumber === 0) return "";

        const searchParams = new URLSearchParams();
        searchParams.set(paginationType, link.pageNumber.toString());

        if (link.dedupeNumber && link.dedupeNumber > 1) {
            searchParams.set("version", link.dedupeNumber.toString());
        }

        return `?${searchParams.toString()}`;
    }
}

export function printApiPathForAgentLink(link: AgentLink): ApiPath {
    switch (link.type) {
        case "Account": {
            return `/accounts/${link.accountId}`;
        }
        case "Channel": {
            return `/channels/${link.channelId}`;
        }
        case "ChatMessages": {
            return `/chats/${link.chatId}/messages`;
        }
        case "DocumentPage": {
            return `/documents/${link.documentId}`;
        }
        case "DocumentCommentThreadComments": {
            return `/documents/${link.documentId}/threads/${link.commentThreadId}/messages`;
        }
        case "PostComments": {
            return `/posts/${link.postId}/messages`;
        }
        case "Task": {
            return `/tasks/${link.taskId}`;
        }
        case "TaskCollection": {
            return `/task-collections/${link.collectionId}`;
        }
        case "TaskComments": {
            return `/tasks/${link.taskId}/messages`;
        }
        default: {
            throw exhaustive(link);
        }
    }
}

export function printAgentPlainTextLabel(link: AgentLink): string {
    switch (link.type) {
        case "Account": {
            return link.name;
        }
        case "Channel": {
            return link.name;
        }
        case "ChatMessages": {
            return link.label;
        }
        case "DocumentPage": {
            return link.title;
        }
        case "DocumentCommentThreadComments": {
            return link.label;
        }
        case "PostComments": {
            return link.label;
        }
        case "Task": {
            return link.title;
        }
        case "TaskComments": {
            return link.label;
        }
        case "TaskCollection": {
            return link.name;
        }
        default:
            throw exhaustive(link);
    }
}
