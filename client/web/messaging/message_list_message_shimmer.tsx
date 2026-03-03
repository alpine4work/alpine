import {useRef} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {MessageList} from "~/client/web/messaging/message_list.js";
import {MessageShimmer} from "~/client/web/shimmer/message_shimmer.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {MessageModel, MessageModelBase} from "~/shared/messaging/message_model.js";

// We repeat sizes to make them appear more frequently when randomly selecting a
// size.
const messageShimmerSizes: Array<{
    width: Spacing;
    heightLines: number;
}> = [
    // 4x frequency
    {width: "32", heightLines: 1},
    {width: "32", heightLines: 1},
    {width: "32", heightLines: 1},
    {width: "32", heightLines: 1},
    // 4x frequency
    {width: "48", heightLines: 1},
    {width: "48", heightLines: 1},
    {width: "48", heightLines: 1},
    {width: "48", heightLines: 1},
    // 4x frequency
    {width: "64", heightLines: 1},
    {width: "64", heightLines: 1},
    {width: "64", heightLines: 1},
    {width: "64", heightLines: 1},
    // 6x frequency
    {width: "96", heightLines: 1},
    {width: "96", heightLines: 1},
    {width: "96", heightLines: 1},
    {width: "96", heightLines: 1},
    {width: "96", heightLines: 1},
    {width: "96", heightLines: 1},
    // 4x frequency
    {width: "128", heightLines: 1},
    {width: "128", heightLines: 1},
    {width: "128", heightLines: 1},
    {width: "128", heightLines: 1},
    // 1x frequency
    {width: "160", heightLines: 1},
    // 1x frequency
    {width: "160", heightLines: 2},
    // 1x frequency
    {width: "160", heightLines: 3},
    // 1x frequency
    {width: "160", heightLines: 4},
];

const shouldMergeMessageShimmerProbability = 0.5;

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// Assign a variable to null so you get a TypeScript error if you try to
// use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

export function MessageListMessageShimmer<Message extends MessageModel>({
    randomSeed,
    index,
    previousMessage,
    nextMessage,
    messages,
}: {
    randomSeed: string;
    index: number;
    previousMessage: MessageModelBase | null;
    nextMessage: MessageModelBase | null;
    messages: MessageList<Message>;
}) {
    const shimmerRef = useRef<HTMLDivElement>(null);
    const stableRandom = new StableRandom(`MessageShimmer:${randomSeed}`);

    const messageSize =
        messageShimmerSizes[
            stableRandom.randomInteger("size", index, 0, messageShimmerSizes.length)
        ]!;

    const shouldMergeWithNextMessage =
        !nextMessage &&
        index < messages.getMessageCountIncludingOptimisticMessages() - 1 &&
        stableRandom.randomFloat("size", index, 1) < shouldMergeMessageShimmerProbability;

    const shouldMergeWithPreviousMessage =
        !previousMessage &&
        index > 0 &&
        stableRandom.randomFloat("size", index - 1, 1) < shouldMergeMessageShimmerProbability;

    // Set shimmer start times to the same value. That way shimmers rendered at
    // different times (because they entered the virtualization window) will have the
    // same animation timeline.
    useLayoutEffectWithoutServerSideWarning(() => {
        const shimmerElement = assertExists(shimmerRef.current);
        for (const animation of shimmerElement.getAnimations()) {
            animation.startTime = 0;
        }
    }, []);

    return (
        <MessageShimmer
            ref={shimmerRef}
            width={messageSize.width}
            heightLines={messageSize.heightLines}
            shouldMergeWithNextMessage={shouldMergeWithNextMessage}
            shouldMergeWithPreviousMessage={shouldMergeWithPreviousMessage}
        />
    );
}
