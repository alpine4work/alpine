import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {authorizeSiteAccess} from "~/server/sites/data/authorize_site_access.js";
import {backfillSite} from "~/server/sites/data/backfill_site.js";
import {createSite} from "~/server/sites/data/create_site.js";
import {createSiteContainer} from "~/server/sites/data/create_site_container.js";
import {deleteSiteContainer} from "~/server/sites/data/delete_site_container.js";
import {getSite} from "~/server/sites/data/get_site.js";
import {getSiteRealtimeEvent} from "~/server/sites/data/get_site_realtime_event.js";
import {moveSiteEntry} from "~/server/sites/data/move_site_entry.js";
import {updateSiteAccessPolicy} from "~/server/sites/data/update_site_access_policy.js";
import {updateSiteContainerLabel} from "~/server/sites/data/update_site_container_label.js";
import {updateSiteName} from "~/server/sites/data/update_site_name.js";
import {addEntityToSite} from "~/server/sites/entity_actions/add_entity_to_site.js";
import {removeEntityFromSite} from "~/server/sites/entity_actions/remove_entity_from_site.js";
import * as definitions from "~/shared/rpc/sites_rpc_definitions.js";

export default implementRpcs(definitions, {
    createSite: {
        visibility: ["AppClient"],
        execute: async (context, input, {callId}) => {
            const {getDynamoGeneralRealtimeEventTransaction} = await createSite(
                context.actor.authorizeSession(),
                {
                    spaceId: input.spaceId,
                    siteId: input.siteId,
                    name: input.name,
                    root: input.root,
                },
                {clientRequestToken: callId},
            );
            return {eventTransaction: await getDynamoGeneralRealtimeEventTransaction(context)};
        },
    },

    updateSiteName: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransaction} = await updateSiteName(
                context.actor.authorizeSession(),
                {
                    siteId: input.siteId,
                    name: input.name,
                },
            );
            return {
                eventTransaction: await getDynamoGeneralRealtimeEventTransaction(context),
            };
        },
    },

    updateSiteAccessPolicy: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransaction} = await updateSiteAccessPolicy(
                context.actor.authorizeSession(),
                {
                    siteId: input.siteId,
                    accessPolicy: input.accessPolicy,
                },
            );

            return {eventTransaction: await getDynamoGeneralRealtimeEventTransaction(context)};
        },
    },

    createSiteContainer: {
        visibility: ["AppClient"],
        execute: async (context, input, {callId}) => {
            const {getDynamoGeneralRealtimeEventTransaction} = await createSiteContainer(
                context.actor.authorizeSession(),
                input.siteId,
                {
                    orderKey: input.orderKey,
                    label: input.label,
                    container: input.container,
                },
                {clientRequestToken: callId},
            );

            return {
                eventTransaction: await getDynamoGeneralRealtimeEventTransaction(context),
            };
        },
    },

    updateSiteContainerLabel: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransaction} = await updateSiteContainerLabel(
                context.actor.authorizeSession(),
                input,
            );
            return {
                eventTransaction: await getDynamoGeneralRealtimeEventTransaction(context),
            };
        },
    },

    moveSiteEntry: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransaction} = await moveSiteEntry(
                context.actor.authorizeSession(),
                input,
            );

            return {
                eventTransaction: await getDynamoGeneralRealtimeEventTransaction(context),
            };
        },
    },

    deleteSiteContainer: {
        visibility: ["AppClient"],
        execute: async (context, input, {callId}) => {
            // The RPC takes SiteItemId but deleteSiteContainer expects SiteContainerId This
            // RPC is for containers only - use removeEntityFromSite for entity refs
            const {getDynamoGeneralRealtimeEventTransaction} = await deleteSiteContainer(
                context.actor.authorizeSession(),
                input,
                {clientRequestToken: callId},
            );

            return {
                eventTransaction: await getDynamoGeneralRealtimeEventTransaction(context),
            };
        },
    },

    addEntityToSite: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransactionForSite} = await addEntityToSite(
                context.actor.authorizeSession(),
                input,
            );
            return {
                eventTransaction: await getDynamoGeneralRealtimeEventTransactionForSite(context),
            };
        },
    },

    removeEntityFromSite: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getDynamoGeneralRealtimeEventTransactionForSite} = await removeEntityFromSite(
                context.actor.authorizeSession(),
                input,
            );
            return {
                eventTransaction: await getDynamoGeneralRealtimeEventTransactionForSite(context),
            };
        },
    },

    authorizeSiteAccess: {
        visibility: ["AppClient", "SiteRealtimeService"],
        execute: async (context, input) => {
            return authorizeSiteAccess(
                context.actor.authorizeSession(),
                input.siteId,
                input.expectedAccessLevel,
            );
        },
    },

    getSiteRealtimeEvent: {
        visibility: ["SiteRealtimeService"],
        execute: async (context, input) => {
            const eventTransaction = await getSiteRealtimeEvent(
                context.actor.authorizeSession(),
                input.siteId,
                input.eventTransaction,
            );
            return {eventTransaction};
        },
    },

    getSite: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const siteResult = await getSite(context, {
                siteId: input.siteId,
                afterItemKey: input.afterItemKey,
                consistency: input.consistency,
            });
            return {siteResult};
        },
    },

    backfillSite: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const backfillResult = await backfillSite(context, {
                siteId: input.siteId,
                checkpoint: input.checkpoint,
            });
            return {backfillResult};
        },
    },
});
