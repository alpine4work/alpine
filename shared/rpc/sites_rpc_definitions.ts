import {LocalAccessPolicySchema} from "~/shared/access/access_policy.js";
import {DynamoItemKeySchema} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {
    RynamoEventStubSchema,
    createRynamoBackfillResultSchema,
    createRynamoEventSchema,
    createRynamoQuerySchema,
} from "~/shared/dynamo/rynamo_types.js";
import {
    SiteId,
    SiteSideBarId,
    SiteSideBarSectionId,
    SiteTopBarId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {SiteItemSearchEntityIdSchema} from "~/shared/search/site_item_search_entity_id.js";
import {
    SiteContainerIdSchema,
    SiteSideBarContainerId,
    SiteSideBarSectionContainerId,
} from "~/shared/sites/site_entry_id.js";
import {SiteOrSiteEntryModelSchema, SitePreviewModel} from "~/shared/sites/site_model.js";
import {RynamoSiteEventSchema} from "~/shared/sites/site_realtime_protocol.js";
import {ServerSynchronizationCheckpointSchema} from "~/shared/web_socket/server_synchronization_checkpoint.js";

/**
 * Create a new site in a space.
 *
 * Every site is created with a root container — either a `TopBar` or a `SideBar`.
 * The caller picks which one; the root cannot be added separately.
 */
export const createSite = defineRpc({
    name: "createSite",
    // Idempotent via the framework-generated `callId` threaded through to DynamoDB as
    // `clientRequestToken`. Retries with the same `callId` are deduplicated by
    // DynamoDB so the user only ever creates one site per logical request.
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        siteId: Schema.id<SiteId>().optional(),
        name: Schema.string,
        root: Schema.union({
            TopBar: Schema.object({
                type: Schema.value("TopBar"),
                id: Schema.id<SiteTopBarId>().optional(),
            }),
            SideBar: Schema.object({
                type: Schema.value("SideBar"),
                id: Schema.id<SiteSideBarId>().optional(),
            }),
        }),
    },
    output: {
        events: Schema.array(RynamoSiteEventSchema),
    },
});

/**
 * Update a site's name.
 */
export const updateSiteName = defineRpc({
    name: "updateSiteName",
    isIdempotent: true,
    input: {
        siteId: Schema.id<SiteId>(),
        name: Schema.string,
    },
    output: {
        events: createRynamoEventSchema(SitePreviewModel.schema),
    },
});

/**
 * Update a site's access policy. This affects who can view/edit the site and all
 * entities within it.
 */
export const updateSiteAccessPolicy = defineRpc({
    name: "updateSiteAccessPolicy",
    isIdempotent: true,
    input: {
        siteId: Schema.id<SiteId>(),
        accessPolicy: LocalAccessPolicySchema,
    },
    output: {
        events: createRynamoEventSchema(SitePreviewModel.schema),
    },
});

// =============================================================================
// Site Item CRUD RPCs
// =============================================================================

/**
 * Create a new item in a site.
 */
export const createSiteContainer = defineRpc({
    name: "createSiteContainer",
    // Idempotent via the framework-generated `callId` threaded through to DynamoDB as
    // `clientRequestToken`. Retries with the same `callId` are deduplicated.
    isIdempotent: true,
    input: {
        siteId: Schema.id<SiteId>(),
        container: Schema.union({
            SideBar: Schema.object({
                type: Schema.value("SideBar"),
                id: Schema.id<SiteSideBarId>().optional(),
                parent: Schema.union({
                    TopBar: Schema.object({
                        type: Schema.value("TopBar"),
                        id: Schema.id<SiteTopBarId>(),
                    }),
                }),
            }),
            SideBarSection: Schema.object({
                type: Schema.value("SideBarSection"),
                id: Schema.id<SiteSideBarSectionId>().optional(),
                parent: Schema.union({
                    SideBar: Schema.object({
                        type: Schema.value("SideBar"),
                        id: Schema.id<SiteSideBarId>(),
                    }),
                    SideBarSection: Schema.object({
                        type: Schema.value("SideBarSection"),
                        id: Schema.id<SiteSideBarSectionId>(),
                    }),
                }),
            }),
        }),
        /**
         * Label for SideBar and SideBarSection items. Not used for EntityRef (entity
         * provides its own label).
         */
        label: LabelStringSchema,
        orderKey: OrderKeySchema,
    },
    output: {
        events: Schema.array(RynamoSiteEventSchema),
    },
});

/**
 * Update an existing site item's properties. Only label can be updated. EntityRef
 * entities are updated separately.
 */
export const updateSiteContainerLabel = defineRpc({
    name: "updateSiteContainerLabel",
    isIdempotent: true,
    input: {
        siteId: Schema.id<SiteId>(),
        id: SiteContainerIdSchema,
        /**
         * New label for SideBar and SideBarSection items. Cannot be used with EntityRef
         * items.
         */
        label: Schema.string,
    },
    output: {
        events: Schema.array(RynamoSiteEventSchema),
    },
});

