import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {
    SiteTreeItem,
    getSiteTreeForUpdate,
} from "~/server/sites/data/internal/get_site_tree_for_update.js";
import {
    SiteAttributesItem,
    SiteEntryItem,
    SitesTable,
} from "~/server/sites/data/internal/sites_table.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {doesSiteEntryMoveIntroduceCycle} from "~/shared/sites/does_site_entry_move_introduce_cycle.js";
import {mergeNewSitePositionIntoSiteEntry} from "~/shared/sites/merge_new_site_position_into_site_entry.js";
import {
    SiteContainerId,
    SiteEntityIdObject,
    SiteSideBarContainerId,
    SiteSideBarSectionContainerId,
    SiteSideBarSectionContainerIdObject,
    getSiteEntryKey,
    printSiteContainerId,
} from "~/shared/sites/site_entry_id.js";
import {isSiteItemContainer} from "~/shared/sites/site_entry_schema.js";
import {createParentItemNotFoundError} from "~/shared/sites/site_error_messages.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";
import {SiteTreeBase} from "~/shared/sites/site_tree_base.js";

export async function moveSiteEntry(
    context: ServerSessionActionContext,
    {
        siteId,
        item,
    }: {
        siteId: SiteId;
        item:
            | (SiteSideBarSectionContainerIdObject & {
                  newPosition: {
                      parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
                      orderKey: OrderKey;
                  };
              })
            | (SiteEntityIdObject & {
                  newPosition: {
                      parentId: SiteContainerId;
                      orderKey: OrderKey;
                  };
              });
    },
): Promise<{
    getRynamoEvents: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    const newParentId = item.newPosition.parentId;
    const newOrderKey = item.newPosition.orderKey;

    return context.dynamo.retryTransaction(async () => {
        const {siteTree, siteAttributesItem} = await getSiteTreeForUpdate(
            context,
            siteId,
            "Manage",
        );

        const oldSiteEntry = siteTree.getEntry(getSiteEntryKey(item));
        if (oldSiteEntry.parentId === null) {
            throw new FailedPreconditionError(
                "Cannot move the root item. The root item must remain at the top level.",
                {
                    displayMessage: errorDisplayMessage`Can\u2019t move the site\u2019s root element.`,
                },
            );
        }

        const newParent = siteTree.getEntryIfExists(newParentId);
        if (!newParent) {
            throw createParentItemNotFoundError(siteId, item.id, newParentId);
        }

        if (oldSiteEntry.orderKey === newOrderKey && oldSiteEntry.parentId === newParentId) {
            // On the client, we no-op if the user drags the item back to its original
            // position. We no-op here as well to handle the following scenario:
            //
            // 1. User moves item from position A to position B
            // 2. User immediately drags the item back to position A
            // 3. The client handles the move optimistically
            // 4. The server receivees the move to Position A before the move to Position B.
            //    From the server's perspective, the item is already in the new position. If it
            //    were to throw, the client's move from B back to A would fail.
            return {
                getRynamoEvents: async () => [],
            };
        }

        // If we are changing the parent of a container, we need to make sure that we are
        // doing so in a way that doesn't introduce a cycle.
        validateSiteEntryMoveDoesNotIntroduceCycle(oldSiteEntry.item, newParentId, siteTree);

        const updateSiteAttributesEntry = createSiteAttributesItemUpdateTransactionEntry(
            siteAttributesItem,
            item,
            {
                siteTree,
            },
        );
        const updateSiteItemEntry = createSiteEntryUpdateTransactionEntry(
            oldSiteEntry.item,
            item.newPosition,
        );

        await RynamoTableSchema.executeTransaction(context, [
            updateSiteAttributesEntry.transactionEntry,
            updateSiteItemEntry.transactionEntry,
        ]);

        context.process.waitUntil(
            markSearchAffinityEntityInteraction(context, {
                spaceId: siteAttributesItem.spaceId,
                entityId: `Site:${siteId}`,
                interaction: {type: "LowIntentUpdate"},
                siteId: null,
            }),
        );

        return {
            getRynamoEvents: async (eventContext: ServerActionContext) =>
                runAllPromises([
                    updateSiteAttributesEntry.getEvent(eventContext),
                    updateSiteItemEntry.getEvent(eventContext),
                ]),
        };
    });
}

/**
 * Changes the site's first entity ID if the move changes the DFS order of the site
 * tree and updates the site's `lastUpdatedTime`.
 */
function createSiteAttributesItemUpdateTransactionEntry(
    siteAttributesItem: DynamoItem<SiteAttributesItem>,
    item:
        | (SiteSideBarSectionContainerIdObject & {
              newPosition: {
                  parentId: SiteSideBarContainerId | SiteSideBarSectionContainerId;
                  orderKey: OrderKey;
              };
          })
        | (SiteEntityIdObject & {
              newPosition: {
                  parentId: SiteContainerId;
                  orderKey: OrderKey;
              };
          }),
    {
        siteTree,
    }: {
        siteTree: SiteTreeBase<SiteTreeItem>;
    },
) {
    const newTree = siteTree.updateEntry(
        item.type === "Entity" ? item.id : printSiteContainerId(item),
        oldEntry => mergeNewSitePositionIntoSiteEntry(oldEntry, item.newPosition),
    );
    const newFirstEntityId = newTree.site.firstEntityId;

    return SitesTable.transactionDirectlyUpdateItemWithEvent(
        siteAttributesItem.update({
            updatedTime: new Date(),
            ...(newFirstEntityId !== siteAttributesItem.firstEntityId
                ? {firstEntityId: newFirstEntityId}
                : {}),
        }),
    );
}

function createSiteEntryUpdateTransactionEntry(
    siteEntry: DynamoItem<SiteEntryItem>,
    {
        parentId,
        orderKey,
    }: {
        parentId?: SiteContainerId;
        orderKey: OrderKey;
    },
) {
    let updatedSiteEntry = siteEntry.update({orderKey});
    if (parentId !== undefined) updatedSiteEntry = updatedSiteEntry.update({parentId});

    return SitesTable.transactionDirectlyUpdateItemWithEvent(updatedSiteEntry);
}

function validateSiteEntryMoveDoesNotIntroduceCycle(
    entryToBeMoved: DynamoItem<SiteEntryItem>,
    newParentId: SiteContainerId,
    siteTree: SiteTreeBase<SiteTreeItem>,
) {
    if (!isSiteItemContainer(entryToBeMoved)) return;

    if (
        doesSiteEntryMoveIntroduceCycle(printSiteContainerId(entryToBeMoved), newParentId, siteTree)
    ) {
        throw new FailedPreconditionError("Moving this item would create a cycle in the tree.");
    }
}
