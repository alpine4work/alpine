import {AppContext} from "~/client/context/app_context.js";
import {ConstStore} from "~/client/helpers/store/const_store.js";
import {createPromiseStore} from "~/client/helpers/store/promise_store.js";
import {Store} from "~/client/helpers/store/store.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    OpensearchSearchHitExplanation,
    addSumOperandToOpensearchSearchHitExplanation,
} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {searchByKeywords, searchBySemantics} from "~/shared/rpc/search_rpc_definitions.js";
import {SearchOptions, standardSearchOptions} from "~/shared/search/search_options.js";
import {SearchResult} from "~/shared/search/search_result.js";

/**
 * The maximum number of semantic search results we look for. These search
 * results are mixed with our keyword search results. Semantic search results
 * can be expensive to compute so we don't load too many.
 *
 * Picked 14 since it's two times 7 which is a lucky number. Working with
 * leading AI models requires a bit of superstition.
 *
 * When paginating, we only load more keyword search results. Not new semantic
 * search results.
 */
const semanticSearchResultLimit = 14;

export type ExecuteSearchOutput =
    | {
          readonly isPending: true;
          readonly isError: false;
          readonly results: null;
      }
    | {
          readonly isPending: boolean;
          readonly isError: true;
          readonly error: unknown;
          readonly results: null;
      }
    | {
          readonly isPending: boolean;
          readonly isError: false;
          readonly results: ReadonlyArray<SearchResult>;
      };

/**
 * Constant pending output `executeSearch()` returns while it's loading.
 */
export const pendingExecuteSearchOutput: ExecuteSearchOutput = {
    isPending: true,
    isError: false,
    results: null,
};

/**
 * Constant output `executeSearch()` returns when it receives an empty
 * search query.
 */
export const emptyExecuteSearchOutput: ExecuteSearchOutput = {
    isPending: false,
    isError: false,
    results: [],
};

/**
 * Execute a search request. Instead of returning a `Promise` we return a
 * `Store` since our search output may change a few times before it stabilizes.
 *
 * Returning `null` for `results` means we've loaded no search results yet. We
 * may return `isPending: true` when `results` is non-null. This means we've
 * received the search execution base but may still be waiting to mix in other
 * search results.
 *
 * A search request is made of two RPC calls: `searchByKeywords()` and
 * `searchBySemantics()`. Our RPC client will end up batching these requests
 * but they're returned separately. `searchByKeywords()` forms the base of our
 * search results. Then semantic search results from `searchBySemantics()` are
 * mixed in on top. We expect semantic search to take longer than keyword
 * search since we both need to embed the query then search in vector space. So
 * we present keyword search results to the user as soon as we have them then
 * mix in semantic search results once we get them.
 */
