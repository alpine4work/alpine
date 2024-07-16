import classNames from "classnames";
import {Ref, forwardRef} from "react";
import {useCanPrimaryInputHover, useIsMobile} from "~/client/remix/use_is_mobile.js";
import {
    Spacing,
    addRemLengths,
    parseRemLengthNumber,
    screenPaddingX,
    spacing,
} from "~/shared/design/spacing.js";
import {
    getMessageBubbleMarginLeft,
    messageViewActionsWidth,
    messageViewActionsWidthWithoutHoveringPrimaryInput,
    messageViewBubbleBorderRadius,
    messageViewBubbleMergedBorderRadius,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
    messageViewMarginY,
    messageViewMergedMarginY,
} from "~/shared/styles/messaging_shared_styles.js";
import {
    contentSchemaStyles,
    fontSizes,
    pulseAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles.js";

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
        paddingX = screenPaddingX,
    }: {
        width: Spacing;
        heightLines: number;
        shouldMergeWithNextMessage?: boolean;
        shouldMergeWithPreviousMessage?: boolean;
        paddingX?: Spacing | {mobile: Spacing; desktop: Spacing};
    },
    ref: Ref<HTMLDivElement>,
) {
    const isMobile = useIsMobile();
    const canPrimaryInputHover = useCanPrimaryInputHover();

    return (
        <div
            ref={ref}
            className={classNames(
                pulseAnimationClassName,
                sprinkles({
                    width: "full",
                    maxWidth: "160",
                    marginX: "center",
                }),
            )}
        >
            {!shouldMergeWithPreviousMessage && (
                <div
                    className={sprinkles({paddingY: "0.5"})}
                    style={{
                        paddingLeft: addRemLengths(
                            getMessageBubbleMarginLeft(
                                typeof paddingX === "string"
                                    ? paddingX
                                    : paddingX[isMobile ? "mobile" : "desktop"],
                            ),
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
                    paddingX,
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
                <div
                    className={sprinkles({
                        flexGrow: "1",
                        paddingRight: canPrimaryInputHover
                            ? messageViewActionsWidth
                            : messageViewActionsWidthWithoutHoveringPrimaryInput,
                    })}
                >
                    <div
                        className={sprinkles({
                            paddingX: messageViewBubblePaddingX,
                            paddingY: messageViewBubblePaddingY,
                            backgroundColor: "grey-5",
                            width: "full",
                            maxWidth: width,
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
                                    heightLines *
                                    parseRemLengthNumber(
                                        isMobile
                                            ? contentSchemaStyles.extraCompactParagraphFontSize
                                                  .lineHeight
                                            : contentSchemaStyles.paragraphFontSize.lineHeight,
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
