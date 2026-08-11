import {themeColors} from "~/shared/design/core/theme_colors.js";
import {
    compareHybridLogicalTimes,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SiteId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    compareSearchChatEntityVersion,
    compareSearchPostEntityVersions,
    compareSearchTaskEntityTitleVersions,
} from "~/shared/search/compare_search_entity_versions.js";
import {
    SearchAffinityEntityId,
    SearchEntityId,
    SearchEntityIdSchema,
    SearchStaticEntityId,
    isSearchAffinityEntityId,
} from "~/shared/search/search_entity_id.js";
import {SiteItemSearchEntityIdSchema} from "~/shared/search/site_item_search_entity_id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskTitleSnapshotSchema} from "~/shared/tasks/title/task_title.js";

export type SearchEntityModelId = Exclude<SearchEntityId, `Account:${AccountId}`>;

export function assertSearchEntityModelId(entityId: SearchEntityId): SearchEntityModelId {
    assert(isSearchEntityModelId(entityId));
    return entityId;
}

export function isSearchEntityModelId(entityId: SearchEntityId): entityId is SearchEntityModelId {
    return !entityId.startsWith("Account:");
}

const SearchEntityModelBaseDataSchema = Schema.object({
    title: Schema.string.nullable(),
});

export const SearchChannelEntityModelDataSchema = SearchEntityModelBaseDataSchema.merge(
    Schema.object({
        type: Schema.value("Channel"),
        channel: Schema.object({
            id: Schema.id<ChannelId>(),
            version: Schema.integer,
        }),
    }),
);

export type SearchChatEntityMediaModel = SchemaType<typeof SearchChatEntityMediaModelSchema>;
export const SearchChatEntityMediaModelSchema = Schema.union({
    Account: Schema.object({
        type: Schema.value("Account"),
        account: AccountModel.schema,
    }),
    AccountPile: Schema.object({
        type: Schema.value("AccountPile"),
        previewAccounts: Schema.array(AccountModel.schema).minLength(1),
        // If `null` then we have an unknown number of total accounts.
        accountCount: Schema.integer.nullable(),
    }),
});

export const SearchChatEntityModelDataSchema = SearchEntityModelBaseDataSchema.merge(
    Schema.object({
        type: Schema.value("Chat"),
        chat: Schema.object({
            id: Schema.id<ChatId>(),
            // TODO(#add-chat-version-to-search-index)
            version: Schema.integer.nullable(),
            media: SearchChatEntityMediaModelSchema,
        }),
    }),
);

export const SearchDocumentEntityModelDataSchema = SearchEntityModelBaseDataSchema.merge(
    Schema.object({
        type: Schema.value("Document"),
        document: Schema.object({
            id: Schema.id<DocumentId>(),
            version: Schema.integer,
        }),
    }),
);

export const SearchTaskEntityModelDataSchema = SearchEntityModelBaseDataSchema.merge(
    Schema.object({
        type: Schema.value("Task"),
        task: Schema.object({
            id: Schema.id<TaskId>(),
            titleSnapshot: TaskTitleSnapshotSchema,
            deletedTime: HybridLogicalTimeSchema.optional(),
            // This does not map cleanly to one field in the task data model. It uses the max
            // version across status, assignee, and assignee status. To see how it's computed,
            // see `getTaskSearchEntityBase()`
            displayStatus: Schema.object({
                value: Schema.enum(["OpenInactive", "OpenActive", "Closed"]),
                version: HybridLogicalTimeSchema,
            }),
        }),
    }),
);

export const SearchTaskCollectionEntityModelDataSchema = SearchEntityModelBaseDataSchema.merge(
    Schema.object({
        type: Schema.value("TaskCollection"),
        collection: Schema.object({
            id: Schema.id<TaskCollectionId>(),
            titleVersion: HybridLogicalTimeSchema,
            color: Schema.object({
                value: Schema.enum(themeColors).nullable(),
                version: HybridLogicalTimeSchema.default(zeroHybridLogicalTime),
            }),
        }),
    }),
);

