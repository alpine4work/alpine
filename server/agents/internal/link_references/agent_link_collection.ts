import {
    agentMessageFirstPageTokenLimit,
    agentPaginationTokenLimitGrowthFactor,
} from "~/server/agents/internal/agent_limits.js";
import {
    DurableObjectStorageCollection,
    DurableObjectStorageInterface,
    DurableObjectTransactionInterface,
} from "~/server/agents/internal/durable_object_storage_collection.js";
import {
    AgentDocumentPageLink,
    AgentLink,
    AgentLinkPaginatedMessagesListPageInfo,
    AgentLinkPaginationType,
    AgentPaginatedMessagesListLink,
    AgentPostCommentsLink,
} from "~/server/agents/internal/link_references/agent_link.js";
import {createAgentLinkNotFoundError} from "~/server/agents/internal/link_references/create_agent_link_not_found_error.js";
import {
    printAgentLinkPath,
    printApiPathForAgentLink,
} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {ApiPath} from "~/shared/api/parse_api_path.js";
import {ApiTaskStatus} from "~/shared/api/types/api_specification_convenience_types.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
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

// Stores a map of AgentLinkPath -> AgentLinkReference. We use this to
// uniquely identify linked Alpine Content in agent conversations.
//
// So for a Document titled "My Document" the path would be `/document/my-document`
// or `/document/my-document-1` if there are multiple documents with the same title.
// The link would look like `[My Document](/document/my-document)` or
// `[My Document](/document/my-document-1)`.
const AgentLinkCollection = new DurableObjectStorageCollection<string, AgentLink>("a3");

const AgentLinkPathByApiPathCollection = new DurableObjectStorageCollection<ApiPath, string>("a4");

export const defaultAgentTaskCollectionStatusesFilter = new Set<ApiTaskStatus["type"]>(["Open"]);

export type CreateAgentLinkOptions =
    | {
          type: "Account";
          account: {
              id: AccountId;
              name: string;
              shortName?: string;
          };
      }
    | {
          type: "Chat";
          chat: {
              id: ChatId;
              name: string;
          };
      }
    | {
          type: "ChatMessage";
          chatId: ChatId;
          messageIndex: number;
          preview: string;
      }
    | {
          type: "Channel";
          channel: {
              id: ChannelId;
              name: string;
          };
      }
    | {
          type: "Document";
          document: {
              id: DocumentId;
              title: string;
          };
      }
    | {
          type: "DocumentComment";
          documentId: DocumentId;
          commentThreadId: DocumentCommentThreadId;
          commentIndex: number;
          preview: string;
      }
    | {
          type: "Post";
          post: {
              id: PostId;
              contentPreview: string;
          };
      }
    | {
          type: "PostComment";
          postId: PostId;
          commentIndex: number;
          preview: string;
      }
    | {
          type: "Task";
          task: {
              id: TaskId;
              title: string;
              status: ApiTaskStatus;
          };
      }
    | {
          type: "TaskComment";
          taskId: TaskId;
          commentIndex: number;
          preview: string;
      }
    | {
          type: "TaskCollection";
          taskCollection: {
              id: TaskCollectionId;
              name: string;
              statusesFilter?: ReadonlySet<ApiTaskStatus["type"]>;
          };
      };

