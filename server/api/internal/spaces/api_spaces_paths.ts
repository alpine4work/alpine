import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {intoApiSearchResult} from "~/server/api/internal/spaces/into_api_search_result.js";
import {
    searchByKeywords,
    searchBySemantics,
} from "~/server/search/data/index/search_entity_index.js";
import {getSpace} from "~/server/spaces/spaces_actions.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {mergeKeywordAndSemanticSearchResults} from "~/shared/search/merge_keyword_and_semantic_search_results.js";
import {standardSearchOptions} from "~/shared/search/search_options.js";

export const apiSpacesPaths: Pick<
    ApiPaths,
    keyof ApiPaths & (`/spaces/${string}` | `/accounts/${string}`)
> = {
    "/accounts/{id}": {
        get: async (context, {pathParameters}) => {
            // We load the account data using the `SpaceId` the bot is instantiated in. So
            // if an account was removed from the space then our bot will see old data.
            const account = await getApiAccount(
                context,
                context.actor.getSpaceId(),
                pathParameters.id,
                {consistency: "StrongWithinCache"},
            );

            return {
                content: {
                    account: omitObject(account, ["space"]),
                },
            };
        },
    },

    "/spaces/{id}": {
        get: async (context, {pathParameters}) => {
            const space = await getSpace(context, pathParameters.id, {
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    space: {
                        id: pathParameters.id,
                        name: space.name,
                    },
                },
            };
        },
    },

    "/spaces/{id}/accounts/{accountId}": {
        get: async (context, {pathParameters}) => {
            const account = await getApiAccount(
                context,
                pathParameters.id,
                pathParameters.accountId,
                {consistency: "StrongWithinCache"},
            );

            return {
                content: {
                    account,
                },
            };
        },
    },

    "/spaces/{id}/search": {
        get: async (context, {pathParameters, queryParameters}) => {
            const newContext = context.dynamo.unexpectStrongReadConsistency();
            const limit = queryParameters.limit ?? 10;
            const queryText = queryParameters.query;
            const spaceId = pathParameters.id;

            const currentTime = new Date();

            const keywordSearchEntityResultsPromise = searchByKeywords(newContext, {
                spaceId,
                queryText,
                limit,
                timeZone: defaultTimeZone,
                currentTime,
                // TODO(ifitzsimmons, #ai): Figure out how to handle debug options.
                // We should be able to debug the results returned by the bot.
            });

            const semanticSearchEntityResultsPromise = searchBySemantics(newContext, {
                spaceId,
                queryText,
                limit,
                timeZone: defaultTimeZone,
                currentTime,
                // TODO(ifitzsimmons, #ai): Figure out how to handle debug options.
                // We should be able to debug the results returned by the bot.
            });

            const [keywordSearchResults, semanticSearchResults] = await runAllPromises([
                keywordSearchEntityResultsPromise,
                semanticSearchEntityResultsPromise,
            ]);

            const results = mergeKeywordAndSemanticSearchResults({
                keywordSearchResults,
                semanticSearchResults,
                options: standardSearchOptions,
            });

            return {
                content: {
                    results: results.map(intoApiSearchResult).filter(isNonNullable).slice(0, limit),
                },
            };
        },
    },
};