export const SearchPostEntityModelDataSchema = SearchEntityModelBaseDataSchema.merge(
    Schema.object({
        type: Schema.value("Post"),
        post: Schema.object({
            id: Schema.id<PostId>(),
            version: Schema.integer,
            channelVersion: Schema.integer,
            author: AccountModel.schema,
        }),
    }),
);

const SearchSiteEntityModelDataSchema = SearchEntityModelBaseDataSchema.merge(
    Schema.object({
        type: Schema.value("Site"),
        site: Schema.object({
            id: Schema.id<SiteId>(),
            version: Schema.integer,
            firstEntityId: SiteItemSearchEntityIdSchema.nullable(),
        }),
    }),
);

const SearchAffinityEntityModelDataUnionSchema = {
    Static: SearchEntityModelBaseDataSchema.merge(
        Schema.object({
            type: Schema.value("Static"),
            id: Schema.value("TaskPersonal"),
        }),
    ),
    Channel: SearchChannelEntityModelDataSchema,
    Chat: SearchChatEntityModelDataSchema,
    Document: SearchDocumentEntityModelDataSchema,
    Task: SearchTaskEntityModelDataSchema,
    TaskCollection: SearchTaskCollectionEntityModelDataSchema,
    Site: SearchSiteEntityModelDataSchema,
} as const;

export type SearchAffinityEntityModelData = SchemaType<typeof SearchAffinityEntityModelDataSchema>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SearchAffinityEntityModelDataSchema = Schema.union(SearchAffinityEntityModelDataUnionSchema);

const SearchEntityMessageBaseDataSchema = Schema.object({title: Schema.value(null)});

export type SearchEntityModelData = SchemaType<typeof SearchEntityModelDataSchema>;
export const SearchEntityModelDataSchema = Schema.union({
    ...SearchAffinityEntityModelDataUnionSchema,
    DocumentComment: SearchEntityMessageBaseDataSchema.merge(
        Schema.object({
            type: Schema.value("DocumentComment"),
            comment: Schema.object({
                documentId: Schema.id<DocumentId>(),
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
                index: Schema.integer,
                author: AccountModel.schema,
            }),
        }),
    ),
    ChatMessage: SearchEntityMessageBaseDataSchema.merge(
        Schema.object({
            type: Schema.value("ChatMessage"),
            message: Schema.object({
                chatId: Schema.id<ChatId>(),
                index: Schema.integer,
                author: AccountModel.schema,
            }),
        }),
    ),
    TaskComment: SearchEntityMessageBaseDataSchema.merge(
        Schema.object({
            type: Schema.value("TaskComment"),
            comment: Schema.object({
                taskId: Schema.id<TaskId>(),
                index: Schema.integer,
                author: AccountModel.schema,
            }),
        }),
    ),
    PostComment: SearchEntityMessageBaseDataSchema.merge(
        Schema.object({
            type: Schema.value("PostComment"),
            comment: Schema.object({
                postId: Schema.id<PostId>(),
                index: Schema.integer,
                author: AccountModel.schema,
            }),
        }),
    ),
    Static: SearchEntityModelBaseDataSchema.merge(
        Schema.object({
            type: Schema.value("Static"),
            id: SearchEntityIdSchema as Schema<SearchStaticEntityId>,
        }),
    ),
    Post: SearchPostEntityModelDataSchema,
});

// A shared characteristic of all search entity model data is that it has a `title`
// property. We ensure that is always true by asserting that
// `SearchEntityModelData` is assignable to `{title: string | null}`.
assertAssignableTypes<SearchEntityModelData, {title: string | null}>();

assertAssignableTypes<SearchAffinityEntityModelData, SearchEntityModelData>();

export type SearchEntityModelDataWithAccount =
    | SearchEntityModelData
    | {
          type: "Account";
          account: AccountModel;
          title: string;
      };

