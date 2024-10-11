import {SpinnerGap} from "phosphor-react";
import {ReactElement, ReactNode, useCallback, useMemo, useState} from "react";
import {Box} from "~/client/design/box.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {useStore} from "~/client/helpers/use_store.js";
import {spinAnimationClassName} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Id, generateId} from "~/shared/id/id.js";
import {Store} from "~/shared/store/store.js";

export type ContentEditorLoadingIndicatorSummary = "Saving" | "Pasting" | "Uploading";

function getContentEditorLoadingIndicatorSummaryPriority(
    summary: ContentEditorLoadingIndicatorSummary,
) {
    switch (summary) {
        case "Saving":
            return 1;
        case "Pasting":
            return 2;
        case "Uploading":
            return 3;
        default:
            throw exhaustive(summary);
    }
}

/**
 * Manages state for the loading indicator UI that should be rendered alongside
 * `<ContentEditor>`. `<ContentEditor>` doesn't render a loading indicator
 * itself, instead the loading indicator should be rendered somewhere alongside
 * `<ContentEditor>`.
 */
export function useContentEditorLoadingIndicator(isSaving: boolean): {
    loadingIndicator: ReactNode;
    onLoadingIndicator: (
        summary: ContentEditorLoadingIndicatorSummary,
        promise: Promise<void>,
        progressStore: Store<number> | null,
    ) => void;
} {
    const [state, setState] = useState<{
        readonly loadingIndicators: ReadonlyArray<{
            readonly id: Id;
            readonly summary: ContentEditorLoadingIndicatorSummary;
            readonly promise: Promise<void>;
        }>;
        readonly progressStores: ReadonlyArray<{
            readonly id: Id;
            readonly store: Store<number>;
            readonly isPromiseResolved: boolean;
        }>;
    }>({
        loadingIndicators: emptyArray,
        progressStores: emptyArray,
    });

    const onLoadingIndicator = useCallback(
        (
            summary: ContentEditorLoadingIndicatorSummary,
            promise: Promise<void>,
            progressStore: Store<number> | null,
        ) => {
            const id = generateId();

            setState(state => ({
                loadingIndicators: [...state.loadingIndicators, {id, summary, promise}],
                progressStores: progressStore
                    ? [
                          ...state.progressStores,
                          {id, store: progressStore, isPromiseResolved: false},
                      ]
                    : state.progressStores,
            }));

            void promise.finally(() => {
                setState(state => {
                    const loadingIndicators = state.loadingIndicators.filter(
                        loadingIndicator => loadingIndicator.id !== id,
                    );

                    const progressStores = state.progressStores.map(progressStore =>
                        progressStore.id === id
                            ? {...progressStore, isPromiseResolved: true}
                            : progressStore,
                    );

                    return {
                        loadingIndicators,
                        // Clear the `progressStores` array once all promises associated with the
                        // progress stores resolve. This way if we're reporting progress it won't
                        // "jump back" from 56% to 11% because one of two progress stores completed.
                        progressStores: !progressStores.every(
                            progressStore => progressStore.isPromiseResolved,
                        )
                            ? progressStores
                            : emptyArray,
                    };
                });
            });
        },
        [],
    );

    const loadingIndicatorWithoutSaving = useMemo((): ReactElement | null => {
        let summary: ContentEditorLoadingIndicatorSummary | null = null;

        for (const loadingIndicator of state.loadingIndicators) {
            if (summary === null) {
                summary = loadingIndicator.summary;
            } else if (
                getContentEditorLoadingIndicatorSummaryPriority(summary) <
                getContentEditorLoadingIndicatorSummaryPriority(loadingIndicator.summary)
            ) {
                summary = loadingIndicator.summary;
            }
        }

        if (summary === null) return null;

        return (
            <ContentEditorLoadingIndicator
                summary={summary}
                progressStore={
                    state.progressStores.length > 0
                        ? Store.mapMany(
                              state.progressStores.map(({store}) => store),
                              progresses => {
                                  let totalProgress = 0;
                                  for (const progress of progresses) totalProgress += progress;
                                  const progress = totalProgress / progresses.length;
                                  return Math.round(progress * 100);
                              },
                          )
                        : null
                }
            />
        );
    }, [state.loadingIndicators, state.progressStores]);

    const loadingIndicator = useMemo((): ReactElement | null => {
        if (loadingIndicatorWithoutSaving) return loadingIndicatorWithoutSaving;
        if (!isSaving) return null;
        return <ContentEditorLoadingIndicator summary="Saving" progressStore={null} />;
    }, [isSaving, loadingIndicatorWithoutSaving]);

    const isLoading = loadingIndicator !== null;
    const shouldShowLoadingIndicator = useDelayLoadingIndicator(isLoading);

    return {
        loadingIndicator: shouldShowLoadingIndicator ? loadingIndicator : null,
        onLoadingIndicator,
    };
}

function ContentEditorLoadingIndicator({
    summary,
    progressStore,
}: {
    summary: ContentEditorLoadingIndicatorSummary;
    progressStore: Store<number> | null;
}) {
    const progress = useStore(progressStore);

    return (
        <Box
            display="flex"
            alignItems="center"
            gap="1"
            color="grey-30"
            fontSize="75"
            style={{fontVariantNumeric: "tabular-nums"}}
        >
            <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
            {summary}
            {progress !== null ? ` (${progress}%)` : null}
        </Box>
    );
}
