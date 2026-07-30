import {
    createGlobalContext,
    getGlobalContext,
    useGlobalContext,
} from "~/client/web/helpers/global_context.js";
import {SiteRegistry} from "~/client/web/sites/context/site_registry.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

const SiteRegistryContext = createGlobalContext(() => new Map<SpaceId, SiteRegistry>());

/**
 * On the client you have global access to the site registry. Not just access
 * through React context.
 *
 * If the global registry hasn't been initialized yet (since a context provider
 * component hasn't mounted) then calling this function will initialize it.
 *
 * Will throw an error if we're not running in a web browser.
 */
export function getSiteRegistry(spaceId: SpaceId): SiteRegistry {
    return getOrSetDefaultMapValue(
        getGlobalContext(SiteRegistryContext),
        spaceId,
        () => new SiteRegistry(),
    );
}

/**
 * Gets the site registry for our app. Used to normalize our presentation of sites
 * on the client even when we've loaded different data objects for the sites.
 *
 * If we're in a web browser we have one global registry instance.
 */
export function useSiteRegistry(): SiteRegistry {
    const {space} = useSpaceContext();

    return getOrSetDefaultMapValue(
        useGlobalContext(SiteRegistryContext),
        space.id,
        () => new SiteRegistry(),
    );
}
