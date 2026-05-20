import {RynamoTransactionEntry} from "~/server/context/rynamo_transaction_entry.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {ServerMinimalAccountActionContext} from "~/server/context/server_minimal_action_context.js";
import {
    getSiteTreeForUpdate,
    intoSiteTreeItem,
} from "~/server/sites/data/internal/get_site_tree_for_update.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {SiteContainerId} from "~/shared/sites/site_entry_id.js";
import {createParentItemNotFoundError} from "~/shared/sites/site_error_messages.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

export async function dangerouslyGetAddToSiteTransactionEntries(
    context: ServerMinimalAccountActionContext,
    siteId: SiteId,
    {
        entityId,
        parentId,
        orderKey,
    }: {
        entityId: SiteItemSearchEntityId;
        parentId: SiteContainerId;
        orderKey: OrderKey;
    },
): Promise<
    Array<{
        transactionEntry: RynamoTransactionEntry;
        getEvent: (
            context: ServerActionContext,
        ) => Promise<RynamoEvent<SitePreviewModel | SiteEntryModel>>;
    }>
> {
    const [{siteTree, siteAttributesItem}, deletedSiteItemIfExists] = await runAllPromises([
        getSiteTreeForUpdate(context, siteId, "Manage"),
        SitesTable.getDeletedItemIfExists(context, {
            partitionType: "Site",
            sortRangeType: "Entity",
            siteId,
            id: entityId,
        }),
    ]);

    const parentContainer = siteTree.getEntryIfExists(parentId);
    if (!parentContainer) throw createParentItemNotFoundError(siteId, entityId, parentId);

    const newEntry = intoSiteTreeItem({
        partitionType: "Site",
        sortRangeType: "Entity",
        type: "Entity",
        siteId,
        id: entityId,
        parentId,
        orderKey,
        spaceId: siteAttributesItem.spaceId,
        updateLockVersion: 0,
    });

    const newTree = siteTree.addEntry(newEntry);
    const newFirstEntityId = newTree.site.firstEntityId;

    let createOrUndeleteEntityTransactionEntry: {
        transactionEntry: RynamoTransactionEntry;
        getEvent: (context: ServerActionContext) => any;
    };

    if (deletedSiteItemIfExists) {
        createOrUndeleteEntityTransactionEntry = SitesTable.transactionUndeleteItemWithEvent(
            deletedSiteItemIfExists,
            newEntry.item,
        );
    } else {
        createOrUndeleteEntityTransactionEntry = SitesTable.transactionCreateItemWithEvent(
            newEntry.item,
        );
    }

    // The injection slot returns the opaque placeholder type to avoid a circular Bazel
    // dependency between `//server/context` and `//server/dynamo/core/rynamo`. Cast
    // through `unknown` here.
    return [
        createOrUndeleteEntityTransactionEntry,
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
