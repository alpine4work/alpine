import {LocalAccessPolicySchema} from "~/shared/access/access_policy.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {AccountId, SiteId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {
    SearchChannelEntityModelDataSchema,
    SearchChatEntityModelDataSchema,
    SearchDocumentEntityModelDataSchema,
    SearchEntityModel,
    SearchEntityModelData,
    SearchEntityModelId,
    SearchTaskCollectionEntityModelDataSchema,
    SearchTaskEntityModelDataSchema,
} from "~/shared/search/search_entity_model.js";
import {
    SiteItemSearchEntityId,
    SiteItemSearchEntityIdSchema,
} from "~/shared/search/site_item_search_entity_id.js";
import {
    SiteRootContainerId,
    SiteSideBarContainerId,
    SiteSideBarSectionContainerId,
    SiteTopBarContainerId,
} from "~/shared/sites/site_entry_id.js";
import {
    SiteEntryEntitySchema,
    SiteEntrySideBarSchema,
    SiteEntrySideBarSectionSchema,
    SiteEntryTopBarSchema,
} from "~/shared/sites/site_entry_schema.js";

export const SitePreviewModelDataSchema = Schema.object({
    id: Schema.id<SiteId>(),
    spaceId: Schema.id<SpaceId>(),
    name: LabelStringSchema,
    firstEntityId: SiteItemSearchEntityIdSchema.nullable(),
    createdTime: Schema.date,
    accessPolicy: LocalAccessPolicySchema,
    version: Schema.integer,
    rootContainerId: Schema.stringAs<SiteRootContainerId>(),
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
        // Serializing the model over the network is fine. Generally only the
        // server serializes data over the network for the client.
        //
        // eslint-disable-next-line cyberworlds/no-model-initial-data
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
        // Used when merging `SitePreviewModel`s to reconcile to models and get the latest
        // data. So accessing `initialData` is required to do that. (This is the mechanism
        // that helps keeps `SiteRegistry` up-to-date.)
        /* eslint-disable cyberworlds/no-model-initial-data */
        const data = SitePreviewModel.mergeData(this.initialData, other.initialData);
        if (data === this.initialData) return this;
        if (data === other.initialData) return other;
        return new SitePreviewModel(data);
        /* eslint-enable cyberworlds/no-model-initial-data */
    }
}

/* ========================================================================== *\
 *                            Site Entry Models                               *
 * ========================================================================== */

export class SiteTopBarModel extends Model(
    SiteEntryTopBarSchema.merge(
        Schema.object({
            version: Schema.integer,
            id: Schema.stringAs<SiteTopBarContainerId>(),
        }),
    ),
) {}

export class SiteSideBarModel extends Model(
    SiteEntrySideBarSchema.merge(
        Schema.object({
            version: Schema.integer,
            id: Schema.stringAs<SiteSideBarContainerId>(),
        }),
    ),
) {}

export class SiteSideBarSectionModel extends Model(
    SiteEntrySideBarSectionSchema.merge(
        Schema.object({
            version: Schema.integer,
            id: Schema.stringAs<SiteSideBarSectionContainerId>(),
        }),
    ),
) {}

export type SiteEntrySearchEntityModelData = SchemaType<
    typeof SiteEntrySearchEntityModelDataSchema
>;
const SiteEntrySearchEntityModelDataSchema = Schema.union({
    Channel: SearchChannelEntityModelDataSchema,
    Chat: SearchChatEntityModelDataSchema,
    Document: SearchDocumentEntityModelDataSchema,
    Task: SearchTaskEntityModelDataSchema,
    TaskCollection: SearchTaskCollectionEntityModelDataSchema,
});

export interface SiteEntrySearchEntityModel extends SearchEntityModel {
    readonly id: SearchEntityModelId & SiteItemSearchEntityId;

    readonly initialData: SiteEntrySearchEntityModelData;

    getSearchEntityId(): SearchEntityModelId & SiteItemSearchEntityId;
}

export const SiteEntrySearchEntityModel: {
    schema: Schema<SiteEntrySearchEntityModel>;
    // TypeScript treats `new` as a keyword and not a property when it doesn't have
    // quotes when generating a `.d.ts` file.
    "new"(initialData: SiteEntrySearchEntityModelData): SiteEntrySearchEntityModel;
} = {
    schema: SiteEntrySearchEntityModelDataSchema.transform<SiteEntrySearchEntityModel>({
        // Serializing the model over the network is fine. Generally only the
        // server serializes data over the network for the client.
        //
        // eslint-disable-next-line cyberworlds/no-model-initial-data
        serialize: entity => entity.initialData,
        deserialize: entity => SiteEntrySearchEntityModel.new(entity),
    }),

    new(initialData: SiteEntrySearchEntityModelData): SiteEntrySearchEntityModel {
        return new SearchEntityModel(initialData) as SiteEntrySearchEntityModel;
    },
};

export class SiteEntityModel extends Model(
    SiteEntryEntitySchema.merge(
        Schema.object({
            version: Schema.integer,
            id: SiteItemSearchEntityIdSchema,
            entity: SiteEntrySearchEntityModel.schema,
        }),
    ),
) {}

export function isSiteEntrySearchEntityModelData(
    data: SearchEntityModelData,
): data is SiteEntrySearchEntityModelData {
    switch (data.type) {
        case "Channel":
        case "Chat":
        case "Document":
        case "Task":
        case "TaskCollection":
            return true;
        case "Post":
        case "Static":
        case "Site":
        case "ChatMessage":
        case "DocumentComment":
        case "PostComment":
        case "TaskComment": {
            return false;
        }
        default:
            throw exhaustive(data);
    }
}

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
