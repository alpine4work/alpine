import {SearchInjection} from "~/server/context/injection_context_module.js";
import {getSearchMentionEntityIfPossible} from "~/server/search/data/index/search_entity_index.js";
import {
    dangerouslyAddInitialSearchEntityAffinityWithoutAuthorizationTransactionEntries,
    dangerouslyFavoriteSearchEntityWithoutAuthorization,
} from "~/server/search/data/table/search_entity_actions.js";

export const searchInjection: SearchInjection = {
    getSearchMentionEntityIfPossible,
    dangerouslyFavoriteSearchEntityWithoutAuthorization,
    dangerouslyAddInitialSearchEntityAffinityWithoutAuthorizationTransactionEntries,
};
