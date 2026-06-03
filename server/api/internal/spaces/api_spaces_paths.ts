import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {intoApiInboxEntry} from "~/server/api/internal/spaces/internal/into_api_inbox_entry.js";
import {intoApiSearchResult} from "~/server/api/internal/spaces/into_api_search_result.js";
import {getBotSpaceAndSpaceAccountSettingsValues} from "~/server/bots/with_spaces/get_bot_space_and_space_account_settings_values.js";
import {getBotSpaceSettingsValues} from "~/server/bots/with_spaces/get_bot_space_settings_values.js";
import {getInboxEntriesForAccount} from "~/server/notifications/data/get_inbox_entries_for_account.js";
import {getInboxForAccount} from "~/server/notifications/data/get_inbox_for_account.js";
import {
    searchByKeywords,
    searchBySemantics,
} from "~/server/search/data/index/search_entity_index.js";
import {getAccountWithoutAvatar} from "~/server/spaces/get_account.js";
import {getSpace} from "~/server/spaces/get_space.js";
import {DynamoIndexCursorSchema} from "~/shared/dynamo/dynamo_opaque_strings.js";
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
            // We load the account data using the `SpaceId` the bot is instantiated in. So if
            // an account was removed from the space then our bot will see old data.
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

    "/accounts/{id}/mention": {
        get: async (context, {pathParameters}) => {
            // We load the account data using the `SpaceId` the bot is instantiated in. So if
            // an account was removed from the space then our bot will see old data.
            const account = await getAccountWithoutAvatar(
                context,
                context.actor.getSpaceId(),
                pathParameters.id,
                {consistency: "StrongWithinCache"},
            );

            return {
                content: {
                    mention: {
                        target: {
                            type: "Account",
                            id: pathParameters.id,
                        },
                        title: account.name,
                    },
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

    // TODO(#public-api): Document that reads from this endpoint will always be
    // eventually consistent.
    "/spaces/{id}/accounts/{accountId}/inbox": {
        get: async (context, {pathParameters}) => {
            const {id: spaceId, accountId} = pathParameters;

            // Inbox attributes come from a GSI/eventually-consistent read. The API layer
            // normally expects strongly consistent reads (same pattern as
            // `/spaces/{id}/search`).
            const inboxContext = context.dynamo.unexpectStrongReadConsistency();

            const inbox = await getInboxForAccount(inboxContext, {spaceId, accountId});

            return {
                content: {
                    inbox: {
                        loudNotificationCount: inbox.model.loudNotificationCount,
                        newEntryCount: inbox.model.entryCount,
                    },
                },
            };
        },
    },

    "/spaces/{id}/accounts/{accountId}/inbox/entries": {
        get: async (context, {pathParameters, queryParameters}) => {
            const {id: spaceId, accountId} = pathParameters;
            const limit = Math.min(queryParameters.limit ?? 20, 100);

            // Inbox list data comes from a GSI and entry models load related entities with
            // eventually consistent reads and the Dynamo context cache. The API layer normally
            // expects strongly consistent reads (same pattern as `/spaces/{id}/search`).
            const inboxContext = context.dynamo.unexpectStrongReadConsistency();

            const [inbox, entriesResult] = await runAllPromises([
                getInboxForAccount(inboxContext, {spaceId, accountId}),
                getInboxEntriesForAccount(inboxContext, {
                    spaceId,
                    accountId,
                    filter: queryParameters.status ?? "New",
                    limit,
                    afterCursor: DynamoIndexCursorSchema.nullable().deserialize(
                        queryParameters.cursor ?? null,
                    ),
                }),
            ]);

            const nextCursor =
                entriesResult.pageInfo.type === "FromStart" && entriesResult.pageInfo.hasNextPage
                    ? (entriesResult.items[entriesResult.items.length - 1]?.cursor ?? null)
                    : null;

            return {
                content: {
                    inbox: {
                        loudNotificationCount: inbox.model.loudNotificationCount,
                        newEntryCount: inbox.model.entryCount,
                    },
                    entries: entriesResult.items.map(({model}) => intoApiInboxEntry(model)),
                    nextCursor,
                },
            };
        },
    },

    "/spaces/{id}/bots/{botId}/settings": {
        get: async (context, {pathParameters}) => {
            const settings = await getBotSpaceSettingsValues(
                context,
                pathParameters.id,
                pathParameters.botId,
                {consistency: "StrongWithinCache"},
            );

            return {
                content: {
                    settings: {
                        values: Object.fromEntries(settings.values),
                    },
                },
            };
        },
    },

    "/spaces/{id}/accounts/{accountId}/bots/{botId}/settings": {
        get: async (context, {pathParameters}) => {
            const settings = await getBotSpaceAndSpaceAccountSettingsValues(
                context,
                pathParameters.id,
                pathParameters.accountId,
                pathParameters.botId,
                {consistency: "StrongWithinCache"},
            );

            return {
                content: {
                    settings: {
                        values: Object.fromEntries(settings.accountValues),
                        space: {
                            values: Object.fromEntries(settings.spaceValues),
                        },
                    },
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
                // TODO(ifitzsimmons, #ai): Figure out how to handle debug options. We should be
                // able to debug the results returned by the bot.
            });

            const semanticSearchEntityResultsPromise = searchBySemantics(newContext, {
                spaceId,
                queryText,
                limit,
                timeZone: defaultTimeZone,
                currentTime,
                // TODO(ifitzsimmons, #ai): Figure out how to handle debug options. We should be
                // able to debug the results returned by the bot.
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
