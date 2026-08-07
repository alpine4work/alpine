import {ServerMinimalAccountActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {SiteEntryItem, SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";
import {SiteEntryIdObject} from "~/shared/sites/site_entry_id.js";
import {createSiteItemNotFoundError} from "~/shared/sites/site_error_messages.js";

/**
 * Doesn't authorize that the actor has access to the site entry. Authorization
 * must be performed prior to calling this function.
 */
export async function dangerouslyGetSiteEntryItem(
    context: ServerMinimalAccountActionContext,
    siteId: SiteId,
    item: SiteEntryIdObject,
): Promise<DynamoItem<SiteEntryItem>> {
    const result = await dangerouslyGetSiteEntryItemIfExists(context, siteId, item);

    if (!result) throw createSiteItemNotFoundError(siteId, item.id);

    return result;
}

export async function dangerouslyGetSiteEntryItemIfExists(
    context: ServerMinimalAccountActionContext,
    siteId: SiteId,
    item: SiteEntryIdObject,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<DynamoItem<SiteEntryItem> | null> {
    switch (item.type) {
        case "TopBar":
            return await SitesTable.getItemIfExists(
                context,
                {
                    partitionType: "Site",
                    sortRangeType: "TopBar",
                    siteId,
                    id: item.id,
                },
                {consistency},
            );
        case "SideBar":
            return await SitesTable.getItemIfExists(
                context,
                {
                    partitionType: "Site",
                    sortRangeType: "SideBar",
                    siteId,
                    id: item.id,
                },
                {consistency},
            );
        case "SideBarSection":
            return await SitesTable.getItemIfExists(
                context,
                {
                    partitionType: "Site",
                    sortRangeType: "SideBarSection",
                    siteId,
                    id: item.id,
                },
                {consistency},
            );
        case "Entity":
            return await SitesTable.getItemIfExists(
                context,
                {
                    partitionType: "Site",
                    sortRangeType: "Entity",
                    siteId,
                    id: item.id,
                },
                {consistency},
            );
        default:
            throw exhaustive(item);
    }
}
