import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {authorizeSiteAccessAndReturnItem} from "~/server/sites/data/internal/authorize_site_access_and_return_item.js";
import {dangerouslyGetSiteEntryItemIfExists} from "~/server/sites/data/internal/dangerously_get_site_entry_item.js";
import {
    SiteSideBarItem,
    SiteSideBarSectionItem,
    SitesTable,
} from "~/server/sites/data/internal/sites_table.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {
    SiteId,
    SiteSideBarId,
    SiteSideBarSectionId,
    SiteTopBarId,
} from "~/shared/id/types/id_types.js";
import {
    SiteSideBarContainerIdObject,
    SiteSideBarSectionContainerIdObject,
    SiteTopBarContainerIdObject,
    printSiteContainerId,
} from "~/shared/sites/site_entry_id.js";
import {createParentItemNotFoundError} from "~/shared/sites/site_error_messages.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

/**
 * Create a new container in a site.
 *
 * Always creates a fresh container — never undeletes a previously soft-deleted one
 * with the same id. The transactional path inside `transactionCreateItemWithEvent`
 * fails if a gravestone exists for the (siteId, containerId) pair, so reusing a
 * deleted container's id from the client surfaces as a clean condition-check error
 * rather than silently reviving previous container properties (label, etc.).
 *
 * The client provides the orderKey (calculated using generateOrderKeyBetween based
 * on sibling positions the client already knows). This avoids server-side querying
 * of all items to calculate position.
 */
export async function createSiteContainer(
    context: ServerSessionActionContext,
    siteId: SiteId,
    {
        orderKey,
        label,
        container,
    }: {
        orderKey: OrderKey;
        label: string;
        container:
            | {
                  type: "SideBar";
                  id?: SiteSideBarId;
                  parent: SiteTopBarContainerIdObject;
              }
            | {
                  type: "SideBarSection";
                  id?: SiteSideBarSectionId;
                  parent: SiteSideBarContainerIdObject | SiteSideBarSectionContainerIdObject;
              };
    },
    {clientRequestToken}: {clientRequestToken?: string} = {},
): Promise<{
    getDynamoGeneralRealtimeEventTransaction: (
        context: ServerActionContext,
    ) => Promise<Array<DynamoGeneralRealtimeEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    return context.dynamo.retryTransaction(async context => {
        const newContainerItem = intoSiteContainerItem(siteId, {orderKey, label, container});

        const [siteAttributes, parentContainer] = await runAllPromises([
            authorizeSiteAccessAndReturnItem(context, siteId, "Manage"),
            dangerouslyGetSiteEntryItemIfExists(context, siteId, container.parent),
        ]);

        if (!parentContainer) {
            throw createParentItemNotFoundError(siteId, newContainerItem.id, container.parent.id);
        }

        const updateSiteAttributesTransactionEntry =
            SitesTable.transactionDirectlyUpdateItemWithEvent(
                siteAttributes.update({
                    updatedTime: new Date(),
                }),
            );

        // IMPORTANT: We always create a fresh container — never undeletes a previously
        // soft-deleted one with the same id. The transactional path inside
        // `transactionCreateItemWithEvent` fails if a gravestone exists for the (siteId,
        // containerId) pair, so reusing a deleted container's id from the client surfaces
        // as a clean condition-check error rather than silently reviving previous
        // container properties (label, etc.). The transaction will be retried with a new
        // container
        const createContainerTransactionEntry =
            SitesTable.transactionCreateItemWithEvent(newContainerItem);

        await DynamoGeneralRealtimeTableSchema.executeTransaction(
            context,
            [
                // NOTE(ifitzsimmons, 2026-04-27): It may look like we're susceptible to a race
                // condition here where the parent container is deleted before we finish creating
                // this container, but if that had happened, the site attribute item's update lock
                // version would have been bumped, and this transaction would fail.
                updateSiteAttributesTransactionEntry.transactionEntry,
                createContainerTransactionEntry.transactionEntry,
            ],
            {clientRequestToken},
        );

        return {
            getDynamoGeneralRealtimeEventTransaction: async context =>
                runAllPromises([
                    updateSiteAttributesTransactionEntry.getEvent(context),
                    createContainerTransactionEntry.getEvent(context),
                ]),
        };
    });
}

function intoSiteContainerItem(
    siteId: SiteId,
    {
        orderKey,
        label,
        container,
    }: {
        orderKey: OrderKey;
        label: string;
        container:
            | {
                  type: "SideBar";
                  id?: SiteSideBarId;
                  parent: {type: "TopBar"; id: SiteTopBarId};
              }
            | {
                  type: "SideBarSection";
                  id?: SiteSideBarSectionId;
                  parent:
                      | {type: "SideBar"; id: SiteSideBarId}
                      | {type: "SideBarSection"; id: SiteSideBarSectionId};
              };
    },
): SiteSideBarItem | SiteSideBarSectionItem {
    switch (container.type) {
        case "SideBar":
            return {
                partitionType: "Site",
                sortRangeType: container.type,
                siteId,
                type: container.type,
                id: container.id ?? generateId<SiteSideBarId>(),
                orderKey,
                label,
                parentId: printSiteContainerId(container.parent),
            };
        case "SideBarSection":
            return {
                partitionType: "Site",
                sortRangeType: container.type,
                siteId,
                type: container.type,
                id: container.id ?? generateId<SiteSideBarSectionId>(),
                orderKey,
                label,
                parentId: printSiteContainerId(container.parent),
            };
        default:
            throw exhaustive(container);
    }
}
