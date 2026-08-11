import {
    convertApiReferenceKeyToLowercase,
    parseApiReferenceKey,
    printApiReferenceKey,
} from "~/shared/api/specification/api_reference_key.open_source.js";
import type {ApiReference} from "~/shared/api/specification/types/api_reference.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";

const accountId = generateId<AccountId>();
const channelId = generateId<ChannelId>();
const chatId = generateId<ChatId>();
const documentId = generateId<DocumentId>();
const documentCommentThreadId = generateId<DocumentCommentThreadId>();
const postId = generateId<PostId>();
const taskId = generateId<TaskId>();
const taskCollectionId = generateId<TaskCollectionId>();

const references: ReadonlyArray<ApiReference> = [
    {type: "Account", id: accountId},
    {type: "Channel", id: channelId},
    {type: "Chat", id: chatId},
    {type: "ChatMessage", id: chatId, index: 1},
    {type: "Document", id: documentId},
    {
        type: "DocumentMessage",
        document: {id: documentId},
        id: documentCommentThreadId,
        index: 2,
    },
    {type: "DocumentThread", document: {id: documentId}, id: documentCommentThreadId},
    {type: "Post", id: postId},
    {type: "PostMessage", id: postId, index: 3},
    {type: "Task", id: taskId},
    {type: "TaskMessage", id: taskId, index: 4},
    {type: "TaskCollection", id: taskCollectionId},
];

test.each(references)("parses $type target keys", reference => {
    expect(parseApiReferenceKey(printApiReferenceKey(reference))).toEqual(reference);
});

test.each(references)("converts $type target keys to lowercase", reference => {
    const key = convertApiReferenceKeyToLowercase(printApiReferenceKey(reference));
    expect(key).toEqual(key.toLowerCase());
});
