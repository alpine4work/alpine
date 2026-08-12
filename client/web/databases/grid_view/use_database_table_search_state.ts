import {useMemo, useState} from "react";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";
import {
    searchByAffinity,
    searchDatabaseTablesByKeywords,
} from "~/shared/rpc/search_rpc_definitions.js";
import {standardSearchOptions} from "~/shared/search/search_options.js";

export type DatabaseTableSearchResult = {
    readonly id: DatabaseTableId;
    readonly humanName: string;
};

const emptyDatabaseTableSearchResults: ReadonlyArray<DatabaseTableSearchResult> = [];
const databaseTableSearchResultLimit = 30;

/**
 * Search database tables and rank the results with keyword and affinity scores. An
 * empty query shows affinitive tables first and then tables in name order.
 */
export function useDatabaseTableSearchState(inputValue: string): {
    readonly isLoading: boolean;
    readonly rankedTables: ReadonlyArray<DatabaseTableSearchResult>;
} {
    const {space} = useSpaceContext();
    const trimmedInputValue = inputValue.trim();
    const [currentlyLoadingInputValue, setCurrentlyLoadingInputValue] = useState(trimmedInputValue);

    const affinitySearch = useLazyLoadRpc(searchByAffinity, {spaceId: space.id});
    const {isLoading: originalIsLoading, output: keywordSearchOutput} = useLazyLoadRpc(
        searchDatabaseTablesByKeywords,
        {
            spaceId: space.id,
            queryText: currentlyLoadingInputValue,
            // Load more fallback tables for the empty query before affinity re-ranks them.
            limit:
                currentlyLoadingInputValue.length === 0
                    ? databaseTableSearchResultLimit * 5
                    : databaseTableSearchResultLimit,
        },
        {keepPreviousData: true},
    );

    let isLoading = originalIsLoading;
    // Do not start a new RPC while the prior search is in progress. This prevents a
    // burst of concurrent requests while the account types.
    if (!isLoading && currentlyLoadingInputValue !== trimmedInputValue) {
        isLoading = true;
        setCurrentlyLoadingInputValue(trimmedInputValue);
    }

    const rankedTables = useMemo(() => {
        if (!keywordSearchOutput) return emptyDatabaseTableSearchResults;

        const affinityScoreByTableId = new Map<DatabaseTableId, number>();
        for (const result of [
            ...(affinitySearch.output?.favoriteResults ?? []),
            ...(affinitySearch.output?.results ?? []),
        ]) {
            if (!result.id.startsWith("DatabaseTable:")) continue;
            affinityScoreByTableId.set(
                result.id.slice("DatabaseTable:".length) as DatabaseTableId,
                result.score,
            );
        }

        const resultByTableId = new Map(
            keywordSearchOutput.results.map(result => [
                result.tableId,
                {
                    id: result.tableId,
                    humanName: result.humanName,
                    keywordScore: result.score,
                    affinityScore: affinityScoreByTableId.get(result.tableId),
                },
            ]),
        );

        const interpolation = standardSearchOptions.affinityToKeywordScoreInterpolation;
        const slope =
            (interpolation.point2.keywordScore - interpolation.point1.keywordScore) /
            (interpolation.point2.affinityScore - interpolation.point1.affinityScore);
        const intercept =
            interpolation.point2.keywordScore - slope * interpolation.point2.affinityScore;

        return Array.from(resultByTableId.values())
            .sort((table1, table2) => {
                if (keywordSearchOutput.input.queryText.length === 0) {
                    if (table1.affinityScore !== undefined && table2.affinityScore !== undefined) {
                        const scoreDifference = table2.affinityScore - table1.affinityScore;
                        if (scoreDifference !== 0) return scoreDifference;
                    } else if (table1.affinityScore !== undefined) {
                        return -1;
                    } else if (table2.affinityScore !== undefined) {
                        return 1;
                    }
                } else {
                    const score1 =
                        table1.keywordScore +
                        (table1.affinityScore === undefined
                            ? 0
                            : slope * table1.affinityScore + intercept);
                    const score2 =
                        table2.keywordScore +
                        (table2.affinityScore === undefined
                            ? 0
                            : slope * table2.affinityScore + intercept);
                    if (score1 !== score2) return score2 - score1;
                }

                return (
                    defaultCompareStrings(table1.humanName, table2.humanName) ||
                    defaultCompareStrings(table1.id, table2.id)
                );
            })
            .slice(0, databaseTableSearchResultLimit);
    }, [affinitySearch.output, keywordSearchOutput]);

    return {
        isLoading:
            isLoading ||
            (keywordSearchOutput?.input.queryText.length === 0 && affinitySearch.isLoading),
        rankedTables,
    };
}
