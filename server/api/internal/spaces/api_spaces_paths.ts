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
import {expensivelyGetAllSpaceAccounts} from "~/server/spaces/expensively_get_all_space_accounts.js";
import {getAccountWithoutAvatar} from "~/server/spaces/get_account.js";
import {getSpace} from "~/server/spaces/get_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {DynamoIndexCursorSchema} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {mergeKeywordAndSemanticSearchResults} from "~/shared/search/merge_keyword_and_semantic_search_results.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {standardSearchOptions} from "~/shared/search/search_options.js";
import {intoApiAccount} from "~/shared/spaces/into_api_account.js";

export const apiSpacesPaths: Pick<
    ApiPaths,
    keyof ApiPaths & ("/auth" | `/spaces/${string}` | `/accounts/${string}`)
> = {
    "/auth": {
        get: async context => {
            const spaceId = context.actor.getSpaceId();
            const accountId = context.actor.getBotAccountId();

            const account = await getApiAccount(context, spaceId, accountId, {
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    auth: {
                        type: "BotAccount",
                        spaceId,
                        botAccount: {
                            ...account,
                            bot: assertExists(account.bot),
                        },
                    },
                },
            };
        },
    },

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
                // IMPORTANT: We don't include the `SpaceId` since we want to allow the flexibility
                // for this endpoint to be spaceless in the future. Since accounts aren't "owned"
                // by any one space. For now every bot actor is within a space but that may not be
                // the case forever.

                content: {
                    account: omitObject(account, ["space"]),
                },
            };
        },
    },

    "/accounts/{id}-reference": {
        get: async (context, {pathParameters}) => {
            // We load the account data using the `SpaceId` the bot is instantiated in. So if
            // an account was removed from the space then our bot will see old data.
            const spaceId = context.actor.getSpaceId();

            const account = await getAccountWithoutAvatar(context, spaceId, pathParameters.id, {
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    // IMPORTANT: We don't include the `SpaceId` since we want to allow the flexibility
                    // for this endpoint to be spaceless in the future. Since accounts aren't "owned"
                    // by any one space. For now every bot actor is within a space but that may not be
                    // the case forever.

                    reference: {
                        type: "Account",
                        id: pathParameters.id,
                        title: account.name,
                        shortName: getAccountShortNameWithoutFullNameTooltip(account),
                        bot: account.botId == null ? undefined : {id: account.botId},
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

    "/spaces/{id}/accounts": {
        get: async (context, {pathParameters}) => {
            const [space, accounts] = await runAllPromises([
                getSpace(context, pathParameters.id, {
                    consistency: "StrongWithinCache",
                }),
                expensivelyGetAllSpaceAccounts(context, pathParameters.id, {
                    consistency: "Strong",
                }),
            ]);

            return {
                content: {
                    space: {
                        id: pathParameters.id,
                        name: space.name,
                    },
                    accounts: accounts
                        .toSorted((account1, account2) => {
                            const getStateOrder = (
                                state: "Active" | "Removed" | "InvitePending",
                            ): number => {
                                switch (state) {
                                    case "Active":
                                        return 0;
                                    case "InvitePending":
                                        return 1;
                                    case "Removed":
                                        return 2;
                                    default:
                                        throw exhaustive(state);
                                }
                            };

                            return (
                                getStateOrder(account1.initialData.space.state.type) -
                                    getStateOrder(account2.initialData.space.state.type) ||
                                account1.initialData.space.addedTime.getTime() -
                                    account2.initialData.space.addedTime.getTime() ||
                                defaultCompareStrings(account1.id, account2.id)
                            );
                        })
                        .map(account => intoApiAccount(account.initialData)),
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

    // TODO(#public-api): Document that reads from this endpoint will always be
    // eventually consistent.
    "/spaces/{id}/accounts/{accountId}/inbox/entries": {
        get: async (context, {pathParameters, queryParameters}) => {
            const {id: spaceId, accountId} = pathParameters;
            const limit = Math.min(queryParameters.limit ?? 10, 100);

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

            const entries = await runAllPromises(
                entriesResult.items.map(async ({model}) => {
                    // Task and chat entries carry a title (and, for tasks, a status) that isn't on the
                    // inbox model, so we resolve the referenced entities from the search index. The
                    // resolver access-checks each entity for the request actor, matching how the entry
                    // models were hydrated.
                    const entityId = getInboxEntrySearchEntityIdIfExists(model);
                    const resolvedEntity = entityId
                        ? await inboxContext.searchInjection.getSearchMentionEntityIfPossible(
                              spaceId,
                              entityId,
                          )
                        : null;
                    return intoApiInboxEntry(model, resolvedEntity);
                }),
            );

            return {
                content: {
                    inbox: {
                        loudNotificationCount: inbox.model.loudNotificationCount,
                        newEntryCount: inbox.model.entryCount,
                    },
                    nextCursor,
                    entries,
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
                    results: results
                        .map(result => intoApiSearchResult(result, queryText))
                        .filter(isNonNullable)
                        .slice(0, limit),
                },
            };
        },
    },
};

/**
 * The search-index entity id for an inbox entry that references a title-bearing
 * entity not carried on the model (tasks and chats), or `undefined` for entries
 * that don't need resolution.
 */
function getInboxEntrySearchEntityIdIfExists(
    entry: InboxEntryModel,
): SearchMentionEntityId | undefined {
    switch (entry.type) {
        case "Task":
            return `Task:${entry.task.taskId}`;
        case "Chat":
            return `Chat:${entry.chatId}`;
        default:
            return undefined;
    }
}
