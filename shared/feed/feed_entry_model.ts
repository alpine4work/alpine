import {FileChatEntityModelSchema} from "~/shared/chat/file_chat_entity_model_schema.js";
import {FileDocumentEntityModelSchema} from "~/shared/documents/file_document_entity_model_schema.js";
import {createRynamoItemSchema} from "~/shared/dynamo/rynamo_types.js";
import {FeedEntryEventSchema, FeedTaskEntryEventSchema} from "~/shared/feed/feed_entry_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileChannelEntityModelSchema} from "~/shared/forum/file_channel_entity_model_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {SearchEntityId} from "~/shared/search/search_entity_id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {FileTaskCollectionEntityModelSchema} from "~/shared/tasks/file_task_collection_entity_model.js";
import {FileTaskEntityModelSchema} from "~/shared/tasks/file_task_entity_model.js";

export type FeedEntryModel = SchemaType<typeof FeedEntryModelSchema>;

assertAssignableTypes<FeedEntryModel, {getId: () => string}>();

assertAssignableTypes<
    Exclude<FeedEntryModel, FeedWelcomeEntryModel>,
    {getId: () => SearchEntityId}
>();

// Common properties needed to render `<FeedEntryView>`.
assertAssignableTypes<
    Exclude<FeedEntryModel, FeedWelcomeEntryModel | FeedPostEntryModel>,
    {
        sharer: AccountModel;
        sharedTime: Date;
        getId: () => FileEntityId;
    }
>();

export class FeedWelcomeEntryModel extends Model(
    Schema.object({
        addedTime: Schema.date,
        emailDomainWithAutoAddAccountsEnabled: Schema.string.nullable().default(null),
    }),
) {
    public readonly type = "Welcome";

    public getId() {
        return "Welcome";
    }
}

export class FeedPostEntryModel extends Model(
    Schema.object({
        post: createRynamoItemSchema(PostModel.schema()),
    }),
) {
    public readonly type = "Post";

    public getId(): SearchEntityId {
        return `Post:${this.post.model.id}`;
    }
}

export class FeedDocumentEntryModel extends Model(
    Schema.object({
        sharer: AccountModel.schema,
        sharedTime: Schema.date,
        event: FeedEntryEventSchema,
        document: FileDocumentEntityModelSchema.omit(["type"]),
    }),
) {
    public readonly type = "Document";

    public getId(): FileEntityId {
        return `Document:${this.document.id}`;
    }
}

export class FeedTaskEntryModel extends Model(
    Schema.object({
        sharer: AccountModel.schema,
        sharedTime: Schema.date,
        event: FeedTaskEntryEventSchema,
        task: FileTaskEntityModelSchema.omit(["type"]),
    }),
) {
    public readonly type = "Task";

    public getId(): FileEntityId {
        return `Task:${this.task.task.id}`;
    }
}

export class FeedTaskCollectionEntryModel extends Model(
    Schema.object({
        sharer: AccountModel.schema,
        sharedTime: Schema.date,
        event: FeedEntryEventSchema,
        collection: FileTaskCollectionEntityModelSchema.omit(["type"]),
    }),
) {
    public readonly type = "TaskCollection";

    public getId(): FileEntityId {
        return `TaskCollection:${this.collection.collection.id}`;
    }
}

export class FeedChannelEntryModel extends Model(
    Schema.object({
        sharer: AccountModel.schema,
        sharedTime: Schema.date,
        event: FeedEntryEventSchema,
        channel: FileChannelEntityModelSchema.omit(["type"]),
    }),
) {
    public readonly type = "Channel";

    public getId(): FileEntityId {
        return `Channel:${this.channel.id}`;
    }
}

export class FeedChatEntryModel extends Model(
    Schema.object({
        sharer: AccountModel.schema,
        sharedTime: Schema.date,
        event: FeedEntryEventSchema,
        chat: FileChatEntityModelSchema.omit(["type"]),
    }),
) {
    public readonly type = "Chat";

    public getId(): FileEntityId {
        return `Chat:${this.chat.id}`;
    }
}

export const FeedEntryModelSchema = createModelUnionSchema({
    Welcome: FeedWelcomeEntryModel,
    Post: FeedPostEntryModel,
    Document: FeedDocumentEntryModel,
    Task: FeedTaskEntryModel,
    TaskCollection: FeedTaskCollectionEntryModel,
    Channel: FeedChannelEntryModel,
    Chat: FeedChatEntryModel,
});