/**
 * Model representing a search entity on the client. Search entity is a standard
 * interface for all content in our system so we can reference objects in a
 * consistent way throughout the product.
 *
 * We don't allow accounts as search entity models. Instead use `AccountModel` so
 * we don't end up with conflicting versions of the same data.
 *
 * The data for `SearchEntityModel` is in an `initialData` property. You're
 * discouraged from using the `initialData` property on the client. Instead you
 * should use `SearchEntityClientStore` which normalizes search entities so you see
 * consistent data for each individual search entity and if a search entity updates
 * in one place it updates everywhere.
 */
export class SearchEntityModel {
    declare private _id: SearchEntityModelId | null;

    /**
     * Don't use this property on the client! Use `SearchEntityClientStore` to get the
     * latest data for this search entity.
     */
    public readonly initialData: SearchEntityModelData;

    constructor(initialData: SearchEntityModelData) {
        Object.defineProperty(this, "_id", {
            enumerable: false,
            value: null,
            writable: true,
        });
        this.initialData = initialData;
    }

    public get id(): SearchEntityModelId {
        // The entity's id is immutable, so it's safe to use the initial data to compute it.
        // eslint-disable-next-line cyberworlds/no-model-initial-data
        this._id ??= printSearchEntityModelId(this.initialData);
        return this._id;
    }

    public static readonly schema = SearchEntityModelDataSchema.transform<SearchEntityModel>({
        // Serializing the model over the network is fine. Generally only the
        // server serializes data over the network for the client.
        //
        // eslint-disable-next-line cyberworlds/no-model-initial-data
        serialize: entity => entity.initialData,
        deserialize: entity => new SearchEntityModel(entity),
    });

    /**
     * Also implemented by `AccountModel` so you can call `getSearchEntityId()` on
     * `SearchEntityModel | AccountModel` to get the `SearchEntityId`.
     */
    public getSearchEntityId(): SearchEntityModelId {
        return this.id;
    }

    /**
     * Merge two `SearchEntityModel`s together.
     *
     * You should generally pass in the older data into `oldData` and newer data to
     * `newData`. So we avoid unnecessary re-renders when the data is equal (and
     * `oldData` is preferred) and in case we don't have clear version information we
     * prefer the newer data (`newData`).
     */
    public static mergeData(
        oldData: SearchEntityModelData,
        newData: SearchEntityModelData,
    ): SearchEntityModelData {
        return mergeSearchEntityData(oldData, newData);
    }

    public merge(otherEntity: SearchEntityModel): SearchEntityModel {
        // Used when merging `SearchEntityModel`s to reconcile to models and get the latest
        // data. So accessing `initialData` is required to do that. (This is the mechanism
        // that helps keeps `SearchEntityRegistry` up-to-date.)
        /* eslint-disable cyberworlds/no-model-initial-data */
        const data = SearchEntityModel.mergeData(this.initialData, otherEntity.initialData);
        if (data === this.initialData) return this;
        if (data === otherEntity.initialData) return otherEntity;
        return new SearchEntityModel(data);
        /* eslint-enable cyberworlds/no-model-initial-data */
    }
}

/**
 * Returns true if the search entity is a deleted entity. Messages and comments are
 * never considered deleted even though their titles are always null.
 */
export function isDeletedSearchEntity(entityData: SearchEntityModelData): boolean {
    switch (entityData.type) {
        case "Document":
        case "Task":
        case "TaskCollection":
            return entityData.title === null;
        case "Channel":
        case "Chat":
        case "DocumentComment":
        case "ChatMessage":
        case "TaskComment":
        case "PostComment":
        case "Static":
        case "Post":
        case "Site":
            return false;
        default:
            throw exhaustive(entityData);
    }
}

