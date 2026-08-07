import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {Store} from "~/shared/store/store.js";

/**
 * Types of global loading indicators we can show.
 */
export type GlobalLoadingIndicator =
    | {
          readonly type: "Loading";
      }
    | {
          readonly type: "Saving";
      }
    | {
          readonly type: "Pasting";
      }
    | {
          readonly type: "Uploading";
          readonly weight?: number;
          readonly progressStore?: Store<number>;
      };

/**
 * We can only show one global loading indicator at a time. So pick the most
 * relevant global loading indicator of the two. Or produce a merged global loading
 * indicator the represents both.
 */
export function mergeGlobalLoadingIndicators(
    indicator1: GlobalLoadingIndicator,
    indicator2: GlobalLoadingIndicator,
): GlobalLoadingIndicator {
    if (indicator1.type === "Uploading" && indicator2.type === "Uploading") {
        const weight1 = indicator1.weight ?? 1;
        const weight2 = indicator2.weight ?? 1;

        return {
            type: "Uploading",
            weight: weight1 + weight2,
            progressStore:
                indicator1.progressStore && indicator2.progressStore
                    ? Store.map(
                          indicator1.progressStore,
                          indicator2.progressStore,
                          (progress1, progress2) =>
                              (progress1 * weight1 + progress2 * weight2) / (weight1 + weight2),
                      )
                    : (indicator1.progressStore ?? indicator2.progressStore),
        };
    }

    if (indicator1.type === "Uploading") return indicator1;
    if (indicator2.type === "Uploading") return indicator2;

    if (indicator1.type === "Pasting") return indicator1;
    if (indicator2.type === "Pasting") return indicator2;

    if (indicator1.type === "Saving") return indicator1;
    if (indicator2.type === "Saving") return indicator2;

    if (indicator1.type === "Loading") return indicator1;
    if (indicator2.type === "Loading") return indicator2;

    throw new AggregateError([exhaustive(indicator1), exhaustive(indicator2)]);
}

export function mergeManyGlobalLoadingIndicators(
    indicators: Iterable<GlobalLoadingIndicator>,
): GlobalLoadingIndicator | null {
    let mergedIndicator: GlobalLoadingIndicator | null = null;

    for (const indicator of indicators) {
        if (mergedIndicator === null) {
            mergedIndicator = indicator;
        } else {
            mergedIndicator = mergeGlobalLoadingIndicators(mergedIndicator, indicator);
        }
    }

    return mergedIndicator;
}
