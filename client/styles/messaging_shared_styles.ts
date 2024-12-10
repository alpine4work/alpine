// We put styling constants in this file that are needed outside of
// `client/messaging` by packages that don't want to take a dependency on
// `client/messaging`. For example `client/content`.

import {contentStyles} from "~/client/styles/styles.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    assertSpacing,
    convertRemLengthToPx,
    parseRemLength,
} from "~/shared/design/core/spacing.js";
import {allSpacingScales} from "~/shared/design/core/spacing_scale.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const messageView2AvatarSize = "6";
export const messageView2RailGap = "2";

// Ideally, `messageView2AccountNameHeight` is a whole pixel value on all
// spacing scales so that `<MessageView>` heights will be measured in full
// pixels.
//
// NOCOMMIT: Rename "message view 2" stuff.
export const messageView2AccountNameFontSize = "50";
export const messageView2AccountNameHeight = "4";

export const messageView2AvatarOffsetYPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        convertRemLengthToPx(messageView2AccountNameHeight, spacingScale) +
        contentStyles.paragraphLineHeightPx[spacingScale] / 2 -
        convertRemLengthToPx(messageView2AvatarSize, spacingScale) / 2,
);

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
        "1.3125rem",
        messageViewBubblePaddingY.desktop,
    ),
    mobile: addRemLengths(
        messageViewBubblePaddingY.mobile,
        "1.3125rem",
        messageViewBubblePaddingY.mobile,
    ),
};

// NOCOMMIT: Replace with content max width?
export const messageViewMaxWidth: Spacing = "160";
// NOCOMMIT: Keep I think?
export const messageViewMarginY: Spacing = "4";
// NOCOMMIT: Delete?
export const messageViewMergedMarginY: Spacing = "0.5";

export const messageViewOutlineBorderRadius = "1";
export const messageViewOutlineMarginX: Spacing = "1";
export const messageViewOutlineMarginY: Spacing = "1";

export const messageViewNotMergedOutlineMinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        convertRemLengthToPx(messageViewOutlineMarginY, spacingScale) +
        messageView2AvatarOffsetYPx[spacingScale] +
        convertRemLengthToPx(messageView2AvatarSize, spacingScale) +
        convertRemLengthToPx(messageViewOutlineMarginY, spacingScale),
);

export const messageViewEditorOutlineMarginLeft = addRemLengths(
    messageView2AvatarSize,
    messageView2RailGap,
    messageViewOutlineMarginX,
);

export const messageViewNotMergedEditorOutlineMarginTop = addRemLengths(
    messageViewOutlineMarginY,
    messageView2AccountNameHeight,
);

export const messageViewNotMergedEditorOutlineMarginBottomPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        messageViewNotMergedOutlineMinHeightPx[spacingScale] -
        (convertRemLengthToPx(messageViewOutlineMarginY, spacingScale) +
            convertRemLengthToPx(messageView2AccountNameHeight, spacingScale) +
            contentStyles.paragraphLineHeightPx[spacingScale]),
);

export const messageViewMinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        contentStyles.paragraphLineHeightPx[spacingScale] +
        convertRemLengthToPx(contentStyles.paragraphMargin, spacingScale),
);

// NOCOMMIT: Delete these?
export const messageViewActionsWidth: Spacing = "10";
export const messageViewActionsWidthWithoutHoveringPrimaryInput: Spacing = "5";

export const messageViewParentFontSize = "75";

export const messageViewParentScale =
    fontSizesBySpacingScale[messageViewParentFontSize].small.fontSize /
    fontSizesBySpacingScale[contentStyles.paragraphActualFontSize].small.fontSize;

// NOCOMMIT: Delete this
export const messageViewParentLineHeight = `${1.3125 * messageViewParentScale}rem`;

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
