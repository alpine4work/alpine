import {ServerMinimalAccountActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {SiteAttributesItem, SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";

export function getSiteAttributeUpdateTransaction(
    context: ServerMinimalAccountActionContext,
    siteAttributesItem: DynamoItem<SiteAttributesItem>,
    newFirstEntityId: SiteItemSearchEntityId | null,
) {
    let updateItem = siteAttributesItem.update({
        updatedTime: new Date(),
    });

    if (newFirstEntityId === siteAttributesItem.firstEntityId) {
        return SitesTable.transactionDirectlyUpdateItemWithEvent(updateItem);
    }

    updateItem = updateItem.update({
        firstEntityId: newFirstEntityId,
    });

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId: siteAttributesItem.spaceId,
        update: {
            type: "Site",
            siteId: siteAttributesItem.siteId,
            updatedTraits: {type: "Some", traits: ["Preview"]},
        },
    });

    return SitesTable.transactionDirectlyUpdateItemWithEvent(updateItem);
}
