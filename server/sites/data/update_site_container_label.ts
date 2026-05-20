import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeSiteAccessAndReturnItem} from "~/server/sites/data/internal/authorize_site_access_and_return_item.js";
import {dangerouslyGetSiteEntryItem} from "~/server/sites/data/internal/dangerously_get_site_entry_item.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SiteContainerId, parseSiteContainerId} from "~/shared/sites/site_entry_id.js";
import {isSiteItemContainer} from "~/shared/sites/site_entry_schema.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

/**
 * Update a container's label. Only containers (TopBar, SideBar, SideBarSection)
 * can have their labels updated. EntityRefs don't have labels - their display name
 * comes from the referenced entity.
 */
export async function updateSiteContainerLabel(
    context: ServerSessionActionContext,
    {
        siteId,
        id,
        label,
    }: {
        siteId: SiteId;
        id: SiteContainerId;
        label: string;
    },
): Promise<{
    getDynamoGeneralRealtimeEventTransaction: (
        context: ServerActionContext,
    ) => Promise<Array<DynamoGeneralRealtimeEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    return context.dynamo.retryTransaction(async context => {
        // Fetch site attributes for authorization
        const [siteAttributesItem, siteContainerItem] = await runAllPromises([
            authorizeSiteAccessAndReturnItem(context, siteId, "Manage"),
            dangerouslyGetSiteEntryItem(context, siteId, parseSiteContainerId(id)),
        ]);

        assert(isSiteItemContainer(siteContainerItem));

        const updatedItem = siteContainerItem.update({label});
        const updateContainerTransactionEntry =
            SitesTable.transactionDirectlyUpdateItemWithEvent(updatedItem);
        const updateSiteAttributesTransactionEntry =
            SitesTable.transactionDirectlyUpdateItemWithEvent(
                siteAttributesItem.update({updatedTime: new Date()}),
            );

        await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
            updateContainerTransactionEntry.transactionEntry,
            updateSiteAttributesTransactionEntry.transactionEntry,
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
            getDynamoGeneralRealtimeEventTransaction: context =>
                runAllPromises([
                    updateContainerTransactionEntry.getEvent(context),
                    updateSiteAttributesTransactionEntry.getEvent(context),
                ]),
        };
    });
}
