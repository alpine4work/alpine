import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoGeneralRealtimeTableItemType,
    DynamoGeneralRealtimeTableSchema,
} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {LocalAccessPolicySchema} from "~/shared/access/access_policy.js";
import {DynamoGeneralRealtimeEventStub} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {
    AccountId,
    SiteId,
    SiteSideBarId,
    SiteSideBarSectionId,
    SiteTopBarId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";
import {
    SiteItemSearchEntityId,
    SiteItemSearchEntityIdSchema,
} from "~/shared/search/site_item_search_entity_id.js";
import {SiteRootContainerId} from "~/shared/sites/site_entry_id.js";
import {
    SiteEntityEntrySchema,
    SiteSideBarEntrySchema,
    SiteSideBarSectionEntrySchema,
    SiteTopBarEntrySchema,
} from "~/shared/sites/site_entry_schema.js";
import {
    SiteEntityModel,
    SitePreviewModel,
    SiteSideBarModel,
    SiteSideBarSectionModel,
    SiteTopBarModel,
    isSiteSearchEntityModelData,
} from "~/shared/sites/site_model.js";
import {SiteBroadcastRealtimeEventTransactionSchema} from "~/shared/sites/site_realtime_protocol.js";

/**
 * Sites Realtime Table
 *
 * Stores site data with realtime update support. The table has one partition
 * (Site) with three sort ranges:
 *
 * - Attributes: Core site metadata (name, access policy, etc.)
 * - Container: Site navigation containers (TopBar, SideBar, SideBarSection)
 * - EntityRef: References to Alpine entities (Document, Channel, etc.)
 *
 * The site tree is stored as a flat list of items with parentId references. The
 * tree is constructed on read by the client using the parentId relationships.
 *
 * Sort key structure:
 *
 * - Attributes: `Site#<siteId>#Attributes`
 * - Container: `Site#<siteId>#Container#<containerId>`
 * - EntityRef: `Site#<siteId>#Entity#<entityId>` (e.g., Entity#Document:abc123)
 *
 * This structure allows:
 *
 * - Efficient lookup of all items in a site (query by partition key)
 * - Direct lookup of a specific container by ID
 * - Direct lookup of an EntityRef by entityId (for entity deletion handling)
 */
export const SitesTable = DynamoGeneralRealtimeTableSchema.new({
    features: {
        realtimeQuery: {Site: true},
        deleteItem: {Site: {Entity: true, TopBar: true, SideBar: true, SideBarSection: true}},
    },
    name: "Sites",
    partitions: [
        {
            name: "Site",
            partitionKeyAttributes: {
                siteId: DynamoKeyAttributeSchema.id<SiteId>(),
            },
            sortRanges: [
                /**
                 * Core attributes of the site including name, access policy, and metadata.
                 */
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),
                        name: LabelStringSchema,
                        accessPolicy: LocalAccessPolicySchema,
                        createdTime: Schema.date,
                        creatorId: Schema.id<AccountId>(),
                        updatedTime: Schema.date,
                        /**
                         * The first entity to display when the site is loaded. This is the "home page" of
                         * the site, computed via DFS traversal of the site tree. Updated on every write
                         * that affects the tree structure.
                         */
                        firstEntityId: SiteItemSearchEntityIdSchema.nullable(),

                        /**
                         * The site's root container — always either a TopBar or a SideBar. Created
                         * atomically with the site itself in `createSite` so this is never null.
                         */
                        rootContainerId: Schema.string as Schema<SiteRootContainerId>,
                    }),
                },

                /**
                 * TopBar container. Can only be root (parentId: null).
                 *
                 * Children: SideBar, EntityRef
                 */
                {
                    name: "TopBar",
                    sortKeyAttributes: {
                        id: DynamoKeyAttributeSchema.id<SiteTopBarId>(),
                    },
                    attributes: SiteTopBarEntrySchema,
                },

                /**
                 * SideBar container. Can be root (parentId: null) or child of TopBar.
                 *
                 * Children: SideBarSection, EntityRef
                 */
                {
                    name: "SideBar",
                    sortKeyAttributes: {
                        id: DynamoKeyAttributeSchema.id<SiteSideBarId>(),
                    },
                    attributes: SiteSideBarEntrySchema,
                },

                /**
                 * SideBarSection container. Must have a parent (SideBar or SideBarSection).
                 *
                 * Children: SideBarSection, EntityRef
                 */
                {
                    name: "SideBarSection",
                    sortKeyAttributes: {
                        id: DynamoKeyAttributeSchema.id<SiteSideBarSectionId>(),
                    },
                    attributes: SiteSideBarSectionEntrySchema,
                },

                /**
                 * Reference to an Alpine entity (Document, Channel, Chat, Task, TaskCollection).
                 *
                 * EntityRefs are leaf nodes - they cannot have children.
                 */
                {
                    name: "Entity",
                    sortKeyAttributes: {
                        id: DynamoKeyAttributeSchema.labelString<SiteItemSearchEntityId>(),
                    },
                    attributes: SiteEntityEntrySchema,
                },
            ],
        },
    ],
    modelSchema: createModelUnionSchema({
        Site: SitePreviewModel,
        TopBar: SiteTopBarModel,
        SideBar: SiteSideBarModel,
        SideBarSection: SiteSideBarSectionModel,
        Entity: SiteEntityModel,
    }),
    models: {
        Site: {
            Attributes: {
                build: async (_context, item) =>
                    new SitePreviewModel({
                        id: item.siteId,
                        spaceId: item.spaceId,
                        name: item.name,
                        version: item.updateLockVersion ?? 0,
                        accessPolicy: item.accessPolicy,
                        createdTime: item.createdTime,
                        firstEntityId: item.firstEntityId,
                        rootContainerId: item.rootContainerId,
                        creatorId: item.creatorId,
                    }),
            },
            TopBar: {
                build: async (_context, item) =>
                    new SiteTopBarModel({
                        type: "TopBar",
                        id: `TopBar:${item.id}`,
                        orderKey: item.orderKey,
                        label: item.label,
                        parentId: item.parentId,
                        version: item.updateLockVersion ?? 0,
                    }),
            },
            SideBar: {
                build: async (_context, item) =>
                    new SiteSideBarModel({
                        type: "SideBar",
                        id: `SideBar:${item.id}`,
                        orderKey: item.orderKey,
                        label: item.label,
                        parentId: item.parentId,
                        version: item.updateLockVersion ?? 0,
                    }),
            },
            SideBarSection: {
                build: async (_context, item) =>
                    new SiteSideBarSectionModel({
                        type: "SideBarSection",
                        id: `SideBarSection:${item.id}`,
                        orderKey: item.orderKey,
                        label: item.label,
                        parentId: item.parentId,
                        version: item.updateLockVersion ?? 0,
                    }),
            },
            Entity: {
                build: async (context, item) => {
                    const result = await context.searchInjection.getSearchMentionEntityIfPossible(
                        item.spaceId,
                        item.id,
                    );

                    if (!result) {
                        throw new SchemaDeserializationError("Entity not found");
                    }
                    if (result.isPrivate) {
                        throw new SchemaDeserializationError("Entity is private");
                    }

                    const searchEntityData = result.entity.initialData;
                    assert(isSiteSearchEntityModelData(searchEntityData));

                    return new SiteEntityModel({
                        type: "Entity",
                        id: item.id,
                        spaceId: item.spaceId,
                        initialEntityData: searchEntityData,
                        orderKey: item.orderKey,
                        parentId: item.parentId,
                        version: item.updateLockVersion ?? 0,
                    });
                },
            },
        },
    },
    broadcastEventTransaction: async (context, eventTransaction) => {
        // Split up event transactions by siteId. All events in the Site partition go to
        // the same site's durable object.
        const eventTransactionBySiteId = new Map<SiteId, Array<DynamoGeneralRealtimeEventStub>>();

        for (const {itemKey, eventStub} of eventTransaction) {
            if (itemKey.partitionType === "Site") {
                const isSiteCreationEvent =
                    itemKey.sortRangeType === "Attributes" && eventStub.item.version === 0;

                // Optimization: Don't broadcast site creation events. No one will be subscribed
                // before the site is created.
                if (!isSiteCreationEvent) {
                    getOrSetDefaultMapValue(
                        eventTransactionBySiteId,
                        itemKey.siteId,
                        () => [],
                    ).push(eventStub);
                }
            }
        }

        await runAllPromises(
            mapIterable(eventTransactionBySiteId, async ([siteId, eventTransactionForSite]) => {
                if (eventTransactionForSite.length === 0) return;

                await context.edge.broadcastToDurableObject(
                    `/api/durable-objects/sites/${siteId}/broadcast-realtime-event-transaction`,
                    {
                        serviceName: "SiteRealtimeService",
                        route: "/api/durable-objects/sites/:siteId/broadcast-realtime-event-transaction",
                        body: SiteBroadcastRealtimeEventTransactionSchema.serialize({
                            eventTransaction: eventTransactionForSite,
                        }),
                    },
                );
            }),
        );
    },
});

// Type exports for the items
export type SiteAttributesItem = DynamoGeneralRealtimeTableItemType<
    typeof SitesTable,
    "Site",
    "Attributes"
>;

export type SiteTopBarItem = DynamoGeneralRealtimeTableItemType<
    typeof SitesTable,
    "Site",
    "TopBar"
>;

export type SiteSideBarItem = DynamoGeneralRealtimeTableItemType<
    typeof SitesTable,
    "Site",
    "SideBar"
>;

export type SiteSideBarSectionItem = DynamoGeneralRealtimeTableItemType<
    typeof SitesTable,
    "Site",
    "SideBarSection"
>;

export type SiteEntityItem = DynamoGeneralRealtimeTableItemType<
    typeof SitesTable,
    "Site",
    "Entity"
>;

/** Union of all container types (TopBar, SideBar, SideBarSection). */
export type SiteContainerItem = SiteTopBarItem | SiteSideBarItem | SiteSideBarSectionItem;

/** Union of all site item types. */
export type SiteEntryItem = SiteContainerItem | SiteEntityItem;
