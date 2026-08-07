import classNames from "classnames";
import {Ref, forwardRef, useMemo} from "react";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {TextShimmer} from "~/client/web/shimmer/text_shimmer.js";
import {
    messageViewAccountAvatarSize,
    messageViewAccountNameFontSize,
    messageViewAccountNameHeight,
    messageViewAvatarOffsetYPx,
    messageViewMarginY,
    messageViewMinHeightPx,
    messageViewRailGap,
} from "~/client/web/styles/messaging_shared_styles.js";
import {contentStyles, pulseAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {Spacing, screenPaddingX} from "~/shared/design/core/spacing.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.open_source.js";

const messageShimmerRagRights: ReadonlyArray<Spacing> = [
    // 1x frequency
    "0",
    "1",
    "2",
    "3",
    "4",
    // 2x frequency
    "5",
    "5",
    "6",
    "6",
    "7",
    "7",
    "8",
    "8",
    "9",
    "9",
    // 3x frequency
    "10",
    "10",
    "10",
    "12",
    "12",
    "12",
    "14",
    "14",
    "14",
    "16",
    "16",
    "16",
    // 2x frequency
    "20",
    "20",
    "24",
    "24",
];

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

const MessageShimmerForwardRef = forwardRef(MessageShimmer);
export {MessageShimmerForwardRef as MessageShimmer};

function MessageShimmer(
    {
        width,
        heightLines,
        shouldMergeWithNextMessage = false,
        shouldMergeWithPreviousMessage = false,
    }: {
        width: Spacing;
        heightLines: number;
        shouldMergeWithNextMessage?: boolean;
        shouldMergeWithPreviousMessage?: boolean;
    },
    ref: Ref<HTMLDivElement>,
) {
    const spacingScale = useSpacingScale();

    const stableRandom = useMemo(
        () => (heightLines > 0 ? new StableRandom(`MessageShimmer:${heightLines}:${width}`) : null),
        [heightLines, width],
    );

    let marginBottom: Spacing;

    if (!shouldMergeWithNextMessage) {
        marginBottom = messageViewMarginY;
    } else {
        marginBottom = contentStyles.paragraphMargin;
    }

    return (
        <div
            ref={ref}
            className={classNames(
                pulseAnimationClassName,
                sprinkles({
                    flexShrink: "0",
                    width: "full",
                    maxWidth: contentStyles.contentMaxWidth,
                    marginX: "center",
                    paddingX: screenPaddingX,
                    paddingBottom: marginBottom,
                }),
            )}
            style={{
                minHeight: messageViewMinHeightPx[spacingScale],
            }}
        >
            <div
                className={sprinkles({
                    position: "relative",
                    zIndex: "0",
                    display: "flex",
                    gap: messageViewRailGap,
                })}
            >
                <div
                    className={sprinkles({
                        flexShrink: "0",
                        width: messageViewAccountAvatarSize,
                    })}
                >
                    {!shouldMergeWithPreviousMessage && (
                        <div
                            className={sprinkles({
                                position: "relative",
                                width: messageViewAccountAvatarSize,
                                height: messageViewAccountAvatarSize,
                                backgroundColor: "grey-10",
                                borderRadius: "full",
                            })}
                            style={{top: messageViewAvatarOffsetYPx[spacingScale]}}
                        />
                    )}
                </div>
                <div className={sprinkles({flexGrow: "1"})}>
                    {!shouldMergeWithPreviousMessage && (
                        <div
                            className={sprinkles({
                                height: messageViewAccountNameHeight,
                                display: "flex",
                                alignItems: "center",
                            })}
                        >
                            <TextShimmer fontSize={messageViewAccountNameFontSize} width="16" />
                        </div>
                    )}
                    {createArrayWithLength(Math.max(1, heightLines), (index, length) => (
                        <TextShimmer
                            key={index}
                            fontSize={contentStyles.paragraphFontSize}
                            width={index === length - 1 ? width : "full"}
                            ragRight={
                                index === length - 1 || !stableRandom
                                    ? undefined
                                    : messageShimmerRagRights[
                                          stableRandom.randomInteger(
                                              "ragRight",
                                              index,
                                              messageShimmerRagRights.length,
                                          )
                                      ]
                            }
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
