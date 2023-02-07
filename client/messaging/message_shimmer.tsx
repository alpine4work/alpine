import classNames from "classnames";
import {useRef} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageList} from "~/client/messaging/message_list";
import {Spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {StableRandom} from "~/shared/helpers/number/stable_random";
import {MessageInterface} from "~/shared/models/message_interface";
import {pulseAnimationClassName, sprinkles} from "~/shared/styles/styles";

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
    messages: MessageList<Message>;
}) {
    const shimmerRef = useRef<HTMLDivElement>(null);
    const stableRandom = new StableRandom(randomSeed);

    const messageSize =
        messageShimmerSizes[
            stableRandom.randomInteger("size", index, 0, messageShimmerSizes.length)
        ]!;

    const shouldMergeWithNextMessage =
        !nextMessage &&
        index < messages.getMessageCount() - 1 &&
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
        <div
            ref={shimmerRef}
            className={classNames(
                pulseAnimationClassName,
                sprinkles({
                    display: "flex",
                    paddingX: "3",
                    paddingBottom: !shouldMergeWithNextMessage ? "3" : "0.5",
                }),
            )}
        >
            <div
                className={sprinkles({
                    flexShrink: "0",
                    width: "10",
                    display: "flex",
                    alignItems: "flex-end",
                })}
            >
                {!shouldMergeWithNextMessage && (
                    <div
                        className={sprinkles({
                            flexShrink: "0",
                            width: "8",
                            height: "8",
                            backgroundColor: "grey-10",
                            borderRadius: "full",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                        })}
                    />
                )}
            </div>
            <div className={sprinkles({flexGrow: "1"})}>
                {!shouldMergeWithPreviousMessage && (
                    <div className={sprinkles({paddingY: "0.5", paddingLeft: "2"})}>
                        <div
                            style={{height: 18}}
                            className={sprinkles({display: "flex", alignItems: "center"})}
                        >
                            <div
                                className={sprinkles({
                                    height: "2",
                                    width: "16",
                                    backgroundColor: "grey-5",
                                    borderRadius: "full",
                                })}
                            />
                        </div>
                    </div>
                )}
                <div
                    className={sprinkles({
                        paddingY: "2",
                        paddingX: "2",
                        backgroundColor: "grey-5",
                        width: "full",
                        maxWidth: messageSize.width,
                        borderTopLeftRadius: !shouldMergeWithPreviousMessage ? "xl" : "base",
                        borderTopRightRadius: "xl",
                        borderBottomLeftRadius: !shouldMergeWithNextMessage ? "xl" : "base",
                        borderBottomRightRadius: "xl",
                    })}
                >
                    <div style={{height: `${messageSize.heightLines * 1.5}rem`}} />
                </div>
            </div>
        </div>
    );
}
