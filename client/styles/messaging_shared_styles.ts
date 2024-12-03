// We put styling constants in this file that are needed outside of
// `client/messaging` by packages that don't want to take a dependency on
// `client/messaging`. For example `client/content`.

import {contentStyles, fontSizes} from "~/client/styles/styles.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    assertSpacing,
    parseRemLength,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const messageView2AvatarSize = "6";
export const messageView2RailGap = "2";

// NOCOMMIT: Rename "message view 2" stuff.
export const messageView2AccountNameFontSize = "50";
export const messageView2AccountNameMarginBottom = "0";

export const messageView2AvatarOffsetYRem =
    parseRemLength(fontSizes[messageView2AccountNameFontSize].lineHeight) +
    parseRemLength(messageView2AccountNameMarginBottom) +
    parseRemLength(contentStyles.paragraphFontSize.lineHeight) / 2 -
    parseRemLength(messageView2AvatarSize) / 2;

export const messageView2AvatarOffsetY = `${messageView2AvatarOffsetYRem}rem`;

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
        messageViewBubblePaddingY.desktop,
        contentStyles.paragraphFontSize.lineHeight,
        messageViewBubblePaddingY.desktop,
    ),
    mobile: addRemLengths(
        messageViewBubblePaddingY.mobile,
        contentStyles.paragraphFontSize.lineHeight,
        messageViewBubblePaddingY.mobile,
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
    contentStyles.paragraphMargin,
);

// NOCOMMIT: Delete these?
export const messageViewActionsWidth: Spacing = "10";
export const messageViewActionsWidthWithoutHoveringPrimaryInput: Spacing = "5";

export const messageViewParentFontSize = "75";

export const messageViewParentScale =
    fontSizesBySpacingScale[messageViewParentFontSize].small.fontSize /
    fontSizesBySpacingScale[contentStyles.paragraphActualFontSize].small.fontSize;

export const messageViewParentLineHeight = `${
    contentStyles.paragraphLineHeightRem * messageViewParentScale
}rem`;

export const messageViewParentAvatarSize = assertSpacing(
    Math.round(parseInt(messageView2AvatarSize, 10) * messageViewParentScale),
);

// NOCOMMIT: Delete these?
export const messageViewReplyPreviewOpacity = 0.6;
export const messageViewReplyPreviewBubbleOpacity = 0.7;

// NOCOMMIT: Delete?
export const getMessageBubbleMarginLeft = (marginX: Spacing) => addRemLengths(marginX, "7", "2");

export const messageInputPaddingY: Spacing = "3";
export const messageInputAccountAvatarSize: Spacing = "7";
export const messageInputAccountAvatarPaddingY = mapObjectValues(
    messageViewBubbleMinHeight,
    (messageViewBubbleMinHeight): RemLength =>
        `${
            (parseRemLength(messageViewBubbleMinHeight) -
                parseRemLength(messageInputAccountAvatarSize)) /
            2
        }rem`,
);

export const messageInputMinHeight = mapObjectValues(
    messageViewBubbleMinHeight,
    messageViewBubbleMinHeight =>
        addRemLengths(messageInputPaddingY, messageViewBubbleMinHeight, messageInputPaddingY),
);

export const messagingViewMarginBottomCalcExpression =
    "var(--safe-area-inset-bottom, 0px) - var(--window-safe-area-inset-bottom, 0px)";

export const messagingViewMarginBottom = `calc(${messagingViewMarginBottomCalcExpression})`;
