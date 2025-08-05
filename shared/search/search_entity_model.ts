import {assert} from "~/shared/helpers/control/assert.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    SearchAffinityEntityId,
    SearchEntityId,
    SearchEntityIdSchema,
} from "~/shared/search/search_entity_id.js";
import {
    SearchEntityMediaModelSchema,
    mergeSearchEntityMediaModel,
} from "~/shared/search/search_entity_media_model.js";
import {
    SearchEntityTitleVersionSchema,
    compareSearchEntityTitleVersion,
} from "~/shared/search/search_entity_title_version.js";

export type SearchEntityModelId = Exclude<SearchEntityId, `Account:${AccountId}`>;

export function assertSearchEntityModelId(entityId: SearchEntityId): SearchEntityModelId {
    assert(isSearchEntityModelId(entityId));
    return entityId;
}

export function isSearchEntityModelId(entityId: SearchEntityId): entityId is SearchEntityModelId {
    return !entityId.startsWith("Account:");
}

export type SearchEntityModelData = SchemaType<typeof SearchEntityModelDataSchema>;

const SearchEntityModelDataSchema = Schema.object({
    id: SearchEntityIdSchema as Schema<SearchEntityModelId>,
    title: Schema.string.nullable(),
    titleVersion: SearchEntityTitleVersionSchema.nullable(),
    media: SearchEntityMediaModelSchema.nullable(),
});

/**
 * Model representing a search entity on the client. Search entity is a
 * standard interface for all content in our system so we can reference objects
 * in a consistent way throughout the product.
 *
 * We don't allow accounts as search entity models. Instead use `AccountModel`
 * so we don't end up with conflicting versions of the same data.
 *
 * The data for `SearchEntityModel` is in an `initialData` property. You're
 * discouraged from using the `initialData` property on the client. Instead you
 * should use `SearchEntityClientStore` which normalizes search entities so you
 * see consistent data for each individual search entity and if a search entity
 * updates in one place it updates everywhere.
 */
export class SearchEntityModel {
    public readonly id: SearchEntityModelId;

    /**
     * Don't use this property on the client! Use `SearchEntityClientStore` to get
     * the latest data for this search entity.
     */
    public readonly initialData: SearchEntityModelData;

    constructor(initialData: SearchEntityModelData) {
        // Double check that we can't have an account `SearchEntityModel`. The type
        // system should already disallow this but we want to be extra sure. Instead
        // we should use `AccountModel` to represent accounts on the client.
        assert(!initialData.id.startsWith("Account:"));

        this.id = initialData.id;
        this.initialData = initialData;
    }

    public static readonly schema = SearchEntityModelDataSchema.transform<SearchEntityModel>({
        serialize: entity => entity.initialData,
        deserialize: entity => new SearchEntityModel(entity),
    });

    /**
     * Also implemented by `AccountModel` so you can call
     * `getSearchEntityId()` on `SearchEntityModel | AccountModel` to get the
     * `SearchEntityId`.
     */
    public getSearchEntityId(): SearchEntityModelId {
        return this.id;
    }

    /**
     * Merge two `SearchEntityModel`s together.
     *
     * You should generally pass in the older data into `oldData` and newer data
     * to `newData`. So we avoid unnecessary re-renders when the data is equal
     * (and `oldData` is preferred) and in case we don't have clear version
     * information we prefer the newer data (`newData`).
     */
    public static mergeData(
        oldData: SearchEntityModelData,
        newData: SearchEntityModelData,
    ): SearchEntityModelData {
        assert(oldData.id === newData.id);

        const titleVersionCompare = compareSearchEntityTitleVersion(
            oldData.titleVersion,
            newData.titleVersion,
        );
        const mergedMedia = mergeSearchEntityMediaModel(oldData.media, newData.media);

        if (
            (titleVersionCompare > 0 ||
                (titleVersionCompare === 0 && oldData.title === newData.title)) &&
            oldData.media === mergedMedia
        ) {
            return oldData;
        }
        if (titleVersionCompare <= 0 && newData.media === mergedMedia) {
            return newData;
        }

        return {
            id: oldData.id,
            title: titleVersionCompare > 0 ? oldData.title : newData.title,
            titleVersion: titleVersionCompare >= 0 ? oldData.titleVersion : newData.titleVersion,
            media: mergedMedia,
        };
    }

    public merge(otherEntity: SearchEntityModel): SearchEntityModel {
        const data = SearchEntityModel.mergeData(this.initialData, otherEntity.initialData);
        if (data === this.initialData) return this;
        if (data === otherEntity.initialData) return otherEntity;
        return new SearchEntityModel(data);
    }
}

/**
 * Variant of `SearchEntityModel` that only supports search entities that collect
 * affinity points. So search entities with an `id` of `SearchAffinityEntityId`.
 *
 * If you call `new SearchAffinityEntityModel()` it returns a
 * `SearchEntityModel`.
 */
export interface SearchAffinityEntityModel extends SearchEntityModel {
    readonly id: SearchEntityModelId & SearchAffinityEntityId;

    readonly initialData: Replace<
        SearchEntityModelData,
        {readonly id: SearchEntityModelId & SearchAffinityEntityId}
    >;

    getSearchEntityId(): SearchEntityModelId & SearchAffinityEntityId;
}

export const SearchAffinityEntityModel: {
    // TypeScript treats `new` as a keyword and not a property when it doesn't
    // have quotes when generating a `.d.ts` file.
    "new"(
        initialData: Replace<
            SearchEntityModelData,
            {readonly id: SearchEntityModelId & SearchAffinityEntityId}
        >,
    ): SearchAffinityEntityModel;
} = {
    new(
        initialData: Replace<
            SearchEntityModelData,
            {readonly id: SearchEntityModelId & SearchAffinityEntityId}
        >,
    ): SearchAffinityEntityModel {
        return new SearchEntityModel(initialData) as SearchAffinityEntityModel;
    },
};
