import {Memo, RefObject, useRef, useState} from "react";
import {jumpAnimationDurationMs} from "~/client/content/content_view.js";
import {scheduleAfterNavigationAnimation} from "~/client/design/schedule_after_navigation_animation.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";

export type JumpToMessageState<RoomKey extends string> = {
    readonly key: symbol;
    readonly options: JumpToMessageRangeOptions<RoomKey>;
    readonly messages: ReadonlyArray<JumpMessageState>;
};

export type JumpMessageState = {
    readonly start: {readonly version: number; readonly pos: number} | null;
    readonly end: {readonly version: number; readonly pos: number} | null;
    readonly animation: {readonly startTime: Date} | null;
    readonly scheduleAnimation: () => void;
};

export type JumpToMessageRangeOptions<RoomKey extends string> = {
    readonly roomKey: RoomKey;
    readonly startIndex: number;
    readonly endIndex: number;
    readonly start: {readonly version: number; readonly pos: number} | null;
    readonly end: {readonly version: number; readonly pos: number} | null;
};

export function useJumpToMessageRange<RoomKey extends string>({
    viewRef,
    tryLoadingMoreData,
    scrollToIndexForMessageIndex,
}: {
    viewRef: RefObject<VirtualizedScrollViewRef>;
    tryLoadingMoreData: (
        renderedRange: {startIndex: number; endIndex: number} | null,
    ) => {isLoading: false} | {isLoading: true; promise: Promise<void>};
    scrollToIndexForMessageIndex: (roomKey: RoomKey, messageIndex: number) => number | null;
}): {
    jumpState: JumpToMessageState<RoomKey> | null;
    jumpToMessageRange: Memo<(options: JumpToMessageRangeOptions<RoomKey>) => void>;
} {
    // State regarding the jump we're performing. Including scheduling for the jump
    // animation. A jump happens when:
    //
    // 1. A user clicks on a message reply to jump to it
    // 2. A user loads a page with a message index in the URL we need to jump to
    const [jumpState, setJumpState] = useState<JumpToMessageState<RoomKey> | null>(null);

    const isJumpingToMessageRangeRef = useRef(false);

    // Jumping to a message entails:
    //
    // 1. We scroll to the message
    // 2. We highlight the message to the user
    const jumpToMessageRange = useEvent((options: JumpToMessageRangeOptions<RoomKey>) => {
        // If we are in the process of jumping, don't start another jump
        if (isJumpingToMessageRangeRef.current) return;

        // If we're already jumping to the same range, don't start another jump
        if (isDeepEqual(jumpState?.options, options)) return;

        const view = assertExists(viewRef.current);

        const scrollToIndex = scrollToIndexForMessageIndex(options.roomKey, options.startIndex);
        if (scrollToIndex === null) return;

        const peekRenderedRange = view.peekRenderedRangeAfterScrollToIndex(scrollToIndex);
        const result = tryLoadingMoreData(peekRenderedRange);

        const jumpStateKey = Symbol();

        let isAnimationScheduled = false;

        const scheduleAnimation = () => {
            if (isAnimationScheduled) return;
            isAnimationScheduled = true;

            scheduleAfterNavigationAnimation(() => {
                // Wait a bit before highlighting in case the message component is immediately
                // unmounted. This will happen if while measuring content the virtualized
                // scroll view thinks this is offscreen before our scroll anchoring puts it
                // back in place. Arguably this is a bug in the virtualized scroll view.
                createTimeout(() => {
                    const startTime = new Date();

                    setJumpState(jumpState => {
                        if (jumpState?.key !== jumpStateKey) return jumpState;

                        return {
                            ...jumpState,
                            messages: jumpState.messages.map(message => ({
                                ...message,
                                animation: {startTime},
                            })),
                        };
                    });

                    // Clear `jumpState` after the animation finishes.
                    createTimeout(() => {
                        setJumpState(jumpState => {
                            if (jumpState?.key !== jumpStateKey) return jumpState;
                            return null;
                        });
                    }, jumpAnimationDurationMs);
                }, 100);
            });
        };

        const initialJumpState: JumpToMessageState<RoomKey> = {
            key: jumpStateKey,
            options,
            messages: createArrayWithLength(
                options.endIndex - options.startIndex + 1,
                (index): JumpMessageState => ({
                    start: index + options.startIndex === options.startIndex ? options.start : null,
                    end: index + options.startIndex === options.endIndex ? options.end : null,
                    animation: null,
                    scheduleAnimation,
                }),
            ),
        };

        if (!result.isLoading) {
            view.scrollToIndex(scrollToIndex, {withAnchor: true});

            setJumpState(initialJumpState);
        } else {
            isJumpingToMessageRangeRef.current = true;

            void Promise.race([result.promise, wait(delayLoadingIndicatorLimitMs)]).finally(() => {
                isJumpingToMessageRangeRef.current = false;

                view.scrollToIndex(scrollToIndex, {withAnchor: true});

                setJumpState(initialJumpState);
            });
        }
    });

    return {
        jumpState,
        jumpToMessageRange,
    };
}
