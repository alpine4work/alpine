import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeSiteAccessAndReturnItem} from "~/server/sites/data/internal/authorize_site_access_and_return_item.js";
import {createSitePreviewModelFromItem} from "~/server/sites/data/internal/create_site_preview_model_from_item.js";
import {SitesTable} from "~/server/sites/data/internal/sites_table.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {SiteId} from "~/shared/id/types/id_types.open_source.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

/**
 * Update a site's `AccessPolicy`. The session actor must have `Manage` access on
 * both the old and new access policies.
 *
 * Sites cannot inherit their access policy from another site, so the new access
 * policy must be a `LocalAccessPolicy`.
 *
 * Updating the site's access policy effectively re-shares every entity that
 * inherits from the site, so all consumers of those entities (channels, chats,
 * tasks, task collections, documents) see the new permissions on their next
 * authorization check.
 */
export async function updateSiteAccessPolicy(
    context: ServerSessionActionContext,
    {
        siteId,
        accessPolicy,
    }: {
        siteId: SiteId;
        // Sites cannot be nested within other sites, so only `LocalAccessPolicy` is valid
        // here.
        accessPolicy: LocalAccessPolicy;
    },
): Promise<{
    site: SitePreviewModel;
    getRynamoEvents: (context: ServerActionContext) => Promise<RynamoEvent<SitePreviewModel>>;
}> {
    return await context.dynamo.retryTransaction(async context => {
        const siteAttributesItem = await authorizeSiteAccessAndReturnItem(
            context,
            siteId,
            "Manage",
        );

        // Validate the policy update against both the old and new policies and run shared
        // bot/manager checks. We don't need the returned site transaction entries because
        // sites can't be nested in other sites.
        await validateAccessPolicyUpdateForServer(
            context,
            siteAttributesItem.spaceId,
            `Site:${siteId}`,
            siteAttributesItem.accessPolicy,
            accessPolicy,
        );

        const newItem = siteAttributesItem.update({
            updatedTime: new Date(),
            accessPolicy,
        });
        const {getEvent} = await SitesTable.directlyUpdateItem(context, newItem);

        // TODO(alex, #databases): Reliably propagate site access-policy updates to database
        // Durable Objects so that a lost indexing job cannot preserve revoked access.
        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: siteAttributesItem.spaceId,
            update: {
                type: "Site",
                siteId,
                updatedTraits: {type: "Some", traits: ["Preview"]},
            },
        });

        context.process.waitUntil(
            markSearchAffinityEntityInteraction(context, {
                spaceId: siteAttributesItem.spaceId,
                entityId: `Site:${siteId}`,
                interaction: {type: "MediumIntentUpdate"},
                siteId: null,
            }),
        );

        return {
            site: createSitePreviewModelFromItem(newItem),
            getRynamoEvents: getEvent,
        };
    });
}
