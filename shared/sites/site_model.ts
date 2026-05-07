import {LocalAccessPolicySchema} from "~/shared/access/access_policy.js";
import {AccountId, SiteId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SearchEntityModelDataSchema} from "~/shared/search/search_entity_model.js";
import {
    SiteRootContainerId,
    SiteSideBarContainerId,
    SiteSideBarSectionContainerId,
    SiteTopBarContainerId,
} from "~/shared/sites/site_entry_id.js";
import {
    SiteEntityEntrySchema,
    SiteSideBarEntrySchema,
    SiteSideBarSectionEntrySchema,
    SiteTopBarEntrySchema,
} from "~/shared/sites/site_entry_schema.js";
import {SiteItemSearchEntityIdSchema} from "~/shared/sites/site_item_search_entity_id.js";

export const SitePreviewModelDataSchema = Schema.object({
    id: Schema.id<SiteId>(),
    spaceId: Schema.id<SpaceId>(),
    name: LabelStringSchema,
    firstEntityId: SiteItemSearchEntityIdSchema.nullable(),
    createdTime: Schema.date,
    accessPolicy: LocalAccessPolicySchema,
    version: Schema.integer,
    rootContainerId: Schema.string as Schema<SiteRootContainerId>,
    creatorId: Schema.id<AccountId>(),
});
export type SitePreviewModelData = SchemaType<typeof SitePreviewModelDataSchema>;

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
        if (data1.version >= data2.version) return data1;
        return data2;
    }

    public merge(other: SitePreviewModel) {
        const data = SitePreviewModel.mergeData(this.initialData, other.initialData);
        if (data === this.initialData) return this;
        if (data === other.initialData) return other;
        return new SitePreviewModel(data);
    }
}

/* ========================================================================== *\
 *                            Site Entry Models                               *
 * ========================================================================== */

export class SiteTopBarModel extends Model(
    SiteTopBarEntrySchema.merge(
        Schema.object({
            version: Schema.integer,
            id: Schema.string as Schema<SiteTopBarContainerId>,
        }),
    ),
) {}

export class SiteSideBarModel extends Model(
    SiteSideBarEntrySchema.merge(
        Schema.object({
            version: Schema.integer,
            id: Schema.string as Schema<SiteSideBarContainerId>,
        }),
    ),
) {}

export class SiteSideBarSectionModel extends Model(
    SiteSideBarSectionEntrySchema.merge(
        Schema.object({
            version: Schema.integer,
            id: Schema.string as Schema<SiteSideBarSectionContainerId>,
        }),
    ),
) {}

export class SiteEntityModel extends Model(
    SiteEntityEntrySchema.merge(
        Schema.object({
            version: Schema.integer,
            id: SiteItemSearchEntityIdSchema,
            initialEntityData: SearchEntityModelDataSchema.merge(
                Schema.object({id: SiteItemSearchEntityIdSchema}),
            ),
        }),
    ),
) {}

/**
 * Union of all site entry model types.
 */
export type SiteEntryModel =
    | SiteTopBarModel
    | SiteSideBarModel
    | SiteSideBarSectionModel
    | SiteEntityModel;

// =============================================================================
// Convenience type aliases
// =============================================================================

export const SiteOrSiteEntryModelSchema = createModelUnionSchema({
    Site: SitePreviewModel,
    TopBar: SiteTopBarModel,
    SideBar: SiteSideBarModel,
    SideBarSection: SiteSideBarSectionModel,
    Entity: SiteEntityModel,
});

export type SiteOrSiteEntryModel = SchemaType<typeof SiteOrSiteEntryModelSchema>;
