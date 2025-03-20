import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {
    searchByAffinity,
    searchByKeywords,
    searchBySemantics,
    searchChannelsByAffinity,
    searchChannelsByKeywords,
    searchTaskCollectionsByAffinity,
} from "~/server/search/data/index/search_entity_index.js";
import {markSearchAffinityInteraction} from "~/server/search/data/table/search_entity_table.js";
import * as definitions from "~/shared/rpc/search_rpc_definitions.js";

export default implementRpcs(definitions, {
    searchByKeywords: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            return searchByKeywords(context.actor.authorizeSession(), input);
        },
    },

    searchBySemantics: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            return searchBySemantics(context.actor.authorizeSession(), input);
        },
    },

    searchByAffinity: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            return searchByAffinity(context.actor.authorizeSession(), input.spaceId);
        },
    },

    markSearchAffinityInteraction: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await markSearchAffinityInteraction(context.actor.authorizeSession(), input);
            return {};
        },
    },

    searchChannelsByKeywords: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const results = await searchChannelsByKeywords(context.actor.authorizeSession(), input);
            return {results};
        },
    },

    searchChannelsByAffinity: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const results = await searchChannelsByAffinity(context.actor.authorizeSession(), input);
            return {results};
        },
    },

    searchTaskCollectionsByAffinity: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const results = await searchTaskCollectionsByAffinity(
                context.actor.authorizeSession(),
                input,
            );
            return {results};
        },
    },
});
