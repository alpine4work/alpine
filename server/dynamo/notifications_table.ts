import {getChat} from "~/server/dynamo/chat_table";
import {RequestContext, SystemRequestContext} from "~/server/dynamo/context/request_context";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {NotFoundError} from "~/shared/error/error";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";

const NotificationsTable = DynamoTableSchema.new({
    name: "Notifications",
    partitions: [
        {
            name: "Inbox",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        inboxGeneration: Schema.integer,
                        loudNotificationCount: Schema.integer.min(0),
                    }),
                },
                {
                    name: "ChatEntry",
                    sortKeyAttributes: {
                        chatId: DynamoKeyAttributeSchema.id<ChatId>(),
                    },
                    attributes: Schema.object({
                        isArchived: Schema.boolean,
                        // sortTime: Schema.date,
                        loudNotificationCount: Schema.integer.min(0),
                    }),
                },
                {
                    name: "PostEntry",
                    sortKeyAttributes: {
                        postId: DynamoKeyAttributeSchema.id<PostId>(),
                    },
                    attributes: Schema.object({
                        isArchived: Schema.boolean,
                        // sortTime: Schema.date,
                        loudNotificationCount: Schema.integer.min(0),
                    }),
                },
                {
                    name: "DocumentCommentThreadEntry",
                    sortKeyAttributes: {
                        documentId: DynamoKeyAttributeSchema.id<DocumentId>(),
                        commentThreadId: DynamoKeyAttributeSchema.id<DocumentCommentThreadId>(),
                    },
                    attributes: Schema.object({
                        isArchived: Schema.boolean,
                        // sortTime: Schema.date,
                        loudNotificationCount: Schema.integer.min(0),
                    }),
                },
                {
                    name: "NewChannelPostsEntry",
                    sortKeyAttributes: {
                        channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
                        inboxGeneration: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        isArchived: Schema.boolean,
                        // sortTime: Schema.date,
                    }),
                },
            ],
        },
    ],
});

// NotificationsTable.addIndex({
//     name: "InboxEntries",
//     itemTypes: [
//         {partitionType: "Inbox", sortRangeType: "ChatEntry"},
//         {partitionType: "Inbox", sortRangeType: "PostEntry"},
//         {partitionType: "Inbox", sortRangeType: "DocumentCommentThreadEntry"},
//         {partitionType: "Inbox", sortRangeType: "NewChannelPostsEntry"},
//     ],
//     partitionKeyAttributes: {
//         spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
//         accountId: DynamoKeyAttributeSchema.id<AccountId>(),
//     },
//     sortKeyAttributes: {
//         isArchived: DynamoKeyAttributeSchema.boolean,
//         sortTime: DynamoKeyAttributeSchema.date,
//     },
// });

type NotificationEvent =
    | NotificationCreateChatMessageEvent
    | NotificationCreatePostCommentEvent
    | NotificationCreateDocumentCommentEvent
    | NotificationCreatePostEvent;

type NotificationCreateChatMessageEvent = {
    readonly type: "CreateChatMessage";
    readonly time: Date;
    readonly chatId: ChatId;
    readonly authorId: AccountId;
    readonly mentionedAccountIds: ReadonlyArray<AccountId>;
};

type NotificationCreatePostCommentEvent = {
    readonly type: "CreatePostComment";
    readonly time: Date;
    readonly postId: PostId;
    readonly authorId: AccountId;
    readonly mentionedAccountIds: ReadonlyArray<AccountId>;
};

type NotificationCreateDocumentCommentEvent = {
    readonly type: "CreateDocumentComment";
    readonly time: Date;
    readonly documentId: DocumentId;
    readonly commentThreadId: DocumentCommentThreadId;
    readonly authorId: AccountId;
    readonly mentionedAccountIds: ReadonlyArray<AccountId>;
};

type NotificationCreatePostEvent = {
    readonly type: "CreatePost";
    readonly time: Date;
    readonly postId: PostId;
    readonly authorId: AccountId;
    readonly mentionedAccountIds: ReadonlyArray<AccountId>;
};

function processNotificationEvent(context: SystemRequestContext, event: NotificationEvent) {
    return context.tracer.withSpan("processNotificationEvent", async (context, span) => {
        span.addData({notifications: {event: event.type}});

        switch (event.type) {
            case "CreateChatMessage":
                return processNotificationCreateChatMessageEvent(context, event);
            case "CreatePostComment":
                return processNotificationCreatePostCommentEvent(context, event);
            case "CreateDocumentComment":
                return processNotificationCreateDocumentCommentEvent(context, event);
            case "CreatePost":
                return processNotificationCreatePostEvent(context, event);
            default:
                throw exhaustive(event);
        }
    });
}

async function processNotificationCreateChatMessageEvent(
    context: SystemRequestContext,
    event: NotificationCreateChatMessageEvent,
) {
    const chat = await getChat(context.system.impersonateAccount(event.authorId), event.chatId);
}

async function processNotificationCreatePostCommentEvent(
    context: SystemRequestContext,
    event: NotificationCreatePostCommentEvent,
) {}

async function processNotificationCreateDocumentCommentEvent(
    context: SystemRequestContext,
    event: NotificationCreateDocumentCommentEvent,
) {}

async function processNotificationCreatePostEvent(
    context: SystemRequestContext,
    event: NotificationCreatePostEvent,
) {}

// const NotificationsTable = DynamoTableSchema.new({
//     name: "Notifications",
//     partitions: [
//         {
//             name: "Inbox",
//             partitionKeyAttributes: {
//                 spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
//                 accountId: DynamoKeyAttributeSchema.id<AccountId>(),
//             },
//             sortRanges: [
//                 {
//                     name: "Attributes",
//                     sortKeyAttributes: {},
//                     attributes: Schema.object({
//                         // TODO(calebmer): Frozen after attribute?
//                     }),
//                 },
//                 {
//                     name: "Entry",
//                     sortKeyAttributes: {
//                         // TODO(calebmer): Sorting attribute?
//                     },
//                     attributes: Schema.object({
//                         // TODO(calebmer): Read/unread attribute?
//                     }),
//                 },
//             ],
//         },
//         {
//             name: "InboxArchive",
//             partitionKeyAttributes: {
//                 spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
//                 accountId: DynamoKeyAttributeSchema.id<AccountId>(),
//             },
//             sortRanges: [
//                 {
//                     name: "Entry",
//                     sortKeyAttributes: {},
//                     attributes: Schema.object({}),
//                 },
//             ],
//         },
//     ],
// });
