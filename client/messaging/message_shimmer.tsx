import {useRef} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageList} from "~/client/messaging/message_list";
import {Spacing, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {StableRandom} from "~/shared/helpers/number/stable_random";
import {MessageInterface, MessageInterfaceBase} from "~/shared/models/message_interface";
import {
    contentSchemaStyles,
    fontSizes,
    pulseAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles";

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
    previousMessage: MessageInterfaceBase | null;
    nextMessage: MessageInterfaceBase | null;
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
        <div ref={shimmerRef} className={pulseAnimationClassName}>
            {!shouldMergeWithPreviousMessage && (
                <div
                    className={sprinkles({paddingY: "0.5"})}
                    style={{
                        paddingLeft: addRemLengths(
                            spacing["3"],
                            spacing["7"],
                            spacing["2"],
                            spacing["1.5"],
                        ),
                    }}
                >
                    <div
                        style={{height: fontSizes["50"].lineHeight}}
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
                    display: "flex",
                    paddingX: "3",
                    paddingBottom: !shouldMergeWithNextMessage ? "3" : "0.5",
                })}
            >
                <div className={sprinkles({flexShrink: "0", paddingRight: "2"})}>
                    <div
                        className={sprinkles({
                            width: "7",
                            height: "full",
                            display: "flex",
                            alignItems: "flex-end",
                        })}
                    >
                        {!shouldMergeWithNextMessage && (
                            <div
                                className={sprinkles({
                                    flexShrink: "0",
                                    width: "7",
                                    height: "7",
                                    backgroundColor: "grey-10",
                                    borderRadius: "full",
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "center",
                                })}
                            />
                        )}
                    </div>
                </div>
                <div className={sprinkles({flexGrow: "1", paddingRight: "10"})}>
                    <div
                        className={sprinkles({
                            paddingY: "1.5",
                            paddingX: "0.5",
                            backgroundColor: "grey-5",
                            width: "full",
                            maxWidth: messageSize.width,
                            borderTopLeftRadius: !shouldMergeWithPreviousMessage ? "xl" : "base",
                            borderTopRightRadius: "xl",
                            borderBottomLeftRadius: !shouldMergeWithNextMessage ? "xl" : "base",
                            borderBottomRightRadius: "xl",
                        })}
                    >
                        <div
                            style={{
                                height: `${
                                    messageSize.heightLines *
                                    parseRemLengthNumber(
                                        contentSchemaStyles.paragraphFontSize.lineHeight,
                                    )
                                }rem`,
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