export async function createAgentLink(
    storage: DurableObjectStorageInterface,
    options: CreateAgentLinkOptions,
): Promise<AgentLink> {
    switch (options.type) {
        case "Account": {
            const account = options.account;

            return actuallyPutAgentLink(storage, {
                type: "Account",
                accountId: account.id,
                name: account.shortName ?? account.name,
            });
        }
        case "Chat": {
            return actuallyPutAgentLink(storage, {
                type: "ChatMessages",
                chatId: options.chat.id,
                label: options.chat.name,
                rootMessage: null,
                ...getMessagesListPageInfo(0),
                tokenLimitForPage: agentMessageFirstPageTokenLimit,
            });
        }
        case "ChatMessage": {
            return actuallyPutAgentLink(storage, {
                type: "ChatMessages",
                chatId: options.chatId,
                ...getMessagesListPageInfo(options.messageIndex),
                label: options.preview,
                rootMessage: null,
                tokenLimitForPage: agentMessageFirstPageTokenLimit,
            });
        }
        case "Channel": {
            return actuallyPutAgentLink(storage, {
                type: "Channel",
                channelId: options.channel.id,
                name: options.channel.name,
            });
        }
        case "Document": {
            return actuallyPutAgentLink(storage, {
                type: "DocumentPage",
                documentId: options.document.id,
                title: options.document.title,
                localDocumentPage: null,
            });
        }
        case "DocumentComment": {
            return actuallyPutAgentLink(storage, {
                type: "DocumentCommentThreadComments",
                documentId: options.documentId,
                commentThreadId: options.commentThreadId,
                ...getMessagesListPageInfo(options.commentIndex),
                label: options.preview,
                rootMessage: null,
                tokenLimitForPage: agentMessageFirstPageTokenLimit,
            });
        }
        case "Post": {
            return actuallyPutAgentLink(storage, {
                type: "PostComments",
                postId: options.post.id,
                ...getMessagesListPageInfo(0),
                label: options.post.contentPreview ?? "Unknown",
                rootMessage: null,
                tokenLimitForPage: agentMessageFirstPageTokenLimit,
            });
        }
        case "PostComment": {
            return actuallyPutAgentLink(storage, {
                type: "PostComments",
                postId: options.postId,
                ...getMessagesListPageInfo(options.commentIndex),
                label: options.preview,
                rootMessage: null,
                tokenLimitForPage: agentMessageFirstPageTokenLimit,
            });
        }
        case "Task": {
            return actuallyPutAgentLink(storage, {
                type: "Task",
                taskId: options.task.id,
                title: options.task.title,
                status: options.task.status,
            });
        }
        case "TaskComment": {
            return actuallyPutAgentLink(storage, {
                type: "TaskComments",
                taskId: options.taskId,
                ...getMessagesListPageInfo(options.commentIndex),
                label: options.preview,
                rootMessage: null,
                tokenLimitForPage: agentMessageFirstPageTokenLimit,
            });
        }
        case "TaskCollection": {
            return actuallyPutAgentLink(storage, {
                type: "TaskCollection",
                collectionId: options.taskCollection.id,
                name: options.taskCollection.name,
                statusesFilter:
                    options.taskCollection.statusesFilter &&
                    options.taskCollection.statusesFilter.size > 0
                        ? options.taskCollection.statusesFilter
                        : defaultAgentTaskCollectionStatusesFilter,
            });
        }
        default: {
            throw exhaustive(options);
        }
    }

    function getMessagesListPageInfo(messageIndex: number): {
        paginationType: AgentLinkPaginationType;
        pageNumber: number;
        pageInfo: AgentLinkPaginatedMessagesListPageInfo;
    } {
        const paginationType = messageIndex === 0 ? "page" : "chunk";
        // Chunks are 0 indexed
        const pageNumber = paginationType === "page" ? 1 : 0;
        const pageInfo: AgentLinkPaginatedMessagesListPageInfo =
            paginationType === "page"
                ? {from: "Start", cursor: null}
                : {from: "Middle", index: messageIndex};

        return {paginationType, pageNumber, pageInfo};
    }
}

export async function putAgentDocumentPageLink(
    storage: DurableObjectStorageInterface,
    link: AgentDocumentPageLink,
): Promise<AgentDocumentPageLink> {
    return await actuallyPutAgentLink(storage, link);
}

export async function putAgentNextMessagesPageLink<
    MessagesListLink extends AgentPaginatedMessagesListLink | AgentPostCommentsLink,
>(
    storage: DurableObjectStorageInterface,
    currentPageLink: MessagesListLink,
    nextPageStartCursor: number,
): Promise<MessagesListLink> {
    return await actuallyPutAgentLink(storage, {
        ...currentPageLink,
        dedupeNumber: undefined,
        pageNumber: currentPageLink.pageNumber + 1,
        pageInfo: {
            from: "Start",
            cursor: nextPageStartCursor,
        },
        // Descendents of the original page should pass down the original dedupe number
        // to their descendents. In other words, it should have the same value for all
        // members in the chain of pages. Since `rootMessage` is always
        // null for the first page, we will set the first child's `rootMessage`
        // to the `dedupeNumber` of the parent (or 1 if the parent was not deduplicated).
        // See #dedupe-message-labels for more information.
        rootMessage: currentPageLink.rootMessage ?? {
            dedupeNumber: currentPageLink.dedupeNumber ?? 1,
        },

        tokenLimitForPage: Math.floor(
            currentPageLink.tokenLimitForPage * agentPaginationTokenLimitGrowthFactor,
        ),
    });
}

export async function putAgentPreviousMessagesPageLink<
    MessagesListLink extends AgentPaginatedMessagesListLink | AgentPostCommentsLink,