export function executeSearch(
    context: AppContext,
    {
        spaceId,
        queryText,
        limit,
        debugOptions,
    }: {
        spaceId: SpaceId;
        queryText: string;
        limit: number;
        debugOptions: SearchOptions | null;
    },
): Store<ExecuteSearchOutput> {
    // If the query is empty then return no search results.
    if (queryText.length === 0) return new ConstStore(emptyExecuteSearchOutput);

    const options = debugOptions ?? standardSearchOptions;

    const keywordSearchPromise = searchByKeywords(context, {
        spaceId,
        queryText,
        // NOCOMMIT: What to do about limit here and infinite loading. Kinda weird that
        // semantic search results are placed in the top `limit` keyword results but
        // `limit` is determined by view size.
        limit,
        debugOptions: debugOptions ?? undefined,
    });

    const semanticSearchPromise = searchBySemantics(context, {
        spaceId,
        queryText,
        limit: semanticSearchResultLimit,
    });

    const keywordSearchStore = createPromiseStore(keywordSearchPromise);
    const semanticSearchStore = createPromiseStore(semanticSearchPromise);

    return Store.map(
        keywordSearchStore,
        semanticSearchStore,
        (keywordSearchState, semanticSearchState): ExecuteSearchOutput => {
            if (keywordSearchState.status === "pending") return pendingExecuteSearchOutput;

            if (keywordSearchState.status === "rejected") {
                return {
                    isPending: false,
                    isError: true,
                    error: keywordSearchState.reason,
                    results: null,
                };
            }

            if (semanticSearchState.status === "rejected") {
                return {
                    isPending: false,
                    isError: true,
                    error: semanticSearchState.reason,
                    results: null,
                };
            }

            if (semanticSearchState.status === "pending") {
                return {
                    isPending: true,
                    isError: false,
                    results: keywordSearchState.value.results,
                };
            }

            // Now that we have both keyword search results and semantic search results,
            // let's merge them together...

            const interpolation = options.semanticToKeywordScoreInterpolation;

            const slope =
                (interpolation.point2.keywordScore - interpolation.point1.keywordScore) /
                (interpolation.point2.semanticScore - interpolation.point1.semanticScore);

            const intercept =
                interpolation.point2.keywordScore - slope * interpolation.point2.semanticScore;

            const semanticResultByEntityId = new Map(
                semanticSearchState.value.results.map(result => [result.entityId, result]),
            );

            const newResults: Array<SearchResult> = [];

            let withExplanation = true;
            let maxKeywordScore = -Infinity;
            let minKeywordScore = Infinity;

            for (const keywordResult of keywordSearchState.value.results) {
                withExplanation &&= !!keywordResult.explanation;
                maxKeywordScore = Math.max(maxKeywordScore, keywordResult.score);
                minKeywordScore = Math.min(minKeywordScore, keywordResult.score);

                const semanticResult = semanticResultByEntityId.get(keywordResult.entityId);
                if (!semanticResult) {
                    newResults.push(keywordResult);
                    continue;
                }

                semanticResultByEntityId.delete(keywordResult.entityId);

                const additionalScore = slope * semanticResult.score + intercept;

                // If we have both a keyword result and a semantic result, then we want to use
                // the title and body snippet from the keyword result.
                newResults.push({
                    ...keywordResult,
                    score: keywordResult.score + additionalScore,
                    explanation: keywordResult.explanation
                        ? addSumOperandToOpensearchSearchHitExplanation(keywordResult.explanation, {
                              value: additionalScore,
                              description: `✨ interpolated semantic score, computed as (m * x) + b from:`,
                              details: [
                                  {
                                      value: semanticResult.score,
                                      description: "x, semantic score",
                                      details: [],
                                  },
                                  {
                                      value: slope,
                                      description: "m, slope",
                                      details: [],
                                  },
                                  {
                                      value: intercept,
                                      description: "b, intercept",
                                      details: [],
                                  },
                              ],
                          })
                        : undefined,
                });
            }

            const remainingSemanticResults = Array.from(semanticResultByEntityId.values());
            remainingSemanticResults.sort((result1, result2) => result2.score - result1.score);

            for (let i = 0; i < remainingSemanticResults.length; i++) {
                const semanticResult = remainingSemanticResults[i]!;
                const actualScore = slope * semanticResult.score + intercept;
                const rank = i + 1;

                const actualScoreExplanation: OpensearchSearchHitExplanation = {
                    value: actualScore,
                    description: `✨ interpolated semantic score, computed as (m * x) + b from:`,
                    details: [
                        {
                            value: semanticResult.score,
                            description: "x, semantic score",
                            details: [],
                        },
                        {
                            value: slope,
                            description: "m, slope",
                            details: [],
                        },
                        {
                            value: intercept,
                            description: "b, intercept",
                            details: [],
                        },
                    ],
                };

                // If we found all possible keyword search results then we know for sure we
                // wouldn't find semantic results if we kept searching.
                if (keywordSearchState.value.results.length < limit) {
                    newResults.push({
                        ...semanticResult,
                        score: actualScore,
                        explanation: withExplanation ? actualScoreExplanation : undefined,
                    });
                }

                // If there was no keyword search result for the semantic search result we
                // assume that if we kept paginating through keyword search results we'd
                // eventually find a match. That way semantic search results with no keyword
                // result match can be competitive with other keyword results.
                //
                // To do this, we assume the remaining semantic results have keyword results in
                // the same order as the remaining semantic results right after they keyword
                // results we do have. Then we extrapolate scores for these keyword results and
                // add them to the semantic results.
                //
                // Of course, all these assumptions probably don't hold most of the time.
                // However, subjectively we get correct looking results. Often semantic results
                // would have a keyword match if we had a high enough `limit`. They keyword
                // result's score would be less than the minimum score of keyword results we
                // do have.
                const extrapolatedKeywordScore =
                    minKeywordScore -
                    rank *
                        ((maxKeywordScore - minKeywordScore) /
                            keywordSearchState.value.results.length);

                // Make sure when adding semantic results we interpolate their scores into the
                // keyword score range. Otherwise good scores like 0.9 would always be last.
                newResults.push({
                    ...semanticResult,
                    score: actualScore + extrapolatedKeywordScore,
                    explanation: withExplanation
                        ? {
                              value: actualScore + extrapolatedKeywordScore,
                              description: "sum of:",
                              details: [
                                  actualScoreExplanation,
                                  {
                                      value: extrapolatedKeywordScore,
                                      description:
                                          "extrapolated keyword score, computed as a - (r * (b - a) / l) from:",
                                      details: [
                                          {
                                              value: rank,
                                              description: "r, extrapolated keyword search rank",
                                              details: [],
                                          },
                                          {
                                              value: minKeywordScore,
                                              description: "a, minimum keyword result score",
                                              details: [],
                                          },
                                          {
                                              value: maxKeywordScore,
                                              description: "b, maximum keyword result score",
                                              details: [],
                                          },
                                          {
                                              value: keywordSearchState.value.results.length,
                                              description: "l, keyword result count",
                                              details: [],
                                          },
                                      ],
                                  },
                              ],
                          }
                        : undefined,
                });
            }

            // Re-sort results based on their new, merged, scores.
            newResults.sort((result1, result2) => result2.score - result1.score);

            return {
                isPending: false,
                isError: false,
                results: newResults,
            };
        },
    );
}
