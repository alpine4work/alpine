import classNames from "classnames";
import {useRef} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {Spacing, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {MessageModel, MessageModelBase} from "~/shared/messaging/message_model.js";
import {
    defaultMessageViewMarginX,
    getMessageBubbleMarginLeft,
    messageViewActionsWidth,
    messageViewBubbleBorderRadius,
    messageViewBubbleMergedBorderRadius,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
    messageViewMarginY,
    messageViewMergedMarginY,
} from "~/shared/messaging/messaging_shared_styles.js";
import {
    contentSchemaStyles,
    fontSizes,
    pulseAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles.js";

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

export function MessageShimmer<Message extends MessageModel>({
    randomSeed,
    index,
    previousMessage,
    nextMessage,
    messages,
    marginX = defaultMessageViewMarginX,
}: {
    randomSeed: string;
    index: number;
    previousMessage: MessageModelBase | null;
    nextMessage: MessageModelBase | null;
    messages: MessageList<Message>;
    marginX?: Spacing;
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
                    width: "full",
                    maxWidth: "160",
                }),
            )}
            style={{
                margin: "0 auto",
            }}
        >
            {!shouldMergeWithPreviousMessage && (
                <div
                    className={sprinkles({paddingY: "0.5"})}
                    style={{
                        paddingLeft: addRemLengths(
                            getMessageBubbleMarginLeft(marginX),
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
                    paddingX: marginX,
                    paddingBottom: !shouldMergeWithNextMessage
                        ? messageViewMarginY
                        : messageViewMergedMarginY,
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
                            <div className={sprinkles({paddingY: "0.5"})}>
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
                            </div>
                        )}
                    </div>
                </div>
                <div className={sprinkles({flexGrow: "1", paddingRight: messageViewActionsWidth})}>
                    <div
                        className={sprinkles({
                            paddingX: messageViewBubblePaddingX,
                            paddingY: messageViewBubblePaddingY,
                            backgroundColor: "grey-5",
                            width: "full",
                            maxWidth: messageSize.width,
                            borderTopLeftRadius: !shouldMergeWithPreviousMessage
                                ? messageViewBubbleBorderRadius
                                : messageViewBubbleMergedBorderRadius,
                            borderTopRightRadius: messageViewBubbleBorderRadius,
                            borderBottomLeftRadius: !shouldMergeWithNextMessage
                                ? messageViewBubbleBorderRadius
                                : messageViewBubbleMergedBorderRadius,
                            borderBottomRightRadius: messageViewBubbleBorderRadius,
                        })}
                    >
                        <div
                            style={{
                                height: `${
                                    messageSize.heightLines *
                                    parseRemLengthNumber(contentSchemaStyles.paragraphLineHeight)
                                }rem`,
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
