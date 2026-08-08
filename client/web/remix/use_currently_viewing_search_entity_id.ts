import {useMemo} from "react";
import {useRootLocation} from "~/client/web/remix/root_location_context.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {parseSearchEntityIdFromUrl} from "~/shared/search/parse_search_entity_id_from_url.js";
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
export function useCurrentlyViewingSearchEntityId(): SearchMentionEntityId | null {
    const location = useRootLocation();

    return useMemo(() => {
        const url = new URL(location.pathname, "https://alpine.inc");

        const entityId = parseSearchEntityIdFromUrl(url.toString());

        if (!entityId || isAccountEntityId(entityId)) return null;

        return entityId;
    }, [location.pathname]);
}

function isAccountEntityId(
    entityId: SearchMentionEntityId | `Account:${AccountId}`,
): entityId is `Account:${AccountId}` {
    return entityId.startsWith(`Account:`);
}
