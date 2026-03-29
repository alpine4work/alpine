import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoGeneralRealtimeTableItemType,
    DynamoGeneralRealtimeTableSchema,
} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {LocalAccessPolicySchema} from "~/shared/access/access_policy.js";
import {AccountId, SiteId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {SiteItemSearchEntityIdSchema} from "~/shared/sites/site_item_search_entity_id.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

export const SitesTable = DynamoGeneralRealtimeTableSchema.new({
    features: {
        realtimeQuery: {Site: true},
    },
    name: "Sites",
    partitions: [
        {
            name: "Site",
            partitionKeyAttributes: {
                siteId: DynamoKeyAttributeSchema.id<SiteId>(),
            },
            sortRanges: [
                /**
                 * Core attributes of the site including name, access policy, and metadata.
                 */
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),
                        name: LabelStringSchema,
                        accessPolicy: LocalAccessPolicySchema,
                        createdTime: Schema.date,
                        creatorId: Schema.id<AccountId>(),
                        updatedTime: Schema.date,
                        /**
                         * The first entity to display when the site is loaded. This is the "home page" of
                         * the site.
                         */
                        firstEntityId: SiteItemSearchEntityIdSchema.nullable(),
                    }),
                },

                // TODO(#sites): Add site items so that we can represent the actual site tree.
            ],
        },
    ],
    modelSchema: createModelUnionSchema({
        Site: SitePreviewModel,
        // TODO(#sites): Add site item models
    }),
    models: {
        Site: {
            Attributes: {
                build: async (_context, item) =>
                    new SitePreviewModel({
                        id: item.siteId,
                        spaceId: item.spaceId,
                        name: item.name,
                        version: item.updateLockVersion ?? 0,
                        accessPolicy: item.accessPolicy,
                        createdTime: item.createdTime,
                        firstEntityId: item.firstEntityId,
                    }),
            },
            // TODO(#sites): Add site item model
        },
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    broadcastEventTransaction: async (_context, _eventTransaction) => {
        // TODO(#sites): Implement broadcast event transaction
    },
});

export type SiteAttributesItem = DynamoGeneralRealtimeTableItemType<
    typeof SitesTable,
    "Site",
    "Attributes"
>;
