import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {
    searchByAffinity,
    searchByKeywords,
    searchBySemantics,
} from "~/server/search/data/index/search_entity_index.js";
import {markSearchAffinityInteraction} from "~/server/search/data/table/search_entity_table.js";
import * as definition from "~/shared/rpc/search_rpc_definitions.js";

implementRpc(definition.searchByKeywords, {visibility: ["AppClient"]}, async (context, input) => {
    return searchByKeywords(context.actor.authorizeSession(), input);
});

implementRpc(definition.searchBySemantics, {visibility: ["AppClient"]}, async (context, input) => {
    return searchBySemantics(context.actor.authorizeSession(), input);
});

implementRpc(definition.searchByAffinity, {visibility: ["AppClient"]}, async (context, input) => {
    return searchByAffinity(context.actor.authorizeSession(), input);
});

implementRpc(
    definition.markSearchAffinityInteraction,
    {visibility: ["AppClient"]},
    async (context, input) => {
        await markSearchAffinityInteraction(context.actor.authorizeSession(), input);
        return {};
    },
);
