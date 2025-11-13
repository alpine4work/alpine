import {AgentLocalDocumentKey} from "~/server/agents/internal/link_references/agent_local_document_content_collection.js";
import {ApiTaskStatus} from "~/shared/api/types/api_specification_convenience_types.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

/**
 * When paginating message content, we use "page" when loading messages from the
 * start of the list. Otherwise, we use "chunk".
 * Message pages are split by tokens, so when when iterating from the start of a
 * conversation, we know exactly what page we're on. But when iterating from the
 * middle / end, we can't reliably determine what page we're on without loading
 * the entire conversation and splitting it by tokens, which would be incredibly
 * inefficient.
 * We believe that using the term "page" when possible will be more intuitive for
 * the LLM.
 */
export type AgentLinkPaginationType = "page" | "chunk";

export type AgentLinkPaginatedMessagesListPageInfo =
    | {
          readonly from: "Start";
          readonly index: number;
      }
    | {
          readonly from: "Middle";
          readonly index: number;
      }
    | {
          readonly from: "End";
          readonly index: number;
      };
type AgentLinkPaginatedMessagesListCommonOptions<
    PageInfo extends AgentLinkPaginatedMessagesListPageInfo = AgentLinkPaginatedMessagesListPageInfo,
> = {
    readonly paginationType: AgentLinkPaginationType;
    readonly pageNumber: number;
    readonly pageInfo: PageInfo;

    readonly dedupeNumber?: number;

    // NOTE(ifitzsimmons, #dedupe-message-labels): Let's say we have two chat messages
    // come in, bot with the label "Hello world". We would create links with paths
    // "/chat/hello-world" (Link A) and "/chat/hello-world-2" (Link B). We then deduplicate
    // next page links with a `version` query parameter. For example,
    //
    // The next page of "/chat/hello-world" is "/chat/hello-world?page=2" and
    // the next page of "/chat/hello-world-2" is "/chat/hello-world-2?page=2".
    //
    // It's important that we maintain the label deduplication number as we paginate
    // through a list of messages. This will not be set for the first page in any list
    // of pages.
    //
    // Now let's say the agent re-reads the first page of "/chat/hello-world". The next page
    // has changed and let's say starts at message index 10. We should create a new link with
    // path "/chat/hello-world?page=2&version=2" to indicate to the LLM that the page has
    // changed.
    //
    // Let's walk through the above scenario with only one dedupe number in the object,
    // `dedupeNumber`:
    //
    // - "/chat/hello-world" -> "/chat/hello-world?page=2"
    // - "/chat/hello-world-2" -> "/chat/hello-world-2?page=2"
    //
    // This looks fine enough. But now let's say the agent re-reads the Link A
    // ("/chat/hello-world") and it changes the start index of page 2.
    // - It will try to create a new link for Link A page 2, setting the `dedupeNumber` to 2.
    // - It will try to create the second version of Page 2 for Link A at
    //   "/chat/hello-world-2?page=2", but that also exists and is occupied by Link B page 2.
    // - *It will set the `dedupeNumber` to 3 and try to create the new link for Link A page 2
    //   at "/chat/hello-world-3?page=2", which will succeed.*
    //
    // Hopefully, it's pretty obvious that this is wrong. *The second page of
    // "/chat/hello-world" is now "/chat/hello-world-3?page=2".*
    //
    // We **need** 2 dedupe numbers, one to track whether this **message** is a duplicate of
    // another **message** and one to track whether this **page** for a given message is a
    // duplicate **page** for that same message.
    /**
     * This will ALWAYS be null for the first page and it will always be at least 1
     * for all other pages.
     *
     * We can think about pages of messages as a tree. The first page that the agent sees
     * is the root, and all other pages are children of the root.
     *
     * See long note above this definition for more information on the decision to use 2
     * dedupe number fields.
     */
    readonly rootMessage: {
        readonly dedupeNumber: number;
    } | null;
};

