/* eslint-disable react-refresh/only-export-components */

import {SpinnerGap} from "phosphor-react";
import {ReactElement, ReactNode, useCallback, useEffect, useMemo, useState} from "react";
import {Box} from "~/client/design/box.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {useStore} from "~/client/helpers/use_store.js";
import {spinAnimationClassName} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
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

            void promise
                .catch(() => {
                    // Don't log an unhandled promise rejection warning for this promise. Unhandled
                    // promise rejections should be handled before passing the promise into
                    // `onLoadingIndicator`.
                })
                .finally(() => {
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

                                  // We never want to show 100%. The most we'll show is 99%. 100%
                                  // means done.
                                  return Math.round(progress * 99);
                              },
                          )
                        : null
                }
            />
        );
    }, [state.loadingIndicators, state.progressStores]);

    const hasLoadingIndicator = loadingIndicatorWithoutSaving !== null;
    const shouldShowLoadingIndicator = useDelayLoadingIndicator(hasLoadingIndicator);

    const shouldShowSavingIndicator = useDelayLoadingIndicator(isSaving);

    const loadingIndicator = useMemo((): ReactElement | null => {
        if (shouldShowLoadingIndicator) return loadingIndicatorWithoutSaving;
        if (!shouldShowSavingIndicator) return null;
        return <ContentEditorLoadingIndicator summary="Saving" progressStore={null} />;
    }, [loadingIndicatorWithoutSaving, shouldShowLoadingIndicator, shouldShowSavingIndicator]);

    // Warn the user if they try to leave Alpine while there are still some changes
    // to their document which are saving.
    useEffect(() => {
        if (!isSaving && !hasLoadingIndicator) return;

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            const confirmationMessage = "Changes you made may not be saved.";
            event.returnValue = confirmationMessage;
            return confirmationMessage;
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
        };
    }, [hasLoadingIndicator, isSaving]);

    return {
        loadingIndicator,
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
