// We put styling constants in this file that are needed outside of
// `client/messaging` by packages that don't want to take a dependency on
// `client/messaging`. For example `client/content`.

import {contentStyles, fontSizes} from "~/client/styles/styles.js";
import {fontSizesByPlatform} from "~/shared/design/core/fonts.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    assertSpacing,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const messageView2AvatarSize = "8";
export const messageView2RailGap = "3";

// NOCOMMIT: Rename "message view 2" stuff.
export const messageView2AccountNameFontSize = "50";
export const messageView2AccountNameMarginBottom = "0.5";

export const messageView2AvatarOffsetY = `${
    parseRemLengthNumber(
        addRemLengths(
            fontSizes[messageView2AccountNameFontSize].lineHeight,
            spacing[messageView2AccountNameMarginBottom],
            contentStyles.paragraphFontSize.lineHeight,
        ),
    ) /
        2 -
    parseRemLengthNumber(spacing[messageView2AvatarSize]) / 2
}rem`;

export const messageViewBubbleMinWidth: Spacing = "6"; // NOCOMMIT: Delete
export const messageViewBubbleBorderRadius = {desktop: "4", mobile: "3.5"} as const; // NOCOMMIT: Delete
export const messageViewBubbleMergedBorderRadius = "1"; // NOCOMMIT: Delete

// NOCOMMIT: Delete
export const messageViewBubblePaddingX: {desktop: Spacing; mobile: Spacing} = {
    desktop: "0",
    mobile: "0",
};

// NOCOMMIT: Delete
export const messageViewBubblePaddingY: {desktop: Spacing; mobile: Spacing} = {
    desktop: assertSpacing(parseInt(contentStyles.standaloneBlockMargin, 10) / 2),
    mobile: assertSpacing(parseInt(contentStyles.standaloneBlockMargin, 10) / 2),
};

// NOCOMMIT: Delete
export const messageViewBubbleMinHeight: {desktop: RemLength; mobile: RemLength} = {
    desktop: addRemLengths(
        spacing[messageViewBubblePaddingY.desktop],
        contentStyles.paragraphFontSize.lineHeight,
        spacing[messageViewBubblePaddingY.desktop],
    ),
    mobile: addRemLengths(
        spacing[messageViewBubblePaddingY.mobile],
        contentStyles.paragraphFontSize.lineHeight,
        spacing[messageViewBubblePaddingY.mobile],
    ),
};

// NOCOMMIT: Replace with content max width?
export const messageViewMaxWidth: Spacing = "160";
// NOCOMMIT: Keep I think?
export const messageViewMarginY: Spacing = "4";
// NOCOMMIT: Delete?
export const messageViewMergedMarginY: Spacing = "0.5";

export const messageViewMinHeight = addRemLengths(
    contentStyles.paragraphFontSize.lineHeight,
    spacing[contentStyles.paragraphMargin],
);

// NOCOMMIT: Delete these?
export const messageViewActionsWidth: Spacing = "10";
export const messageViewActionsWidthWithoutHoveringPrimaryInput: Spacing = "5";

// NOCOMMIT: Delete these?
export const messageViewReplyPreviewScale =
    fontSizesByPlatform["50"].desktop.fontSize / fontSizesByPlatform["100"].desktop.fontSize;
export const messageViewReplyPreviewOpacity = 0.6;
export const messageViewReplyPreviewBubbleOpacity = 0.7;

// NOCOMMIT: Delete?
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

export const messagingViewMarginBottomCalcExpression =
    "var(--safe-area-inset-bottom, 0px) - var(--window-safe-area-inset-bottom, 0px)";

export const messagingViewMarginBottom = `calc(${messagingViewMarginBottomCalcExpression})`;
