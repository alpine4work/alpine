import {useRef} from "react";
import {Box} from "~/client/design/box";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {PaginatedMessageList} from "~/client/messaging/paginated_message_list";
import {Spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {StableRandom} from "~/shared/helpers/number/stable_random";
import {MessageInterface} from "~/shared/models/message_interface";
import {pulseAnimationClassName} from "~/shared/styles/styles";

// We repeat sizes to make them appear more frequently when randomly selecting
// a size.
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

export function MessageShimmer<Message extends MessageInterface>({
    randomSeed,
    index,
    previousMessage,
    nextMessage,
    messages,
}: {
    randomSeed: string;
    index: number;
    previousMessage: Message | null;
    nextMessage: Message | null;
    messages: PaginatedMessageList<Message>;
}) {
    const shimmerRef = useRef<HTMLDivElement>(null);
    const stableRandom = new StableRandom(randomSeed);

    const messageSize =
        messageShimmerSizes[
            stableRandom.randomInteger("size", index, 0, messageShimmerSizes.length)
        ]!;

    const shouldMergeWithNextMessage =
        !nextMessage &&
        index < messages.getEstimatedMessageCount() - 1 &&
        stableRandom.randomFloat("size", index, 1) < shouldMergeMessageShimmerProbability;
    const shouldMergeWithPreviousMessage =
        !previousMessage &&
        index > 0 &&
        stableRandom.randomFloat("size", index - 1, 1) < shouldMergeMessageShimmerProbability;

    // Set shimmer start times to the same value. That way shimmers rendered at
    // different times (because they entered the virtualization window) will have
    // the same animation timeline.
    useLayoutEffectWithoutServerSideWarning(() => {
        const shimmerElement = assertExists(shimmerRef.current);
        for (const animation of shimmerElement.getAnimations()) {
            animation.startTime = 0;
        }
    }, []);

    return (
        <Box
            ref={shimmerRef}
            display="flex"
            paddingX="3"
            paddingBottom={!shouldMergeWithNextMessage ? "3" : "0.5"}
            className={pulseAnimationClassName}
        >
            <Box flexShrink="0" width="10" display="flex" alignItems="flex-end">
                {!shouldMergeWithNextMessage && (
                    <Box
                        flexShrink="0"
                        width="8"
                        height="8"
                        backgroundColor="grey-10"
                        borderRadius="full"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                    />
                )}
            </Box>
            <Box flexGrow="1">
                {!shouldMergeWithPreviousMessage && (
                    <Box paddingY="0.5" paddingLeft="2">
                        <Box style={{height: 18}} display="flex" alignItems="center">
                            <Box
                                height="2"
                                width="16"
                                backgroundColor="grey-5"
                                borderRadius="full"
                            />
                        </Box>
                    </Box>
                )}
                <Box
                    paddingY="2"
                    paddingX="2"
                    backgroundColor="grey-5"
                    width="full"
                    maxWidth={messageSize.width}
                    borderTopLeftRadius={!shouldMergeWithPreviousMessage ? "xl" : "base"}
                    borderTopRightRadius="xl"
                    borderBottomLeftRadius={!shouldMergeWithNextMessage ? "xl" : "base"}
                    borderBottomRightRadius="xl"
                >
                    <div style={{height: `${messageSize.heightLines * 1.5}rem`}} />
                </Box>
            </Box>
        </Box>
    );
}
