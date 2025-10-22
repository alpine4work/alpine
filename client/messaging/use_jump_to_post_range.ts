import {Memo, RefObject, useRef, useState} from "react";
import {jumpAnimationDurationMs} from "~/client/content/content_view.js";
import {scheduleAfterNavigationAnimation} from "~/client/design/schedule_after_navigation_animation.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {PostId} from "~/shared/id/types/id_types.js";

export type JumpToPostRangeState = {
    readonly key: symbol;
    readonly options: JumpToPostRangeOptions;
    readonly animation: {readonly startTime: Date} | null;
    readonly scheduleAnimation: () => void;
};

export type JumpToPostRangeOptions = {
    readonly postId: PostId;
    readonly contentVersion: number;
    readonly startPos: number;
    readonly endPos: number;
};

// NOTE(calebmer): This function was forked from `useJumpToMessageRange()`. Any
// changes to this function maybe should be made to
// `useJumpToMessageRange()` too.
export function useJumpToPostRange({
    viewRef,
    scrollToIndexForPost,
}: {
    viewRef: RefObject<VirtualizedScrollViewRef>;
    scrollToIndexForPost: (postId: PostId) => number | null;
}): {
    jumpState: JumpToPostRangeState | null;
    jumpToPostRange: Memo<(options: JumpToPostRangeOptions) => void>;
} {
    const [jumpState, setJumpState] = useState<JumpToPostRangeState | null>(null);

    const isJumpingToPostRangeRef = useRef(false);

    // Jumping to a post entails:
    //
    // 1. We scroll to the post
    // 2. We highlight the post to the user
    const jumpToPostRange = useEvent((options: JumpToPostRangeOptions) => {
        // If we are in the process of jumping, don't start another jump
        if (isJumpingToPostRangeRef.current) return;

        // If we're already jumping to the same range, don't start another jump
        if (isDeepEqual(jumpState?.options, options)) return;

        const view = assertExists(viewRef.current);

        const scrollToIndex = scrollToIndexForPost(options.postId);
        if (scrollToIndex === null) return;

        const jumpStateKey = Symbol();

        let isAnimationScheduled = false;

        const scheduleAnimation = () => {
            if (isAnimationScheduled) return;
            isAnimationScheduled = true;

            scheduleAfterNavigationAnimation(() => {
                // Wait a bit before highlighting in case the post component is immediately
                // unmounted. This will happen if while measuring content the virtualized
                // scroll view thinks this is offscreen before our scroll anchoring puts it
                // back in place. Arguably this is a bug in the virtualized scroll view.
                createTimeout(() => {
                    const startTime = new Date();

                    setJumpState(jumpState => {
                        if (jumpState?.key !== jumpStateKey) return jumpState;

                        return {
                            ...jumpState,
                            animation: {startTime},
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

        view.scrollToIndex(scrollToIndex, {withAnchor: true});

        setJumpState({
            key: jumpStateKey,
            options,
            animation: null,
            scheduleAnimation,
        });
    });

    return {
        jumpState,
        jumpToPostRange,
    };
}
