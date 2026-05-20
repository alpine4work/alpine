import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {RynamoTableSchema} from "~/server/dynamo/core/rynamo/rynamo_table_schema.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {
    SiteAttributesItem,
    SiteSideBarItem,
    SiteTopBarItem,
    SitesTable,
} from "~/server/sites/data/internal/sites_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {SiteId, SiteSideBarId, SiteTopBarId, SpaceId} from "~/shared/id/types/id_types.js";
import {SiteRootContainerId, printSiteContainerId} from "~/shared/sites/site_entry_id.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

/**
 * Create a new site in a space.
 *
 * Every site must be created with a root container — either a `TopBar` or a
 * `SideBar`. The root container is written in the same dynamo transaction as the
 * site attributes, so callers never observe a half-constructed site.
 *
 * The root container's `label` is set to the site's `name`. The root is
 * conceptually the site itself, so reusing the site name avoids forcing callers to
 * invent a separate label that the UI rarely renders.
 */
export async function createSite(
    context: ServerSessionActionContext,
    {
        spaceId,
        siteId = generateId<SiteId>(),
        name,
        accessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [context.actor.getAccountId(), {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        },
        root,
    }: {
        spaceId: SpaceId;
        siteId?: SiteId;
        name: string;
        // Sites cannot be nested within other sites.
        accessPolicy?: LocalAccessPolicy;
        root: {type: "TopBar"; id?: SiteTopBarId} | {type: "SideBar"; id?: SiteSideBarId};
    },
    {clientRequestToken}: {clientRequestToken?: string} = {},
): Promise<{
    getRynamoEventTransaction: (
        context: ServerActionContext,
    ) => Promise<[RynamoEvent<SitePreviewModel>, RynamoEvent<SiteEntryModel>]>;
}> {
    await authorizeSpaceAccess(context, spaceId);

    await validateAccessPolicyUpdateForServer(
        context,
        spaceId,
        `Site:${siteId}`,
        null,
        accessPolicy,
    );

    const creatorId = context.actor.getAccountId();
    const now = new Date();

    const rootContainerItem = buildRootContainerItem(siteId, name, root);
    const rootContainerId: SiteRootContainerId =
        rootContainerItem.type === "TopBar"
            ? printSiteContainerId({type: "TopBar", id: rootContainerItem.id})
            : printSiteContainerId({type: "SideBar", id: rootContainerItem.id});

    const siteAttributesItem: SiteAttributesItem = {
        partitionType: "Site",
        sortRangeType: "Attributes",
        siteId,
        spaceId,
        name,
        accessPolicy,
        createdTime: now,
        creatorId,
        updatedTime: now,
        firstEntityId: null,
        rootContainerId,
    };

    const createSiteAttributesEntry = SitesTable.transactionCreateItemWithEvent(siteAttributesItem);
    const createRootContainerEntry = SitesTable.transactionCreateItemWithEvent(rootContainerItem);

    await RynamoTableSchema.executeTransaction(
        context,
        [createSiteAttributesEntry.transactionEntry, createRootContainerEntry.transactionEntry],
        {clientRequestToken},
    );

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId,
        update: {
            type: "Site",
            siteId,
            // Nothing depends on this entity when it's created. Don't bother trying to reindex
            // dependencies.
            updatedTraits: {type: "None"},
        },
    });

    context.process.waitUntil(
        markSearchAffinityEntityInteraction(context, {
            spaceId,
            entityId: `Site:${siteId}`,
            interaction: {type: "HighIntentUpdate"},
            // The entity _is_ the site; no cascade.
            siteId: null,
        }),
    );

    return {
        getRynamoEventTransaction: async eventContext =>
            runAllPromises([
                createSiteAttributesEntry.getEvent(eventContext),
                createRootContainerEntry.getEvent(eventContext),
            ]),
    };
}

function buildRootContainerItem(
    siteId: SiteId,
    name: string,
    root: {type: "TopBar"; id?: SiteTopBarId} | {type: "SideBar"; id?: SiteSideBarId},
): SiteTopBarItem | SiteSideBarItem {
    switch (root.type) {
        case "TopBar":
            return {
                partitionType: "Site",
                sortRangeType: "TopBar",
                siteId,
                type: "TopBar",
                id: root.id ?? generateId<SiteTopBarId>(),
                orderKey: initialOrderKey,
                label: name,
                parentId: null,
            };
        case "SideBar":
            return {
                partitionType: "Site",
                sortRangeType: "SideBar",
                siteId,
                type: "SideBar",
                id: root.id ?? generateId<SiteSideBarId>(),
                orderKey: initialOrderKey,
                label: name,
                parentId: null,
            };
        default:
            throw exhaustive(root);
    }
}