/**
 * Variant of `SearchEntityModel` that only supports search entities that collect
 * affinity points. So search entities with an `id` of `SearchAffinityEntityId`.
 *
 * If you call `new SearchAffinityEntityModel()` it returns a `SearchEntityModel`.
 */
export interface SearchAffinityEntityModel extends SearchEntityModel {
    readonly id: SearchEntityModelId & SearchAffinityEntityId;

    readonly initialData: SearchAffinityEntityModelData;

    getSearchEntityId(): SearchEntityModelId & SearchAffinityEntityId;
}

export const SearchAffinityEntityModel: {
    // TypeScript treats `new` as a keyword and not a property when it doesn't have
    // quotes when generating a `.d.ts` file.
    "new"(initialData: SearchAffinityEntityModelData): SearchAffinityEntityModel;
} = {
    new(initialData: SearchAffinityEntityModelData): SearchAffinityEntityModel {
        return new SearchEntityModel(initialData) as SearchAffinityEntityModel;
    },
};

export function printSearchEntityModelId(data: SearchEntityModelData): SearchEntityModelId {
    if (data.type === "Static") return data.id;

    switch (data.type) {
        case "Channel":
            return `Channel:${data.channel.id}`;
        case "Chat":
            return `Chat:${data.chat.id}`;
        case "Document":
            return `Document:${data.document.id}`;
        case "Post":
            return `Post:${data.post.id}`;
        case "Task":
            return `Task:${data.task.id}`;
        case "TaskCollection":
            return `TaskCollection:${data.collection.id}`;
        case "Site":
            return `Site:${data.site.id}`;
        case "DocumentComment":
            return `DocumentComment:${data.comment.documentId}-${data.comment.commentThreadId}-${data.comment.index}`;
        case "ChatMessage":
            return `ChatMessage:${data.message.chatId}-${data.message.index}`;
        case "TaskComment":
            return `TaskComment:${data.comment.taskId}-${data.comment.index}`;
        case "PostComment":
            return `PostComment:${data.comment.postId}-${data.comment.index}`;
        default:
            throw exhaustive(data);
    }
}

export function printSearchEntityWithAccountModelId(
    data: SearchEntityModelDataWithAccount,
): SearchEntityModelId | `Account:${AccountId}` {
    if (data.type === "Account") return `Account:${data.account.id}`;

    return printSearchEntityModelId(data);
}

export function isSearchAffinityEntityModelData(
    data: SearchEntityModelData,
): data is SearchAffinityEntityModelData {
    const modelId = printSearchEntityModelId(data);
    return isSearchEntityModelId(modelId) && isSearchAffinityEntityId(modelId);
}

