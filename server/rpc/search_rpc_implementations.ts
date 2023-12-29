import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {
    getAffinitiveSearchEntities,
    searchByKeywords,
    searchBySemantics,
} from "~/server/search/data/index/search_entity_index.js";
import {markSearchEntityAffinityInteraction} from "~/server/search/data/table/search_entity_table.js";
import * as definition from "~/shared/rpc/search_rpc_definitions.js";

implementRpc(definition.searchByKeywords, {visibility: ["AppClient"]}, async (context, input) => {
    return searchByKeywords(context.actor.authorizeSession(), input);
});

implementRpc(definition.searchBySemantics, {visibility: ["AppClient"]}, async (context, input) => {
    return searchBySemantics(context.actor.authorizeSession(), input);
});

implementRpc(
    definition.markSearchEntityAffinityInteraction,
    {visibility: ["AppClient"]},
    async (context, input) => {
        await markSearchEntityAffinityInteraction(context.actor.authorizeSession(), input);
        return {};
    },
);

implementRpc(
    definition.getAffinitiveSearchEntities,
    {visibility: ["AppClient"]},
    async (context, input) => {
        return getAffinitiveSearchEntities(context.actor.authorizeSession(), input);
    },
);