/**
 * Move a site item to a new parent or position.
 */
export const moveSiteEntry = defineRpc({
    name: "moveSiteEntry",
    isIdempotent: true,
    input: {
        siteId: Schema.id<SiteId>(),
        item: Schema.union({
            SideBarSection: Schema.object({
                type: Schema.value("SideBarSection"),
                id: Schema.id<SiteSideBarSectionId>(),
                newPosition: Schema.object({
                    parentId: Schema.string as Schema<
                        SiteSideBarContainerId | SiteSideBarSectionContainerId
                    >,
                    orderKey: OrderKeySchema,
                }),
            }),
            Entity: Schema.object({
                type: Schema.value("Entity"),
                id: SiteItemSearchEntityIdSchema,
                newPosition: Schema.object({
                    parentId: SiteContainerIdSchema,
                    orderKey: OrderKeySchema,
                }),
            }),
        }),
    },
    output: {
        /**
         * The moved item with its new orderKey.
         */
        events: Schema.array(RynamoSiteEventSchema),
    },
});

/**
 * Delete a site item. Options control what happens to children.
 */
export const deleteSiteContainer = defineRpc({
    name: "deleteSiteContainer",
    // Idempotent via the framework-generated `callId` threaded through to DynamoDB as
    // `clientRequestToken`. A retry with the same `callId` is deduplicated by DynamoDB
    // and returns the original result. A _new_ call (different `callId`) for an
    // already-deleted container will still throw, which is the correct behavior — the
    // second user-initiated delete should fail.
    isIdempotent: true,
    input: {
        siteId: Schema.id<SiteId>(),
        container: Schema.union({
            SideBar: Schema.object({
                type: Schema.value("SideBar"),
                id: Schema.id<SiteSideBarId>(),
            }),
            SideBarSection: Schema.object({
                type: Schema.value("SideBarSection"),
                id: Schema.id<SiteSideBarSectionId>(),
            }),
        }),
    },
    output: {
        events: Schema.array(RynamoSiteEventSchema),
    },
});

export const addEntityToSite = defineRpc({
    name: "addEntityToSite",
    isIdempotent: true,
    input: {
        siteId: Schema.id<SiteId>(),
        spaceId: Schema.id<SpaceId>(),
        entityId: SiteItemSearchEntityIdSchema,
        parentId: SiteContainerIdSchema,
        orderKey: OrderKeySchema,
    },
    output: {
        events: Schema.array(RynamoSiteEventSchema),
    },
});

export const removeEntityFromSite = defineRpc({
    name: "removeEntityFromSite",
    isIdempotent: true,
    input: {
        siteId: Schema.id<SiteId>(),
        spaceId: Schema.id<SpaceId>(),
        entityId: SiteItemSearchEntityIdSchema,
    },
    output: {
        events: Schema.array(RynamoSiteEventSchema),
    },
});

/**
 * Authorize access to a site. Used by the durable object to verify the user can
 * access the site before allowing WebSocket connections.
 */
export const authorizeSiteAccess = defineRpc({
    name: "authorizeSiteAccess",
    isIdempotent: true,
    input: {
        siteId: Schema.id<SiteId>(),
        expectedAccessLevel: Schema.enum(["View", "Edit", "Manage"]),
    },
    output: {
        spaceId: Schema.id<SpaceId>(),
    },
});

/**
 * Transform realtime event stubs into full events with models. Called by the
 * durable object when broadcasting events to connected clients.
 */
export const getSiteRealtimeEvent = defineRpc({
    name: "getSiteRealtimeEvent",
    isIdempotent: true,
    input: {
        siteId: Schema.id<SiteId>(),
        events: Schema.array(RynamoEventStubSchema),
    },
    output: {
        events: Schema.array(RynamoSiteEventSchema),
    },
});

/**
 * Load a site with all its items in realtime query format. Used by the site editor
 * route loader and for full reloads after reconnection.
 */
export const getSite = defineRpc({
    name: "getSite",
    isIdempotent: true,
    input: {
        siteId: Schema.id<SiteId>(),
        afterItemKey: DynamoItemKeySchema.optional(),
        consistency: Schema.enum(["Eventual", "Strong"]).optional(),
    },
    output: {
        siteResult: createRynamoQuerySchema(SiteOrSiteEntryModelSchema),
    },
});

/**
 * Backfill site realtime updates after reconnecting to WebSocket. Returns events
 * that occurred since the given checkpoint.
 */
export const backfillSite = defineRpc({
    name: "backfillSite",
    isIdempotent: true,
    input: {
        siteId: Schema.id<SiteId>(),
        checkpoint: ServerSynchronizationCheckpointSchema,
    },
    output: {
        backfillResult: createRynamoBackfillResultSchema(SiteOrSiteEntryModelSchema),
    },
});

// TODO(#sites): We should probably have `batchAdd`, `batchDelete`, and `batchMove`
// RPCs.
