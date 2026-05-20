import {RynamoTransactionEntry} from "~/server/context/rynamo_transaction_entry.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {ServerMinimalAccountActionContext} from "~/server/context/server_minimal_action_context.js";
import {getSiteTreeForUpdate} from "~/server/sites/data/internal/get_site_tree_for_update.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

export async function dangerouslyGetRemoveFromSiteTransactionEntries(
    context: ServerMinimalAccountActionContext,
    siteId: SiteId,
    entityId: SiteItemSearchEntityId,
): Promise<
    Array<{
        transactionEntry: RynamoTransactionEntry;
        getEvent: (
            context: ServerActionContext,
        ) => Promise<RynamoEvent<SitePreviewModel | SiteEntryModel>>;
    }>
> {
    const {siteTree, siteAttributesItem} = await getSiteTreeForUpdate(context, siteId, "Manage");

    const itemToDelete = siteTree.getEntry(entityId);

    const newTree = siteTree.deleteEntry(entityId);
    const newFirstEntityId = newTree.site.firstEntityId;

    const deleteItemTransactionEntry = SitesTable.transactionDeleteItemWithEvent(itemToDelete.item);
    return [
        {
            transactionEntry: deleteItemTransactionEntry.transactionEntry,
            getEvent: async () => deleteItemTransactionEntry.event,
        },
        SitesTable.transactionDirectlyUpdateItemWithEvent(
            siteAttributesItem.update({
                updatedTime: new Date(),
                ...(newFirstEntityId !== siteTree.site.firstEntityId
                    ? {firstEntityId: newFirstEntityId}
                    : {}),
            }),
        ),
    ];
}
