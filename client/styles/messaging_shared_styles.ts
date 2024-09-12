// We put styling constants in this file that are needed outside of
// `client/messaging` by packages that don't want to take a dependency on
// `client/messaging`. For example `client/content`.

import {contentStyles} from "~/client/styles/styles.js";
import {fontSizesByPlatform} from "~/shared/design/fonts.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const messageViewBubbleMinWidth: Spacing = "6";
export const messageViewBubbleBorderRadius = {desktop: "4", mobile: "3.5"} as const;
export const messageViewBubbleMergedBorderRadius = "1";

export const messageViewBubblePaddingX: {desktop: Spacing; mobile: Spacing} = {
    desktop: "1",
    mobile: "0.5",
};

export const messageViewBubblePaddingY: {desktop: Spacing; mobile: Spacing} = {
    desktop: "2",
    mobile: "1.5",
};

export const messageViewBubbleMinHeight: {desktop: RemLength; mobile: RemLength} = {
    desktop: addRemLengths(
        spacing[messageViewBubblePaddingY.desktop],
        contentStyles.paragraphFontSize.lineHeight,
        spacing[messageViewBubblePaddingY.desktop],
    ),
    mobile: addRemLengths(
        spacing[messageViewBubblePaddingY.mobile],
        contentStyles.extraCompactParagraphFontSize.lineHeight,
        spacing[messageViewBubblePaddingY.mobile],
    ),
};

export const messageViewMaxWidth: Spacing = "160";
export const messageViewMarginY: Spacing = "3";
export const messageViewMergedMarginY: Spacing = "0.5";
export const messageViewTimestampDividerMarginTop: Spacing = "8";
export const messageViewTimestampDividerMarginBottom: Spacing = "2";

export const messageViewMinHeight = mapObjectValues(
    messageViewBubbleMinHeight,
    messageViewBubbleMinHeight =>
        addRemLengths(messageViewBubbleMinHeight, spacing[messageViewMergedMarginY]),
);

export const messageViewActionsWidth: Spacing = "10";
export const messageViewActionsWidthWithoutHoveringPrimaryInput: Spacing = "5";

export const messageViewReplyPreviewScale =
    fontSizesByPlatform["50"].desktop.fontSize / fontSizesByPlatform["100"].desktop.fontSize;
export const messageViewReplyPreviewOpacity = 0.6;
export const messageViewReplyPreviewBubbleOpacity = 0.7;

export const getMessageBubbleMarginLeft = (marginX: Spacing) =>
    addRemLengths(spacing[marginX], spacing["7"], spacing["2"]);

export const messageInputPaddingY: Spacing = "3";
export const messageInputAccountAvatarSize: Spacing = "7";
export const messageInputAccountAvatarPaddingY = mapObjectValues(
    messageViewBubbleMinHeight,
    (messageViewBubbleMinHeight): RemLength =>
        `${
            (parseRemLengthNumber(messageViewBubbleMinHeight) -
                parseRemLengthNumber(spacing[messageInputAccountAvatarSize])) /
            2
        }rem`,
);

export const messageInputMinHeight = mapObjectValues(
    messageViewBubbleMinHeight,
    messageViewBubbleMinHeight =>
        addRemLengths(
            spacing[messageInputPaddingY],
            messageViewBubbleMinHeight,
            spacing[messageInputPaddingY],
        ),
);