>(
    storage: DurableObjectStorageInterface,
    currentPageLink: MessagesListLink,
    previousPageEndCursor: number,
): Promise<MessagesListLink> {
    return await actuallyPutAgentLink(storage, {
        ...currentPageLink,
        dedupeNumber: undefined,
        pageNumber: currentPageLink.isMessageRoomPage
            ? // When initializing messages for a conversation, we start at the end of the conversation
              // and load "backwards". The first page is the last page of the conversation. This the only
              // time that we will show a "previous page" link for "page" pagination - all other times
              // we are paginating forward from the first page.
              currentPageLink.pageNumber + 1
            : currentPageLink.pageNumber - 1,
        pageInfo: {
            from: "End",
            cursor: previousPageEndCursor,
        },
        // Descendents of the original page should pass down the original dedupe number
        // to their descendents. In other words, it should have the same value for all
        // members in the chain of pages. Since `rootMessage` is always
        // null for the first page, we will set the first child's `rootMessage`
        // to the `dedupeNumber` of the parent (or 1 if the parent was not deduplicated).
        // See #dedupe-message-labels for more information.
        rootMessage: currentPageLink.rootMessage ?? {
            dedupeNumber: currentPageLink.dedupeNumber ?? 1,
        },

        tokenLimitForPage: Math.floor(
            currentPageLink.tokenLimitForPage * agentPaginationTokenLimitGrowthFactor,
        ),
    });
}

export async function listAgentLinksForTest(
    storage: DurableObjectStorageInterface,
): Promise<Map<string, AgentLink>> {
    assert(import.meta.jest);

    const dataMap = await AgentLinkCollection.list(storage);
    const resultMap = new Map<string, AgentLink>();

    for (const [key, data] of dataMap) {
        resultMap.set(key, data);
    }

    return resultMap;
}

export async function getAgentLink<Link extends AgentLink>(
    storage: DurableObjectStorageInterface,
    path: string,
): Promise<Link | undefined> {
    const data = await AgentLinkCollection.get(storage, path);
    if (!data) return undefined;

    return data as Link;
}

let putAgentContentLinkReferenceMutex: Mutex | null = null;

// NOTE(ifitzsimmons, #ai): This function is considered dangerous because it should
// not be used directly.
// Specifically, there are certain "hierarchical" entities like task comments that
// rely on the parent entity (Task) already existing in the collection. This is
// because we construct the link to the task comment like
// `/tasks/normalized-task-title?messsage=${commentIndex}`. So we need the task's
// title in order to appropriately construct the link to the comment. Further,
// two tasks can have the same title. In that case, we need to make sure that the
// comment on the second task gets the deduplicated task label:
// `/tasks/normalized-task-title-1?messsage=${commentIndex}`.
//
// Here's a more detailed explanation of the deduplication strategy and why
// it makes sense to encapsulate link reference creation in this function.
//
// Imagine the agent is asked to read 2 separate threads from 2 separate
// documents, both documents are titled "My Document". If we simply pass
// in the target path and document title as the label, both original link
// paths would be
//
// - Doc 1: `/document/my-document/thread`
// - Doc 2: `/document/my-document/thread`
//
// When inserting the link to these threads into the collection, we would
// deduplicate them to the following keys
//
// - Doc 1: `document/my-document/thread`
// - Doc 2: `document/my-document/thread-1`
//
// This will appear to be two separate threads on the same document. The
// correct deduplication strategy would be to use the following links
//
// - Doc 1: `/document/my-document/thread`
// - Doc 2: `/document/my-document-2/thread`
//
// In order to achieve this, we should generate the original link path for
// each link reference up front. So for example, if we receive a link to a
// document thread, we should
//
// 1. Generate an original link for the document and pass it to the link reference
//    class. This would look something like `/document/my-document`.
// 2. When we insert the document link into the collection, it will return the
//    original link plus any deduplication suffix. So it might return
//    `/document/my-document-1`
// 3. We should then generate the original link path for the thread. In this case,
//    we should use the final label from the link collection key (`my-document-1`) and
//    append `thread`. This would look something like `/document/my-document-1/thread`.
async function actuallyPutAgentLink<Link extends AgentLink>(
    storage: DurableObjectStorageInterface,
    originalLink: Link,
): Promise<Link> {
    assertValidAgentLink(originalLink);

    // Use a process-wide mutex to avoid concurrent calls writing different
    // mentions to the same label. This will be the only process ever writing to
    // storage so a process-wide mutex is safe.
    const run = (transaction: DurableObjectTransactionInterface) => {
        putAgentContentLinkReferenceMutex ??= new Mutex();

        return putAgentContentLinkReferenceMutex.withLock(async () => {
            let dedupeNumber = 1;
            let link = originalLink;
            let path = printAgentLinkPath(link);

            while (true) {
                const existingLink = await AgentLinkCollection.get(transaction, path);
                if (existingLink === undefined) break;

                if (isDeepEqual(existingLink, link)) break;

                link = {
                    ...link,
                    dedupeNumber: ++dedupeNumber,
                };

                if (path === printAgentLinkPath(link)) {
                    throw new InternalError("Deduplicating the link did not change the link path");
                }
                path = printAgentLinkPath(link);
            }

            await AgentLinkCollection.put(transaction, path, link);

            // Update reverse index for fast lookups by target path
            await AgentLinkPathByApiPathCollection.put(
                transaction,
                // NOTE(ifitzsimmons): The reverse index for a MessagesList or LocalDocumentPage
                // may not be unique. For instance, we create one link per page of Chat Messages,
                // but the API path for every chat message page is the same:
                // `/chats/${chatId}/messages`.
                //
                // We believe that this is okay, because we don't currently have any use cases
                // for looking up a specific page and expecting to get a link back.
                printApiPathForAgentLink(link),
                path,
            );

            return link;
        });
    };

    // Make sure we're running in a transaction in addition to the process-wide
    // mutex to really make sure we're not writing to the same label concurrently.
    if ("rollback" in storage) {
        return run(storage);
    } else {
        return storage.transaction(run);
    }
}

