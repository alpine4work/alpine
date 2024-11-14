// We put styling constants in this file that are needed outside of
// `client/messaging` by packages that don't want to take a dependency on
// `client/messaging`. For example `client/content`.

import {contentStyles} from "~/client/styles/styles.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {RemLength, Spacing, addRemLengths, parseRemLength} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const messageViewBubbleMinWidth: Spacing = "6";
export const messageViewBubbleBorderRadius = {desktop: "4", mobile: "3.5"} as const;
export const messageViewBubbleMergedBorderRadius = "1";

export const messageViewBubblePaddingX: {desktop: Spacing; mobile: Spacing} = {
    desktop: "3",
    mobile: "2.5",
};

export const messageViewBubblePaddingY: {desktop: Spacing; mobile: Spacing} = {
    desktop: "2",
    mobile: "1.5",
};

export const messageViewBubbleMinHeight: {
    medium: {desktop: RemLength; mobile: RemLength};
    large: {desktop: RemLength; mobile: RemLength};
} = mapObjectValues(contentStyles.paragraphFontSize, paragraphFontSize => ({
    desktop: addRemLengths(
        messageViewBubblePaddingY.desktop,
        paragraphFontSize.lineHeight,
        messageViewBubblePaddingY.desktop,
    ),
    mobile: addRemLengths(
        messageViewBubblePaddingY.mobile,
        contentStyles.extraCompactParagraphFontSize.lineHeight,
        messageViewBubblePaddingY.mobile,
    ),
}));

export const messageViewMaxWidth: Spacing = "160";
export const messageViewMarginY: Spacing = "3";
export const messageViewMergedMarginY: Spacing = "0.5";
export const messageViewTimestampDividerMarginTop: Spacing = "8";
export const messageViewTimestampDividerMarginBottom: Spacing = "2";

export const messageViewMinHeight = mapObjectValues(
    messageViewBubbleMinHeight,
    messageViewBubbleMinHeight =>
        mapObjectValues(messageViewBubbleMinHeight, messageViewBubbleMinHeight =>
            addRemLengths(messageViewBubbleMinHeight, messageViewMergedMarginY),
        ),
);

export const messageViewActionsWidth: Spacing = "10";
export const messageViewActionsWidthWithoutHoveringPrimaryInput: Spacing = "5";

export const messageViewReplyPreviewScale =
    fontSizesBySpacingScale["50"].medium.fontSize / fontSizesBySpacingScale["100"].medium.fontSize;
export const messageViewReplyPreviewOpacity = 0.6;
export const messageViewReplyPreviewBubbleOpacity = 0.7;

export const getMessageBubbleMarginLeft = (marginX: Spacing) => addRemLengths(marginX, "7", "2");

export const messageInputPaddingY: Spacing = "3";
export const messageInputAccountAvatarSize: Spacing = "7";
export const messageInputAccountAvatarPaddingY = mapObjectValues(
    messageViewBubbleMinHeight,
    messageViewBubbleMinHeight =>
        mapObjectValues(
            messageViewBubbleMinHeight,
            (messageViewBubbleMinHeight): RemLength =>
                `${
                    (parseRemLength(messageViewBubbleMinHeight) -
                        parseRemLength(messageInputAccountAvatarSize)) /
                    2
                }rem`,
        ),
);

export const messageInputMinHeight = mapObjectValues(
    messageViewBubbleMinHeight,
    messageViewBubbleMinHeight =>
        mapObjectValues(messageViewBubbleMinHeight, messageViewBubbleMinHeight =>
            addRemLengths(messageInputPaddingY, messageViewBubbleMinHeight, messageInputPaddingY),
        ),
);

export const messagingViewMarginBottomCalcExpression =
    "var(--safe-area-inset-bottom, 0px) - var(--window-safe-area-inset-bottom, 0px)";

export const messagingViewMarginBottom = `calc(${messagingViewMarginBottomCalcExpression})`;
