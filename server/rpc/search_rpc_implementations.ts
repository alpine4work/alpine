import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {
    searchByAffinity,
    searchByKeywords,
    searchBySemantics,
    searchChannelsByAffinity,
    searchChannelsByKeywords,
    searchTaskCollectionsByAffinity,
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

implementRpc(
    definition.searchChannelsByKeywords,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const results = await searchChannelsByKeywords(context.actor.authorizeSession(), input);
        return {results};
    },
);

implementRpc(
    definition.searchChannelsByAffinity,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const results = await searchChannelsByAffinity(context.actor.authorizeSession(), input);
        return {results};
    },
);

implementRpc(
    definition.searchTaskCollectionsByAffinity,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const results = await searchTaskCollectionsByAffinity(
            context.actor.authorizeSession(),
            input,
        );
        return {results};
    },
);
