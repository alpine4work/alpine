import {useMemo} from "react";
import {useRootLocation} from "~/client/web/remix/root_location_context.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {parseSearchEntityIdFromPathname} from "~/shared/search/parse_search_entity_id_from_url.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

/**
 * Extracts the currently viewed entity from the route pathname.
 *
 * This is used to provide context to bots about what the user is looking at when
 * they send a message. Uses the "root" location so it works correctly when called
 * from inside a peek (where useLocation() would return the peek's memory router
 * location instead of the main browser router location).
 *
 * Returns `null` if no matching entity is found in the pathname.
 */
export function useCurrentlyViewingSearchEntityId(spaceId: SpaceId): SearchMentionEntityId | null {
    const location = useRootLocation();

    return useMemo(() => {
        return parseSearchEntityIdFromPathname(spaceId, location.pathname);
    }, [location.pathname, spaceId]);
}