export function mergeSearchEntityData(
    oldEntity: SearchEntityModelData,
    newEntity: SearchEntityModelData,
): SearchEntityModelData {
    assert(printSearchEntityModelId(oldEntity) === printSearchEntityModelId(newEntity));

    switch (oldEntity.type) {
        case "Channel": {
            assert(newEntity.type === oldEntity.type);
            const oldVersion = oldEntity.channel.version;
            const newVersion = newEntity.channel.version;

            if (
                oldVersion > newVersion ||
                (oldVersion === newVersion && oldEntity.title === newEntity.title)
            ) {
                return oldEntity;
            }

            return newEntity;
        }
        case "Document": {
            assert(newEntity.type === oldEntity.type);
            const oldVersion = oldEntity.document.version;
            const newVersion = newEntity.document.version;

            if (
                oldVersion > newVersion ||
                (oldVersion === newVersion && oldEntity.title === newEntity.title)
            ) {
                return oldEntity;
            }

            return newEntity;
        }
        case "Static": {
            assert(newEntity.type === oldEntity.type);
            if (oldEntity.title === newEntity.title) return oldEntity;

            return newEntity;
        }
        case "Chat": {
            assert(newEntity.type === oldEntity.type);
            const mergedMedia = mergeAccountOrAccountPileMedia(
                oldEntity.chat.media,
                newEntity.chat.media,
            );

            const chatVersionCompare = compareSearchChatEntityVersion(
                oldEntity.chat.version,
                newEntity.chat.version,
            );
            const isOldTitleNewerOrEqualWithSameValue =
                chatVersionCompare > 0 ||
                (chatVersionCompare === 0 && oldEntity.title === newEntity.title);

            // If old entity's chat version is newer or if it's equal with the same title AND
            // the merged media is the same as the old entity's media, return the old entity.
            if (isOldTitleNewerOrEqualWithSameValue && mergedMedia === oldEntity.chat.media) {
                return oldEntity;
            }

            // If new entity's chat version is newer or it's equal with a different title AND
            // the merged media is the same as the new entity's media, return the new entity.
            if (chatVersionCompare <= 0 && mergedMedia === newEntity.chat.media) return newEntity;

            return {
                ...newEntity,
                chat: {
                    ...newEntity.chat,
                    media: mergedMedia,
                },
            };
        }
        case "Task": {
            assert(newEntity.type === oldEntity.type);

            const titleVersionCompare = compareSearchTaskEntityTitleVersions(
                oldEntity.task,
                newEntity.task,
            );
            const isOldTitleNewerOrEqualWithSameValue =
                titleVersionCompare > 0 ||
                (titleVersionCompare === 0 && oldEntity.title === newEntity.title);

            let mergedDisplayStatus = oldEntity.task.displayStatus;
            const displayStatusCompare = compareHybridLogicalTimes(
                oldEntity.task.displayStatus.version,
                newEntity.task.displayStatus.version,
            );
            if (displayStatusCompare < 0) mergedDisplayStatus = newEntity.task.displayStatus;

            // If old entity's title version is newer or if it's equal with the same title AND
            // the merged display status is the same as the old entity's display status.
            if (
                isOldTitleNewerOrEqualWithSameValue &&
                mergedDisplayStatus === oldEntity.task.displayStatus
            ) {
                return oldEntity;
            }

            // If new entity's title version is newer or it's equal with a different title AND
            // the merged display status is the same as the new entity's display status, return
            // the new entity.
            if (titleVersionCompare <= 0 && mergedDisplayStatus === newEntity.task.displayStatus) {
                return newEntity;
            }

            return {
                ...newEntity,
                task: {
                    ...newEntity.task,
                    displayStatus: mergedDisplayStatus,
                },
            };
        }
        case "TaskCollection": {
            assert(newEntity.type === "TaskCollection");

            const titleVersionCompare = compareHybridLogicalTimes(
                oldEntity.collection.titleVersion,
                newEntity.collection.titleVersion,
            );

            const isOldTitleNewerOrEqualWithSameValue =
                titleVersionCompare > 0 ||
                (titleVersionCompare === 0 && oldEntity.title === newEntity.title);

            let mergedColor = oldEntity.collection.color;
            const colorCompare = compareHybridLogicalTimes(
                oldEntity.collection.color.version,
                newEntity.collection.color.version,
            );
            if (colorCompare < 0) mergedColor = newEntity.collection.color;

            if (isOldTitleNewerOrEqualWithSameValue && mergedColor === oldEntity.collection.color) {
                return oldEntity;
            }

            if (titleVersionCompare <= 0 && mergedColor === newEntity.collection.color) {
                return newEntity;
            }

            return {
                ...newEntity,
                collection: {
                    ...newEntity.collection,
                    color: mergedColor,
                },
            };
        }
        case "Post": {
            assert(oldEntity.type === newEntity.type);

            const postVersionCompare = compareSearchPostEntityVersions(
                oldEntity.post,
                newEntity.post,
            );
            const isOldTitleNewerOrEqualWithSameValue =
                postVersionCompare > 0 ||
                (postVersionCompare === 0 && oldEntity.title === newEntity.title);

            const mergedAuthor = oldEntity.post.author.merge(newEntity.post.author);

            if (isOldTitleNewerOrEqualWithSameValue && mergedAuthor === oldEntity.post.author) {
                return oldEntity;
            }

            if (postVersionCompare <= 0 && mergedAuthor === newEntity.post.author) return newEntity;

            return {
                ...newEntity,
                post: {
                    ...newEntity.post,
                    author: mergedAuthor,
                },
            };
        }
        case "ChatMessage": {
            assert(oldEntity.type === newEntity.type);
            const author = oldEntity.message.author.merge(newEntity.message.author);

            if (author === oldEntity.message.author) {
                return oldEntity;
            } else {
                return newEntity;
            }
        }
        case "DocumentComment":
        case "PostComment":
        case "TaskComment": {
            assert(oldEntity.type === newEntity.type);
            const author = oldEntity.comment.author.merge(newEntity.comment.author);

            if (author === oldEntity.comment.author) {
                return oldEntity;
            } else {
                return newEntity;
            }
        }
        case "Site": {
            assert(newEntity.type === "Site");
            const oldVersion = oldEntity.site.version;
            const newVersion = newEntity.site.version;

            const isOldVersionNewerOrEqualWithSameTitle =
                oldVersion > newVersion ||
                (oldVersion === newVersion && oldEntity.title === newEntity.title);
            const isNewVersionNewerOrEqual = newVersion >= oldVersion;

            let mergedFirstEntityId = oldEntity.site.firstEntityId;
            if (oldVersion < newVersion) {
                mergedFirstEntityId = newEntity.site.firstEntityId;
            }

            if (
                isOldVersionNewerOrEqualWithSameTitle &&
                mergedFirstEntityId === oldEntity.site.firstEntityId
            ) {
                return oldEntity;
            }

            if (isNewVersionNewerOrEqual && mergedFirstEntityId === newEntity.site.firstEntityId) {
                return newEntity;
            }

            return {
                ...newEntity,
                site: {
                    ...newEntity.site,
                    firstEntityId: mergedFirstEntityId,
                },
            };
        }
        default:
            throw exhaustive(oldEntity);
    }
}

