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
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {allSpacingScales, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const messageView2AccountAvatarSize = "6";
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
        convertRemLengthToPx(messageView2AccountAvatarSize, spacingScale) / 2,
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
export const messageViewOutlineMargin = "1";

export const messageViewNotMergedOutlineMinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        convertRemLengthToPx(messageViewOutlineMargin, spacingScale) +
        messageView2AvatarOffsetYPx[spacingScale] +
        convertRemLengthToPx(messageView2AccountAvatarSize, spacingScale) +
        convertRemLengthToPx(messageViewOutlineMargin, spacingScale),
);

export const messageViewEditorOutlineMarginLeft = addRemLengths(
    messageView2AccountAvatarSize,
    messageView2RailGap,
    messageViewOutlineMargin,
);

export const messageViewNotMergedEditorOutlineMarginTop = addRemLengths(
    messageViewOutlineMargin,
    messageView2AccountNameHeight,
);

export const messageViewNotMergedEditorOutlineMarginBottomPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        messageViewNotMergedOutlineMinHeightPx[spacingScale] -
        (convertRemLengthToPx(messageViewOutlineMargin, spacingScale) +
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

export const messageViewParentMessageFontSize = "75";

export const messageViewParentMessageScale =
    fontSizesBySpacingScale[messageViewParentMessageFontSize].small.fontSize /
    fontSizesBySpacingScale[contentStyles.paragraphActualFontSize].small.fontSize;

// NOCOMMIT: Delete this
export const messageViewParentLineHeight = `${1.3125 * messageViewParentMessageScale}rem`;

export const messageViewParentMessageAvatarSize = assertSpacing(
    Math.round(parseInt(messageView2AccountAvatarSize, 10) * messageViewParentMessageScale),
);

// Should be the same size as `messageView2AccountAvatarSize`.
export const messageInputEditor2IconButtonSize = "md";

export const messageInputEditor2PaddingX = addRemLengths(
    messageView2AccountAvatarSize,
    messageView2RailGap,
);

export const messageInputEditor2IconButtonMargin: RemLength = `${
    parseRemLength(subtractRemLengths(messageInputEditor2PaddingX, messageView2AccountAvatarSize)) /
    2
}rem`;

export const messageInputEditor2PaddingYPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        (convertRemLengthToPx(
            addRemLengths(
                messageInputEditor2IconButtonMargin,
                messageView2AccountAvatarSize,
                messageInputEditor2IconButtonMargin,
            ),
            spacingScale,
        ) -
            contentStyles.paragraphLineHeightPx[spacingScale]) /
        2,
);

// NOCOMMIT: Rename the "2" bits
export const messageInputEditor2MinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        contentStyles.paragraphLineHeightPx[spacingScale] +
        messageInputEditor2PaddingYPx[spacingScale] * 2,
);

export const messageInputEditor2BorderRadiusPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale => messageInputEditor2MinHeightPx[spacingScale] / 2,
);

// NOCOMMIT: Delete these?
export const messageViewReplyPreviewOpacity = 0.6;
export const messageViewReplyPreviewBubbleOpacity = 0.7;

// NOCOMMIT: Delete?
export const getMessageBubbleMarginLeft = (marginX: Spacing) => addRemLengths(marginX, "7", "2");

export const messageInputPaddingY: Spacing = "2";
// NOCOMMIT: Delete?
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

// NOCOMMIT: Delete?
export const messageInputMinHeight = mapObjectValues(
    messageViewBubbleMinHeight,
    messageViewBubbleMinHeight =>
        addRemLengths(messageInputPaddingY, messageViewBubbleMinHeight, messageInputPaddingY),
);

export const messageInput2MinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        messageInputEditor2MinHeightPx[spacingScale] +
        convertRemLengthToPx(messageInputPaddingY, spacingScale) * 2,
);

export const messagingViewMarginBottomCalcExpression =
    "var(--safe-area-inset-bottom, 0px) - var(--window-safe-area-inset-bottom, 0px)";

export const messagingViewMarginBottom = `calc(${messagingViewMarginBottomCalcExpression})`;
