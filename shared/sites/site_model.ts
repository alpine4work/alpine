import {LocalAccessPolicySchema} from "~/shared/access/access_policy.js";
import {SiteId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SiteItemSearchEntityIdSchema} from "~/shared/sites/site_item_search_entity_id.js";

export const SitePreviewModelDataSchema = Schema.object({
    id: Schema.id<SiteId>(),
    spaceId: Schema.id<SpaceId>(),
    name: LabelStringSchema,
    firstEntityId: SiteItemSearchEntityIdSchema.nullable(),
    createdTime: Schema.date,
    accessPolicy: LocalAccessPolicySchema,
    version: Schema.integer,
});
export type SitePreviewModelData = SchemaType<typeof SitePreviewModelDataSchema>;

/**
 * Preview model for a Site with minimal data
 */
export class SitePreviewModel {
    public readonly id: SiteId;

    /**
     * The data this `SitePreviewModel` object was initialized with. May not be the
     * latest data for the site!
     *
     * We use this property to discourage direct access to the data a site was loaded
     * with and instead use the `SiteRegistry` to get the latest data for a site on the
     * client.
     *
     * If you find yourself needing this property on the client, something has probably
     * gone wrong.
     */
    public readonly initialData: SitePreviewModelData;

    constructor(initialData: SitePreviewModelData) {
        this.id = initialData.id;
        this.initialData = initialData;
    }

    public static readonly schema = SitePreviewModelDataSchema.transform<SitePreviewModel>({
        serialize: site => site.initialData,
        deserialize: site => new SitePreviewModel(site),
    });

    public static mergeData(
        data1: SitePreviewModelData,
        data2: SitePreviewModelData,
    ): SitePreviewModelData {
        if (data1.version >= data2.version) {
            return data1;
        }

        return data2;
    }

    public merge(other: SitePreviewModel) {
        const data = SitePreviewModel.mergeData(this.initialData, other.initialData);
        if (data === this.initialData) return this;
        if (data === other.initialData) return other;
        return new SitePreviewModel(data);
    }
}
