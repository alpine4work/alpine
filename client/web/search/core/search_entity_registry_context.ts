import {useMemo} from "react";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {
    createGlobalContext,
    getGlobalContext,
    useGlobalContext,
} from "~/client/web/helpers/global_context.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {SearchEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel, SearchEntityModelData} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const SearchEntityRegistryContext = createGlobalContext(
    () => new Map<SpaceId, SearchEntityRegistry>(),
);

/**
 * On the client you have global access to the search entity registry. Not just
 * access through React context.
 *
 * If the global registry hasn't been initialized yet (since a context provider
 * component hasn't mounted) then calling this function will initialize it.
 *
 * Will throw an error if we're not running in a web browser.
 */
export function getSearchEntityRegistry(spaceId: SpaceId): SearchEntityRegistry {
    return getOrSetDefaultMapValue(
        getGlobalContext(SearchEntityRegistryContext),
        spaceId,
        () => new SearchEntityRegistry(),
    );
}

/**
 * Gets the search entity registry for our app. Used to normalize our presentation
 * of entities on the client even when we've loaded different data objects for the
 * entities.
 *
 * If we're in a web browser we have one global registry instance.
 */
export function useSearchEntityRegistry(): SearchEntityRegistry {
    const {space} = useSpaceContext();

    return getOrSetDefaultMapValue(
        useGlobalContext(SearchEntityRegistryContext),
        space.id,
        () => new SearchEntityRegistry(),
    );
}

export function useSearchEntityRegistryForSpaceId(spaceId: SpaceId): SearchEntityRegistry {
    return getOrSetDefaultMapValue(
        useGlobalContext(SearchEntityRegistryContext),
        spaceId,
        () => new SearchEntityRegistry(),
    );
}

/**
 * Returns up-to-date data for the provided entity that's the same as everywhere
 * else the entity is presented. If we observe the entity's data change this hook
 * will re-render with the new data.
 */
export function useSearchEntityModel(
    entity: SearchEntityModel | SearchEntityModelData,
): SearchEntityModelData;
export function useSearchEntityModel(
    entity: SearchEntityModel | SearchEntityModelData | null,
): SearchEntityModelData | null;
export function useSearchEntityModel(
    entity: SearchEntityModel | SearchEntityModelData | AccountModel,
): Replace<SearchEntityModelData, {readonly id: SearchEntityId}>;
export function useSearchEntityModel(
    entity: SearchEntityModel | SearchEntityModelData | AccountModel | null,
): Replace<SearchEntityModelData, {readonly id: SearchEntityId}> | null;
export function useSearchEntityModel(
    entity: SearchEntityModel | SearchEntityModelData | AccountModel | null,
): Replace<SearchEntityModelData, {readonly id: SearchEntityId}> | null {
    const accountRegistry = useAccountRegistry();
    const entityRegistry = useSearchEntityRegistry();

    const entityData = useStore(
        useMemo(() => {
            if (entity instanceof SearchEntityModel) {
                return entityRegistry.getEntityStore(entity);
            } else if (!(entity instanceof AccountModel)) {
                return null;
            }
            // If this is an `AccountModel` then read the latest data from `accountRegistry`
            // and map it into the expected `SearchEntityModelData` format.
            else {
                return accountRegistry.getAccountStore(entity).map(
                    (data): Replace<SearchEntityModelData, {readonly id: SearchEntityId}> => ({
                        id: `Account:${data.id}`,
                        title: data.name,
                        titleVersion: {type: "Integer", version: data.version},
                        media: {type: "Account", account: entity},
                    }),
                );
            }
        }, [accountRegistry, entity, entityRegistry]),
    );

    if (entityData === null) {
        return entity as SearchEntityModelData | null;
    } else {
        return entityData;
    }
}