/**
 * Normalizes a link label to be used in agent conversations.
 * Creates a URL-friendly slug format suitable for link identifiers.
 *
 * My document -> my-document
 */
export function normalizeMarkdownLinkLabelForPath(
    label: string,
    options?: {maxLength?: number},
): string {
    const maxLength = options?.maxLength ?? 50;
    let normalized = label.trim().replace(/\s+/g, " ");

    normalized = normalized
        .toLowerCase()
        // Replace ampersands with "and" so `D&D` becomes `d-and-d` instead of `d-d`
        .replaceAll("&", "-and-")
        .replaceAll(/[^a-z0-9]+/g, "-");

    if (normalized.length > maxLength) {
        normalized = normalized.slice(0, maxLength);
        normalized = normalized.replace(/[-\s]+$/, "");
    }

    // Remove leading and trailing hyphens
    normalized = normalized.replace(/^-+|-+$/g, "");

    // Return fallback if normalized string is empty
    if (normalized.length === 0) {
        return "untitled";
    }

    return normalized;
}

/**
 * Find an existing link by its target API path.
 * Uses the reverse index for fast O(1) lookup.
 */
export async function findAgentLinkForApiPath(
    storage: DurableObjectStorageInterface,
    targetPath: ApiPath,
): Promise<AgentLink> {
    const link = await findAgentLinkForApiPathIfExists(storage, targetPath);
    if (!link) {
        throw createAgentLinkNotFoundError(targetPath);
    }

    return link;
}

/**
 * Find an existing link by its target API path.
 * Uses the reverse index for fast O(1) lookup.
 */
export async function findAgentLinkForApiPathIfExists(
    storage: DurableObjectStorageInterface,
    targetPath: ApiPath,
): Promise<AgentLink | undefined> {
    const path = await AgentLinkPathByApiPathCollection.get(storage, targetPath);
    if (!path) return undefined;

    return getAgentLink<AgentLink>(storage, path);
}

function assertValidAgentLink(link: AgentLink): void {
    switch (link.type) {
        case "DocumentPage": {
            // NOTE(ifitzsimmons): We should never createa link for the first page of
            // a document. We load the first page when the document is read. If we
            // ever change document loading such that we can load from the middle, we'd
            // need to change this. In the meantime, we never expect to receive a local
            // document page link with `pageNumber <= 1`.
            if (!link.localDocumentPage || link.localDocumentPage.pageNumber > 1) return;
            throw new InvalidArgumentError("Document page number cannot be less than 2");
        }
        case "ChatMessages":
        case "DocumentCommentThreadComments":
        case "PostComments":
        case "TaskComments": {
            if (link.paginationType === "page" && link.pageNumber < 1) {
                throw new InvalidArgumentError("Message page number cannot be less than one.");
            }
            return;
        }
        case "Account":
        case "Channel":
        case "Task":
        case "TaskCollection":
            return;
        default: {
            throw exhaustive(link);
        }
    }
}
