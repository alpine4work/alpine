import {SearchInjection} from "~/server/context/injection_context_module.js";
import {getSearchMentionEntityIfPossible} from "~/server/search/data/index/search_entity_index.js";
import {
    dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization,
    dangerouslyFavoriteSearchEntityWithoutAuthorization,
    markSearchAffinityEntityInteraction,
} from "~/server/search/data/table/search_entity_actions.js";

export const searchInjection: SearchInjection = {
    getSearchMentionEntityIfPossible,
    markSearchAffinityEntityInteraction,
    dangerouslyFavoriteSearchEntityWithoutAuthorization,
    dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization,
};
