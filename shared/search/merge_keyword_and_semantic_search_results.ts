import {OpensearchSearchHitExplanation} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {SearchEntityResultModel} from "~/shared/search/search_entity_result_model.js";
import {SearchOptions} from "~/shared/search/search_options.js";

export function mergeKeywordAndSemanticSearchResults({
    keywordSearchResults,
    semanticSearchResults,
    options,
    shouldDebug,
}: {
    keywordSearchResults: ReadonlyArray<SearchEntityResultModel>;
    semanticSearchResults: ReadonlyArray<SearchEntityResultModel>;
    options: SearchOptions;
    shouldDebug?: boolean;
}) {
    const interpolation = options.semanticToKeywordScoreInterpolation;

    const slope =
        (interpolation.point2.keywordScore - interpolation.point1.keywordScore) /
        (interpolation.point2.semanticScore - interpolation.point1.semanticScore);

    const intercept =
        interpolation.point2.keywordScore - slope * interpolation.point2.semanticScore;

    const semanticResultByEntityId = new Map(
        semanticSearchResults.map(result => [result.id, result]),
    );

    const newResults: Array<SearchEntityResultModel> = [];

    let maxKeywordScore = -Infinity;
    let minKeywordScore = Infinity;

    for (const keywordResult of keywordSearchResults) {
        maxKeywordScore = Math.max(maxKeywordScore, keywordResult.score);
        minKeywordScore = Math.min(minKeywordScore, keywordResult.score);

        const semanticResult = semanticResultByEntityId.get(keywordResult.id);
        if (!semanticResult) {
            newResults.push(keywordResult);
            continue;
        }

        semanticResultByEntityId.delete(keywordResult.id);

        const additionalScore = slope * semanticResult.score + intercept;
        const actualKeywordScore = Math.max(
            options.minKeywordScoreForSemanticResult,
            keywordResult.score,
        );
        const actualScore = actualKeywordScore + additionalScore;

        newResults.push({
            // If we have both a keyword result and a semantic result, then prefer the
            // keyword result if there was a good keyword match. Otherwise prefer the
            // semantic result.
            ...(keywordResult.score < options.minKeywordScoreForSemanticResult
                ? semanticResult
                : keywordResult),
            score: actualScore,
            explanation:
                shouldDebug && keywordResult.explanation
                    ? {
                          value: actualScore,
                          description: "sum of:",
                          details: [
                              {
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
                              },
                              {
                                  value: actualKeywordScore,
                                  description: "max of:",
                                  details: [
                                      {
                                          value: options.minKeywordScoreForSemanticResult,
                                          description: "min keyword score for semantic result",
                                          details: [],
                                      },
                                      keywordResult.explanation,
                                  ],
                              },
                          ],
                      }
                    : undefined,
        });
    }

    for (const semanticResult of semanticResultByEntityId.values()) {
        const actualScore = slope * semanticResult.score + intercept;

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

        newResults.push({
            ...semanticResult,
            score: actualScore + options.minKeywordScoreForSemanticResult,
            explanation: shouldDebug
                ? {
                      value: actualScore + options.minKeywordScoreForSemanticResult,
                      description: "sum of:",
                      details: [
                          actualScoreExplanation,
                          {
                              value: options.minKeywordScoreForSemanticResult,
                              description: "min keyword score for semantic result",
                              details: [],
                          },
                      ],
                  }
                : undefined,
        });
    }

    // Re-sort results based on their new, merged, scores.
    newResults.sort((result1, result2) => result2.score - result1.score);

    return newResults;
}
