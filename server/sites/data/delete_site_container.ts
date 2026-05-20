import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {RynamoTableSchema} from "~/server/dynamo/core/rynamo/rynamo_table_schema.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {getSiteTreeForUpdate} from "~/server/sites/data/internal/get_site_tree_for_update.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {
    SiteSideBarContainerIdObject,
    SiteSideBarSectionContainerIdObject,
    printSiteContainerId,
} from "~/shared/sites/site_entry_id.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";
import {validateSiteContainerIsEmpty} from "~/shared/sites/validate_site_container_is_empty.js";

/**
 * Delete a container (TopBar, SideBar, or SideBarSection) from a site.
 *
 * The container must be empty (no children) before it can be deleted. This is a
 * safety measure to prevent accidental data loss. To delete a container with
 * children, first delete or move all children.
 */
export async function deleteSiteContainer(
    context: ServerSessionActionContext,
    {
        siteId,
        container,
    }: {
        siteId: SiteId;
        container: SiteSideBarContainerIdObject | SiteSideBarSectionContainerIdObject;
    },
    {clientRequestToken}: {clientRequestToken?: string} = {},
): Promise<{
    getRynamoEventTransaction: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    return context.dynamo.retryTransaction(async () => {
        const {siteTree, siteAttributesItem} = await getSiteTreeForUpdate(
            context,
            siteId,
            "Manage",
        );

        const oldEntry = siteTree.getEntry(printSiteContainerId(container));
        assert(oldEntry.type !== "Entity");

        if (oldEntry.parentId === null || oldEntry.id === siteAttributesItem.rootContainerId) {
            throw new FailedPreconditionError("Can\u2019t delete the Site\u2019s root element", {
                displayMessage: errorDisplayMessage`Can\u2019t delete the site\u2019s root element.`,
            });
        }

        validateSiteContainerIsEmpty(oldEntry.id, siteTree);

        const updateSiteAttributesEntry = SitesTable.transactionDirectlyUpdateItemWithEvent(
            siteAttributesItem.update({
                updatedTime: new Date(),
            }),
        );

        const deleteItemEntry = SitesTable.transactionDeleteItemWithEvent(oldEntry.item);

        await RynamoTableSchema.executeTransaction(
            context,
            [deleteItemEntry.transactionEntry, updateSiteAttributesEntry.transactionEntry],
            {clientRequestToken},
        );

        context.process.waitUntil(
            markSearchAffinityEntityInteraction(context, {
                spaceId: siteAttributesItem.spaceId,
                entityId: `Site:${siteId}`,
                interaction: {type: "MediumIntentUpdate"},
                siteId: null,
            }),
        );

        return {
            getRynamoEventTransaction: context =>
                runAllPromises([
                    updateSiteAttributesEntry.getEvent(context),
                    deleteItemEntry.event,
                ]),
        };
    });
}