export function mergeAccountOrAccountPileMedia(
    oldMedia: SearchChatEntityMediaModel,
    newMedia: SearchChatEntityMediaModel,
): SearchChatEntityMediaModel {
    switch (oldMedia.type) {
        case "Account": {
            if (oldMedia.type !== newMedia.type) return newMedia;

            const mergedAccount = oldMedia.account.merge(newMedia.account);
            if (mergedAccount === oldMedia.account) return oldMedia;
            if (mergedAccount === newMedia.account) return newMedia;

            return {type: "Account", account: mergedAccount};
        }
        case "AccountPile": {
            if (oldMedia.type !== newMedia.type) return newMedia;

            let hasNewMediaChanged = false;

            const mergedPreviewAccounts = newMedia.previewAccounts.map(newAccount => {
                const oldAccount = oldMedia.previewAccounts.find(
                    oldAccount => oldAccount.id === newAccount.id,
                );
                if (!oldAccount) return newAccount;

                const mergedAccount = oldAccount.merge(newAccount);
                if (mergedAccount === newAccount) return newAccount;

                hasNewMediaChanged = true;
                return mergedAccount;
            });

            // If `newMedia` is exactly equal to `oldMedia` then return `oldMedia` to reduce
            // re-renders.
            if (
                oldMedia.accountCount === newMedia.accountCount &&
                oldMedia.previewAccounts.length === newMedia.previewAccounts.length &&
                mergedPreviewAccounts.every((account, i) => account === oldMedia.previewAccounts[i])
            ) {
                return oldMedia;
            }

            if (!hasNewMediaChanged) return newMedia;

            return {
                type: "AccountPile",
                previewAccounts: mergedPreviewAccounts,
                accountCount: newMedia.accountCount,
            };
        }
        default:
            throw exhaustive(oldMedia);
    }
}
