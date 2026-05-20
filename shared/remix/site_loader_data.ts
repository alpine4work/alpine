import {createRynamoQuerySchema} from "~/shared/dynamo/rynamo_types.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SiteItemSearchEntityIdSchema} from "~/shared/search/site_item_search_entity_id.js";
import {SiteOrSiteEntryModelSchema} from "~/shared/sites/site_model.js";

export type SiteLoaderData = SchemaType<typeof SiteLoaderDataSchema>;

/**
 * Site activation data published by an entity route's loader.
 *
 * - `UseNewSite`: the loader fetched a new realtime query result for the site.
 *   Always used on first load of a site, or when the client signals it does not
 *   have the site cached.
 * - `UseActiveSite`: the client signaled (via `?siteFromCache=<siteId>`) that it
 *   already has a live realtime subscription for the site, so the loader skipped
 *   `getSiteWithItemsRealtime` and only published the `siteId`. The space-level
 *   `SiteProvider` keeps its existing activation when it sees this variant.
 */
export const SiteLoaderDataSchema = Schema.union({
    UseNewSite: Schema.object({
        type: Schema.value("UseNewSite"),
        siteId: Schema.id<SiteId>(),
        initialQueryResult: createRynamoQuerySchema(SiteOrSiteEntryModelSchema),
        /**
         * The entity rendered by this route, if any. The provider reads this from the
         * matched route tree to derive the site's active-entity state — so child routes
         * never need to imperatively call `setActiveEntityId`. Routes that don't render a
         * specific entity (e.g. the site root) omit this.
         */
        activeEntityId: SiteItemSearchEntityIdSchema,
    }),
    UseActiveSite: Schema.object({
        type: Schema.value("UseActiveSite"),
        siteId: Schema.id<SiteId>(),
        /**
         * The entity rendered by this route, if any. The provider reads this from the
         * matched route tree to derive the site's active-entity state — so child routes
         * never need to imperatively call `setActiveEntityId`. Routes that don't render a
         * specific entity (e.g. the site root) omit this.
         */
        activeEntityId: SiteItemSearchEntityIdSchema,
    }),
});
