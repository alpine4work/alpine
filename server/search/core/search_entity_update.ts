import {
    SearchEntityDependencyId,
    isSearchEntityIdAlsoEntityDependencyId,
} from "~/server/search/core/search_entity_dependency_id.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DatabaseTableId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SiteId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    SearchDynamicEntityIdObject,
    printSearchDynamicEntityId,
} from "~/shared/search/search_entity_id.js";

/**
 * Describes an update to a search entity. This type is the same as
 * `SearchDynamicEntityIdObject` (to identify the entity being updated) but with an
 * `updatedTraits` property (to identify the attributes on the entity that were
 * updated).
 *
 * `updatedTraits` is an array of the traits that were affected by this update. A
 * trait is an arbitrary subset of attributes on the entity we care about
 * specifically depending on. So we don't need to depend on the entire entity.
 *
 * For example, you can depend on the `Authorization` trait on a `Task` entity.
 * That way if a task's title or notes change you don't need to re-index since
 * those aren't `Authorization` attributes.
 *
 * If `updatedTraits` is `Any` then any of the entity's traits could have been
 * updated. `Any` is typically used either when everything is updated (the entity
 * was just created) or we don't precisely know what updated.
 *
 * If `updateTraits` is `None` then none of the entity's traits were updated. The
 * update was a noop. We may use this when we need to reindex an entity because a
 * dependency changed but the entity itself didn't change.
 */
export type SearchEntityUpdate = {
    [Type in keyof typeof searchEntityUpdateSchemaDescription]: MergeObjectIntersection<
        SchemaType<(typeof searchEntityUpdateSchemaDescription)[Type]["schema"]> & {
            readonly updatedTraits:
                | {readonly type: "None"}
                | {readonly type: "Any"}
                | {
                      readonly type: "Some";
                      readonly traits: ReadonlyArray<
                          (typeof searchEntityUpdateSchemaDescription)[Type]["updatableTraits"][number]
                      >;
                  };
        }
    >;
}[keyof typeof searchEntityUpdateSchemaDescription];

// `SearchEntityUpdate` should be the same as `SearchDynamicEntityIdObject` but
// with an `updatedTraits` property.
assertEqualTypes<
    SearchDynamicEntityIdObject,
    DistributiveOmit<SearchEntityUpdate, "updatedTraits">
>();

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
        updatableTraits: ["WithoutSpace"],
    },
    Document: {
        schema: Schema.object({
            type: Schema.value("Document"),
            documentId: Schema.id<DocumentId>(),
        }),
        updatableTraits: ["Authorization", "Title"],
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
    DatabaseTable: {
        schema: Schema.object({
            type: Schema.value("DatabaseTable"),
            tableId: Schema.id<DatabaseTableId>(),
        }),
        updatableTraits: ["Name"],
    },
    Channel: {
        schema: Schema.object({
            type: Schema.value("Channel"),
            channelId: Schema.id<ChannelId>(),
        }),
        updatableTraits: ["Authorization", "Preview"],
    },
    Post: {
        schema: Schema.object({
            type: Schema.value("Post"),
            postId: Schema.id<PostId>(),
        }),
        updatableTraits: ["Title"],
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
        updatableTraits: ["Definition"],
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
        updatableTraits: ["Authorization", "Title"],
    },
    TaskCollection: {
        schema: Schema.object({
            type: Schema.value("TaskCollection"),
            collectionId: Schema.id<TaskCollectionId>(),
        }),
        updatableTraits: ["Authorization", "Name"],
    },
    TaskComment: {
        schema: Schema.object({
            type: Schema.value("TaskComment"),
            taskId: Schema.id<TaskId>(),
            commentIndex: Schema.integer,
        }),
        updatableTraits: [],
    },
    Site: {
        schema: Schema.object({
            type: Schema.value("Site"),
            siteId: Schema.id<SiteId>(),
        }),
        updatableTraits: ["Preview"],
    },
} as const;

export const SearchEntityUpdateSchema = Schema.union(
    mapObjectValues(searchEntityUpdateSchemaDescription, ({schema, updatableTraits}) => {
        return schema.merge(
            Schema.object({
                updatedTraits: Schema.union({
                    None: Schema.object({type: Schema.value("None")}),
                    Any: Schema.object({type: Schema.value("Any")}),
                    Some: Schema.object({
                        type: Schema.value("Some"),
                        traits: Schema.array(Schema.enum(updatableTraits)),
                    }),
                }),
            }),
        );
    }) as any,
) as Schema<SearchEntityUpdate>;

/**
 * Get the `SearchEntityDependencyId`s affected by the `SearchEntityUpdate` object.
 * Anything in `updatedTraits` is updated.
 */
export function getSearchEntityDependencyIdsAffectedByUpdate(
    update: SearchEntityUpdate,
): Array<SearchEntityDependencyId> {
    const ids: Array<SearchEntityDependencyId> = [];

    switch (update.updatedTraits.type) {
        case "None": {
            break;
        }
        case "Any": {
            const primaryId = printSearchDynamicEntityId(update);

            if (isSearchEntityIdAlsoEntityDependencyId(primaryId)) {
                ids.push(primaryId);
            }

            for (const trait of searchEntityUpdateSchemaDescription[update.type].updatableTraits) {
                ids.push(`${primaryId}:${trait}` as SearchEntityDependencyId);
            }
            break;
        }
        case "Some": {
            const primaryId = printSearchDynamicEntityId(update);

            if (isSearchEntityIdAlsoEntityDependencyId(primaryId)) {
                ids.push(primaryId);
            }

            for (const trait of update.updatedTraits.traits) {
                ids.push(`${primaryId}:${trait}` as SearchEntityDependencyId);
            }
            break;
        }
        default:
            throw exhaustive(update.updatedTraits);
    }

    return ids;
}
