import {SearchEntityDependencyId} from "~/server/search/core/search_entity_dependency_id.js";
import {SearchEntityIdObject, printSearchEntityId} from "~/server/search/core/search_entity_id.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
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
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Describes an update to a search entity. This type is the same as
 * `SearchEntityIdObject` (to identify the entity being updated) but with an
 * `updatedTraits` property (to identify the attributes on the entity
 * that were updated).
 *
 * `updatedTraits` is an array of the traits that were affected by this update.
 * A trait is an arbitrary subset of attributes on the entity we care about
 * specifically depending on. So we don't need to depend on the entire entity.
 *
 * For example, you can depend on the `Authorization` trait on a `Task` entity.
 * That way if a task's title or notes change you don't need to re-index since
 * those aren't `Authorization` attributes.
 */
export type SearchEntityUpdate = {
    [Type in keyof typeof searchEntityUpdateSchemaDescription]: MergeObjectIntersection<
        SchemaType<(typeof searchEntityUpdateSchemaDescription)[Type]["schema"]> & {
            readonly updatedTraits: ReadonlyArray<
                (typeof searchEntityUpdateSchemaDescription)[Type]["updatableTraits"][number]
            >;
        }
    >;
}[keyof typeof searchEntityUpdateSchemaDescription];

// `SearchEntityUpdate` should be the same as
// `SearchEntityIdObject` but with an `updatedTraits` property.
assertEqualTypes<SearchEntityIdObject, DistributiveOmit<SearchEntityUpdate, "updatedTraits">>();

// `SearchEntityUpdate`'s `updatedTraits` should be the same as the traits in
// `SearchEntityDependencyId`. This makes sure
// `getSearchEntityDependencyIdsFromUpdate()`'s implementation is safe.
{
    type TestActual = {
        [Type in keyof typeof searchEntityUpdateSchemaDescription]: `${Type}:${string}:${(typeof searchEntityUpdateSchemaDescription)[Type]["updatableTraits"][number]}`;
    }[keyof typeof searchEntityUpdateSchemaDescription];

    type MassageTestExpected<Id> = Id extends `${infer IdType}:${string}:${infer IdTraits}`
        ? `${IdType}:${string}:${IdTraits}`
        : never;

    type TestExpected = MassageTestExpected<SearchEntityDependencyId>;

    assertEqualTypes<TestActual, TestExpected>();
}

const searchEntityUpdateSchemaDescription = {
    Account: {
        schema: Schema.object({
            type: Schema.value("Account"),
            accountId: Schema.id<AccountId>(),
        }),
        updatableTraits: [],
    },
    Document: {
        schema: Schema.object({
            type: Schema.value("Document"),
            documentId: Schema.id<DocumentId>(),
        }),
        updatableTraits: ["Title"],
    },
    DocumentComment: {
        schema: Schema.object({
            type: Schema.value("DocumentComment"),
            documentId: Schema.id<DocumentId>(),
            commentThreadId: Schema.id<DocumentCommentThreadId>(),
            commentIndex: Schema.integer,
        }),
        updatableTraits: [],
    },
    Channel: {
        schema: Schema.object({
            type: Schema.value("Channel"),
            channelId: Schema.id<ChannelId>(),
        }),
        updatableTraits: ["Preview"],
    },
    Post: {
        schema: Schema.object({
            type: Schema.value("Post"),
            postId: Schema.id<PostId>(),
        }),
        updatableTraits: [],
    },
    PostComment: {
        schema: Schema.object({
            type: Schema.value("PostComment"),
            postId: Schema.id<PostId>(),
            commentIndex: Schema.integer,
        }),
        updatableTraits: [],
    },
    Chat: {
        schema: Schema.object({
            type: Schema.value("Chat"),
            chatId: Schema.id<ChatId>(),
        }),
        updatableTraits: [],
    },
    ChatMessage: {
        schema: Schema.object({
            type: Schema.value("ChatMessage"),
            chatId: Schema.id<ChatId>(),
            messageIndex: Schema.integer,
        }),
        updatableTraits: [],
    },
    Task: {
        schema: Schema.object({
            type: Schema.value("Task"),
            taskId: Schema.id<TaskId>(),
        }),
        updatableTraits: ["Authorization"],
    },
    TaskCollection: {
        schema: Schema.object({
            type: Schema.value("TaskCollection"),
            collectionId: Schema.id<TaskCollectionId>(),
        }),
        updatableTraits: ["Authorization"],
    },
} as const;

export const SearchEntityUpdateSchema = Schema.union(
    mapObjectValues(searchEntityUpdateSchemaDescription, ({schema, updatableTraits}) => {
        return schema.merge(
            Schema.object({
                updatedTraits: Schema.union({
                    Any: Schema.object({type: Schema.value("Any")}),
                    Specific: Schema.object({
                        type: Schema.value("Specific"),
                        attributes: Schema.array(Schema.enum(updatableTraits)),
                    }),
                }),
            }),
        );
    }) as any,
) as Schema<SearchEntityUpdate>;

/**
 * Get the `SearchEntityDependencyId`s affected by the `SearchEntityUpdate`
 * object. Anything in `updatedTraits` is updated.
 */
export function getSearchEntityDependencyIdsAffectedByUpdate(
    update: SearchEntityUpdate,
): Array<SearchEntityDependencyId> {
    const ids: Array<SearchEntityDependencyId> = [];
    const primaryId = printSearchEntityId(update);

    ids.push(primaryId);

    for (const trait of update.updatedTraits) {
        ids.push(`${primaryId}:${trait}` as SearchEntityDependencyId);
    }

    return ids;
}
