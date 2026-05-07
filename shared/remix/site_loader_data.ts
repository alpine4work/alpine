import {createDynamoGeneralRealtimeQuerySchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {SiteId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SiteItemSearchEntityIdSchema} from "~/shared/sites/site_item_search_entity_id.js";
import {SiteOrSiteEntryModelSchema} from "~/shared/sites/site_model.js";

export type SiteLoaderData = SchemaType<typeof SiteLoaderDataSchema>;

export const SiteLoaderDataSchema = Schema.object({
    siteId: Schema.id<SiteId>(),
    initialQueryResult: createDynamoGeneralRealtimeQuerySchema(SiteOrSiteEntryModelSchema),
    /**
     * The entity rendered by this route, if any. The provider reads this from the
     * matched route tree to derive the site's active-entity state — so child routes
     * never need to imperatively call `setActiveEntityId`. Routes that don't render a
     * specific entity (e.g. the site root) omit this.
     */
    activeEntityId: SiteItemSearchEntityIdSchema.nullable().default(null),
});
