import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {
    searchByAffinity,
    searchByKeywords,
    searchBySemantics,
    searchChannelsByAffinity,
    searchChannelsByKeywords,
    searchMentionByKeywords,
    searchTaskCollectionsByAffinity,
    searchTaskCollectionsByKeywords,
} from "~/server/search/data/index/search_entity_index.js";
import {
    clearSearchEntityAffinity,
    favoriteSearchEntity,
    markSearchAffinityEntityInteraction,
    moveSearchFavoriteEntity,
    unfavoriteSearchEntity,
} from "~/server/search/data/table/search_entity_table.js";
import * as definitions from "~/shared/rpc/search_rpc_definitions.js";

export default implementRpcs(definitions, {
    searchByKeywords: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const results = await searchByKeywords(context.actor.authorizeSession(), input);
            return {results};
        },
    },

    searchBySemantics: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const results = await searchBySemantics(context.actor.authorizeSession(), input);
            return {results};
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

    clearSearchEntityAffinity: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await clearSearchEntityAffinity(context.actor.authorizeSession(), input);
            return {};
        },
    },

    searchMentionByKeywords: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const results = await searchMentionByKeywords(context.actor.authorizeSession(), input);
            return {results};
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

    searchTaskCollectionsByKeywords: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const results = await searchTaskCollectionsByKeywords(
                context.actor.authorizeSession(),
                input,
            );
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

    favoriteSearchEntity: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await favoriteSearchEntity(context.actor.authorizeSession(), input);
            return {};
        },
    },

    unfavoriteSearchEntity: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await unfavoriteSearchEntity(context.actor.authorizeSession(), input);
            return {};
        },
    },

    moveSearchFavoriteEntity: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await moveSearchFavoriteEntity(context.actor.authorizeSession(), input);
            return {};
        },
    },
});
