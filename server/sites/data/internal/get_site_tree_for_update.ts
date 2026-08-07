import {ServerMinimalAccountActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {authorizeSiteAccessForSiteItemIfPossible} from "~/server/sites/data/internal/authorize_site_access_for_site_item.js";
import {
    SiteAttributesItem,
    SiteContainerItem,
    SiteEntityItem,
    SiteEntryItem,
    SitesTable,
} from "~/server/sites/data/internal/sites_table.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {parallelProcessAsyncIterable} from "~/shared/helpers/iterable/parallel_process_async_iterable.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {SiteContainerId, printSiteContainerId} from "~/shared/sites/site_entry_id.js";
import {SiteEntryContainer, SiteEntryEntity} from "~/shared/sites/site_entry_schema.js";
import {createSiteNotFoundError} from "~/shared/sites/site_error_messages.js";
import {SiteTreeBase} from "~/shared/sites/site_tree_base.js";

export type SiteTreeItem =
    | (SiteEntryEntity & {
          readonly id: SiteItemSearchEntityId;
          readonly item: DynamoItem<SiteEntityItem>;
      })
    | (SiteEntryContainer & {
          readonly id: SiteContainerId;
          readonly item: DynamoItem<SiteContainerItem>;
      });

/**
 * Read every item in a site's tree, returning the flat list along with lookup maps
 * by id and by parent id. Authorizes the actor against the site's access policy.
 *
 * The "ForUpdate" suffix advertises that this is intended for write paths — every
 * caller uses the returned tree to recompute `firstEntityId` and write the result
 * back to the site's Attributes row in the same dynamo transaction (see
 * `moveSiteEntry`, `dangerouslyGetAddToSiteTransactionEntries`, and
 * `dangerouslyGetRemoveFromSiteTransactionEntries`). For that reason this function
 * **always uses `StrongWithinCache` consistency**: an eventually-consistent read
 * could observe a stale tree, causing two concurrent mutators to compute
 * `firstEntityId` from out-of-date sibling lists and race the dynamo write.
 *
 * `StrongWithinCache` reads through to dynamo on the first call and then serves
 * subsequent calls from the request-scoped cache, which matters because
 * `dynamo.retryTransaction` may invoke this function multiple times within a
 * single logical operation.
 */
export async function getSiteTreeForUpdate(
    context: ServerMinimalAccountActionContext,
    siteId: SiteId,
    accessLevel: AccessLevel,
): Promise<{
    siteTree: SiteTreeBase<SiteTreeItem>;
    siteAttributesItem: DynamoItem<SiteAttributesItem>;
}> {
    const entries: Array<SiteTreeItem> = [];
    let siteItem: DynamoItem<SiteAttributesItem> | null = null;

    await parallelProcessAsyncIterable(
        SitesTable.query(context, {
            limit: "All",
            partitionKey: {partitionType: "Site", siteId},
            consistency: "StrongWithinCache",
        }),
        async item => {
            if (item.sortRangeType === "Attributes") {
                unwrapResult(
                    await authorizeSiteAccessForSiteItemIfPossible(
                        context,
                        siteId,
                        item,
                        accessLevel,
                    ),
                );
                siteItem = DynamoItem.create(item);
                return;
            }

            entries.push(intoSiteTreeItem(item));
        },
    );

    if (!siteItem) {
        throw createSiteNotFoundError(siteId);
    }

    // TS isn't smart enough to know that siteItem was set within the
    // parallelProcessAsyncIterable loop, so it thinks its type is "never" here.
    const siteAttributesItem = DynamoItem.create<SiteAttributesItem>(siteItem);
    return {
        siteTree: SiteTreeBase.fromEntries(
            {
                id: siteId,
                version: siteAttributesItem.updateLockVersion ?? 0,
                ...siteAttributesItem,
            },
            entries,
        ),
        siteAttributesItem,
    };
}

export function intoSiteTreeItem(item: SiteEntryItem): SiteTreeItem {
    switch (item.type) {
        case "TopBar":
            return {
                id: printSiteContainerId(item),
                type: "TopBar",
                orderKey: item.orderKey,
                parentId: item.parentId,
                label: item.label,
                item: DynamoItem.create(item),
            };
        case "SideBar":
            return {
                id: printSiteContainerId(item),
                type: "SideBar",
                orderKey: item.orderKey,
                parentId: item.parentId,
                label: item.label,
                item: DynamoItem.create(item),
            };
        case "SideBarSection":
            return {
                id: printSiteContainerId(item),
                type: "SideBarSection",
                orderKey: item.orderKey,
                parentId: item.parentId,
                label: item.label,
                item: DynamoItem.create(item),
            };
        case "Entity":
            return {
                id: item.id,
                type: "Entity",
                spaceId: item.spaceId,
                orderKey: item.orderKey,
                parentId: item.parentId,
                item: DynamoItem.create(item),
            };
        default:
            throw exhaustive(item);
    }
}
