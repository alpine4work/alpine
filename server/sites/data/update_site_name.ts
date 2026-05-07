import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {authorizeSiteAccessAndReturnItem} from "~/server/sites/data/internal/authorize_site_access_and_return_item.js";
import {createSitePreviewModelFromItem} from "~/server/sites/data/internal/create_site_preview_model_from_item.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

/**
 * Update a site's name. The session actor must have `Manage` access on the site.
 */
export async function updateSiteName(
    context: ServerSessionActionContext,
    {
        siteId,
        name,
    }: {
        siteId: SiteId;
        name: string;
    },
): Promise<{
    getDynamoGeneralRealtimeEventTransaction: (
        context: ServerActionContext,
    ) => Promise<DynamoGeneralRealtimeEvent<SitePreviewModel>>;
    site: SitePreviewModel;
}> {
    return context.dynamo.retryTransaction(async context => {
        const siteAttributesItem = await authorizeSiteAccessAndReturnItem(
            context,
            siteId,
            "Manage",
        );

        const newItem = siteAttributesItem.update({
            updatedTime: new Date(),
            name,
        });
        const {getEvent} = await SitesTable.directlyUpdateItem(context, newItem);

        // TODO(#sites): Reindex site for search.

        return {
            site: createSitePreviewModelFromItem(newItem),
            getDynamoGeneralRealtimeEventTransaction: getEvent,
        };
    });
}
