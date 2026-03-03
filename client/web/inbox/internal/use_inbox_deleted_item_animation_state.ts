import {RefObject, useEffect, useMemo, useState} from "react";
import {inboxEntryDeleteAnimationDurationMs} from "~/client/web/inbox/inbox_entry_view.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {inboxEntryViewMinHeight} from "~/client/web/styles/inbox_shared_styles.js";
import {VirtualizedScrollViewRef} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {createInterval} from "~/shared/helpers/async/interval.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";

export function useInboxDeletedItemAnimationState({
    viewRef,
    itemCount,
    itemsDeletedByLastChangeForAnimation,
}: {
    viewRef: RefObject<VirtualizedScrollViewRef | null>;
    itemCount: number;
    itemsDeletedByLastChangeForAnimation: ReadonlyArray<{
        index: number;
        cursor: DynamoIndexCursor;
        item: DynamoGeneralRealtimeItem<InboxEntryModel>;
    }>;
}) {
    const spacingScale = useSpacingScale();

    const [deletedItemAnimationsState, setDeletedItemAnimationsState] = useState<{
        readonly activeAnimations: {
            readonly currentAnimation: {
                readonly offset: number;
                readonly deletedItem: {
                    readonly index: number;
                    readonly cursor: DynamoIndexCursor;
                    readonly item: DynamoGeneralRealtimeItem<InboxEntryModel>;
                };
            };
            readonly queuedAnimations: ReadonlyArray<{
                readonly offset: number;
                readonly deletedItem: {
                    readonly index: number;
                    readonly cursor: DynamoIndexCursor;
                    readonly item: DynamoGeneralRealtimeItem<InboxEntryModel>;
                };
            }>;
        } | null;
        readonly finishedAnimations: ReadonlySet<{
            readonly index: number;
            readonly cursor: DynamoIndexCursor;
            readonly item: DynamoGeneralRealtimeItem<InboxEntryModel>;
        }>;
    }>({
        activeAnimations: null,
        finishedAnimations: new Set(),
    });

    // When an item is deleted, we start an animation to shift entries below the
    // deleted item up to fill its space. This helps users see an item was removed and
    // what happens next.
    {
        const deletedItem = itemsDeletedByLastChangeForAnimation[0];
        if (
            deletedItem &&
            // If the last item is deleted, don't animate. There are no items which will cover
            // it.
            deletedItem.index < itemCount &&
            !deletedItemAnimationsState.finishedAnimations.has(deletedItem)
        ) {
            // We should still have the height of the deleted item in
            // `VirtualizedScrollViewRef` since the render hasn't finished and unmounted the
            // element yet.
            let offset = viewRef.current?.getPositionByKeyIfExists(
                `Loaded:${deletedItem.item.key}`,
            )?.height;

            // If we are deleting the first item, don't animate into the top padding.
            if (typeof offset === "number" && deletedItem.index === 0) {
                offset -= convertRemLengthToPx("1", spacingScale);
            }

            offset ??= convertRemLengthToPx(inboxEntryViewMinHeight, spacingScale);

            if (!deletedItemAnimationsState.activeAnimations) {
                setDeletedItemAnimationsState({
                    activeAnimations: {
                        currentAnimation: {
                            offset,
                            deletedItem,
                        },
                        queuedAnimations: [],
                    },
                    finishedAnimations: deletedItemAnimationsState.finishedAnimations,
                });
            } else if (
                deletedItemAnimationsState.activeAnimations.currentAnimation.deletedItem !==
                    deletedItem &&
                deletedItemAnimationsState.activeAnimations.queuedAnimations.every(
                    animation => animation.deletedItem !== deletedItem,
                )
            ) {
                setDeletedItemAnimationsState({
                    activeAnimations: {
                        currentAnimation:
                            deletedItemAnimationsState.activeAnimations.currentAnimation,
                        queuedAnimations: [
                            ...deletedItemAnimationsState.activeAnimations.queuedAnimations,
                            {
                                offset,
                                deletedItem,
                            },
                        ],
                    },
                    finishedAnimations: deletedItemAnimationsState.finishedAnimations,
                });
            }
        }
    }

    const hasDeletedActiveAnimationsState = !!deletedItemAnimationsState.activeAnimations;

    useEffect(() => {
        // Important to use a boolean here so we don't subscribe to all
        // `deletedItemAnimationsState` changes.
        if (!hasDeletedActiveAnimationsState) return;

        // Keep popping animations from the stack until `deletedItemAnimationsState` is
        // null which will re-run the effect and clear the interval.
        const interval = createInterval(() => {
            setDeletedItemAnimationsState(animationState => {
                if (!animationState.activeAnimations) return animationState;

                const newFinishedAnimations = new Set(animationState.finishedAnimations);
                newFinishedAnimations.add(
                    animationState.activeAnimations.currentAnimation.deletedItem,
                );

                const [currentAnimation, ...queuedAnimations] =
                    animationState.activeAnimations.queuedAnimations;
                if (!currentAnimation) {
                    return {
                        activeAnimations: null,
                        finishedAnimations: newFinishedAnimations,
                    };
                }

                return {
                    activeAnimations: {
                        currentAnimation,
                        queuedAnimations,
                    },
                    finishedAnimations: newFinishedAnimations,
                };
            });
        }, inboxEntryDeleteAnimationDurationMs);

        return () => interval.clear();
    }, [hasDeletedActiveAnimationsState]);

    // Collect all items that we need to animate deletion of into a sorted array. We
    // will interleave this array in our virtualized list.
    const deletedItemAnimations = useMemo(() => {
        if (!deletedItemAnimationsState.activeAnimations) return [];

        const deletedItemAnimations = [];

        for (const animation of [
            deletedItemAnimationsState.activeAnimations.currentAnimation,
            ...deletedItemAnimationsState.activeAnimations.queuedAnimations,
        ]) {
            if (animation.deletedItem.index < itemCount + 1) {
                deletedItemAnimations.push(animation);
            }
        }

        // Sort animations by the index they are replacing.
        deletedItemAnimations.sort((a, b) => a.deletedItem.index - b.deletedItem.index);

        return deletedItemAnimations;
    }, [deletedItemAnimationsState, itemCount]);

    return {deletedItemAnimationsState, deletedItemAnimations};
}