export type AgentPaginatedMessagesListLink<
    PageInfo extends AgentLinkPaginatedMessagesListPageInfo = AgentLinkPaginatedMessagesListPageInfo,
> =
    | (AgentLinkPaginatedMessagesListCommonOptions<PageInfo> & {
          readonly type: "ChatMessages";
          readonly chatId: ChatId;

          // Either the preview of the message OR the name of the chat.
          readonly label: string;
      })
    | (AgentLinkPaginatedMessagesListCommonOptions<PageInfo> & {
          readonly type: "DocumentCommentThreadComments";
          readonly documentId: DocumentId;
          readonly commentThreadId: DocumentCommentThreadId;

          // the preview of the first message in the thread that the agent sees
          readonly label: string;
      })
    | (AgentLinkPaginatedMessagesListCommonOptions<PageInfo> & {
          readonly type: "TaskComments";
          readonly taskId: TaskId;

          // Either the title of the task or the preview of the first comment
          // that the agent sees
          readonly label: string;
      });

// NOTE(ifitzsimmons, #ai): Post comments are a special case because the first "message" in
// the list of messages is the post itself. So `/posts/messages/{index}` is not the first
// message. Therefore, the data loading logic is different than the other message list links.
export type AgentPostCommentsLink<
    PageInfo extends AgentLinkPaginatedMessagesListPageInfo = AgentLinkPaginatedMessagesListPageInfo,
> = AgentLinkPaginatedMessagesListCommonOptions<PageInfo> & {
    readonly type: "PostComments";
    readonly postId: PostId;

    // Either the preview of the post or the preview of the first comment
    // that the agent sees
    readonly label: string;
};

export type AgentLocalDocumentPageLink = {
    readonly localDocumentVersion: number;
    readonly pageNumber: number;

    readonly documentKey: AgentLocalDocumentKey;
    readonly pageStartElementIndex: number;
    readonly pageEndElementIndexExclusive: number;
    readonly previousPageAgentLinkString: string | null;
    readonly nextPageAgentLinkString: string | null;
};

export type AgentAccountLink = {
    readonly type: "Account";
    readonly accountId: AccountId;
    readonly dedupeNumber?: number;

    // e.g. "Alice Smith"
    readonly name: string;
};

export type AgentChannelLink = {
    readonly type: "Channel";
    readonly channelId: ChannelId;
    readonly dedupeNumber?: number;

    // e.g. "General Discussion"
    readonly name: string;
};

export type AgentDocumentPageLink = {
    readonly type: "DocumentPage";
    readonly documentId: DocumentId;
    readonly dedupeNumber?: number;

    // e.g. "My Document"
    readonly title: string;

    readonly localDocumentPage: AgentLocalDocumentPageLink | null;
};

export type AgentTaskLink = {
    readonly type: "Task";
    readonly taskId: TaskId;
    readonly dedupeNumber?: number;

    // e.g. "Fix Bug #123"
    readonly title: string;
    readonly status: ApiTaskStatus;
};

export type AgentTaskCollectionLink = {
    readonly type: "TaskCollection";
    readonly collectionId: TaskCollectionId;
    readonly dedupeNumber?: number;

    // e.g. "Product Launch Tasks"
    readonly name: string;
};

/**
 * Exhaustive list of Alpine links that the agent will see and use with
 * the read_link took.
 * These are the paths that appear in markdown links like [label](path).
 *
 * So for a Document titled "My Document" the path would be `/document/my-document`
 * or `/document/my-document-1` if there are multiple documents with the same title.
 * The link would look like `[My Document](/document/my-document)` or
 * `[My Document](/document/my-document-1)`.
 */
export type AgentLink =
    | AgentPaginatedMessagesListLink
    | AgentAccountLink
    | AgentChannelLink
    | AgentDocumentPageLink
    | AgentPostCommentsLink
    | AgentTaskLink
    | AgentTaskCollectionLink;
