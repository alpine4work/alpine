import {
    AgentLink,
    AgentLinkPaginationType,
    AgentPaginatedMessagesListLink,
    AgentPostCommentsLink,
} from "~/server/agents/bots/internal/link_references/agent_link.js";
import {normalizeMarkdownLinkLabelForPath} from "~/server/agents/bots/internal/link_references/agent_link_collection.js";
import {ApiPath} from "~/shared/api/specification/parse_api_path.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function printAgentLinkPath(link: AgentLink) {
    if (isLinkMessageRoomPage(link)) {
        return `/room${printPaginationQueryString(link, link.paginationType)}`;
    }

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
                // If the root message was deduped, use that number. If `rootMessage` is null, then
                // this is the root message – so use the current dedupe number. For more, see
                // #dedupe-message-labels.
                link.rootMessage ? link.rootMessage.dedupeNumber : link.dedupeNumber,
            );
            const paginationQueryString = printPaginationQueryString(link, link.paginationType);

            return `/chat/${chatMessageLabel}${paginationQueryString}`;
        }
        case "DocumentCommentThreadComments": {
            const documentCommentThreadLabel = dedupeAgentLinkPath(
                link.label,
                // If the root message was deduped, use that number. If `rootMessage` is null, then
                // this is the root message – so use the current dedupe number. For more, see
                // #dedupe-message-labels.
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
            // will get a query parameter, but we never actually create a link for the first
            // page.
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
                // If the root message was deduped, use that number. If `rootMessage` is null, then
                // this is the root message – so use the current dedupe number. For more, see
                // #dedupe-message-labels.
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
                // If the root message was deduped, use that number. If `rootMessage` is null, then
                // this is the root message – so use the current dedupe number. For more, see
                // #dedupe-message-labels.
                link.rootMessage ? link.rootMessage.dedupeNumber : link.dedupeNumber,
            );
            const paginationQueryString = printPaginationQueryString(link, link.paginationType);

            return `/task-comments/${taskCommentLabel}${paginationQueryString}`;
        }
        case "Site": {
            const siteLabel = dedupeAgentLinkPath(link.name, link.dedupeNumber);
            return `/site/${siteLabel}`;
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

// TODO(calebmer, #api-path-destruction): Why return a string here when we just
// have to parse it back into an object when we use the path? Why not return an
// `ApiTarget` object and avoid the print-to-string then parse-from-string
// roundtrip? We may be able to get rid of `ApiPath` entirely (and related helpers)
// after this.
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
        case "Site": {
            // TODO(#site-api): Implement site API.
            return `/sites/${link.siteId}`;
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
        case "Site": {
            return link.name;
        }
        case "Task": {
            // Intentionally not including whether the task is active in this label. Keeping
            // things simple for the agent. The agent can read the task to see whether it's
            // active.
            return `${link.title} ${link.status.type === "Open" ? "(Open)" : "(Closed)"}`;
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

function isLinkMessageRoomPage(
    link: AgentLink,
): link is (AgentPaginatedMessagesListLink | AgentPostCommentsLink) & {isMessageRoomPage: true} {
    switch (link.type) {
        case "ChatMessages":
        case "DocumentCommentThreadComments":
        case "TaskComments":
        case "PostComments":
            return !!link.isMessageRoomPage;
        case "Account":
        case "Channel":
        case "DocumentPage":
        case "Site":
        case "Task":
        case "TaskCollection":
            return false;
        default:
            throw exhaustive(link);
    }
}
