import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {
    searchByAffinity,
    searchByKeywords,
    searchBySemantics,
    searchChannelsByAffinity,
    searchChannelsByKeywords,
    searchTaskCollectionsByAffinity,
} from "~/server/search/data/index/search_entity_index.js";
import {
    favoriteSearchAffinityEntity,
    markSearchAffinityEntityInteraction,
    moveSearchFavoriteAffinityEntity,
    unfavoriteSearchAffinityEntity,
} from "~/server/search/data/table/search_entity_table.js";
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

    markSearchAffinityEntityInteraction: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await markSearchAffinityEntityInteraction(context.actor.authorizeSession(), input);
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

    favoriteSearchAffinityEntity: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await favoriteSearchAffinityEntity(context.actor.authorizeSession(), input);
            return {};
        },
    },

    unfavoriteSearchAffinityEntity: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await unfavoriteSearchAffinityEntity(context.actor.authorizeSession(), input);
            return {};
        },
    },

    moveSearchFavoriteAffinityEntity: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await moveSearchFavoriteAffinityEntity(context.actor.authorizeSession(), input);
            return {};
        },
    },
});
