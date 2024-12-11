// We put styling constants in this file that are needed outside of
// `client/messaging` by packages that don't want to take a dependency on
// `client/messaging`. For example `client/content`.

import {contentStyles, fontSizes} from "~/client/styles/styles.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {Platform, allPlatforms} from "~/shared/design/core/platform.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    assertSpacing,
    convertRemLengthToPx,
    parseRemLength,
    screenPaddingX,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {allSpacingScales} from "~/shared/design/core/spacing_scale.js";
import {assert} from "~/shared/helpers/control/assert.js";
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

export const messageViewBubbleBorderRadius = {desktop: "4", mobile: "3.5"} as const; // NOCOMMIT: Delete

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

export const messageViewParentMessageFontSize = "75";

export const messageViewParentMessageLineHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        Math.floor(
            fontSizesBySpacingScale[messageViewParentMessageFontSize][spacingScale].fontSize *
                contentStyles.paragraphLineHeightMultiple,
        ),
);

export const messageViewParentMessageAccountAvatarSize = assertSpacing(
    Math.round(
        parseInt(messageView2AccountAvatarSize, 10) *
            (fontSizesBySpacingScale[messageViewParentMessageFontSize].small.fontSize /
                fontSizesBySpacingScale[contentStyles.paragraphActualFontSize].small.fontSize),
    ),
);

export const messageViewParentMessageAvatarOffsetYRem =
    (parseRemLength(messageViewParentMessageAccountAvatarSize) -
        parseRemLength(fontSizes[messageViewParentMessageFontSize].lineHeight)) /
    -2;

// Should be the same size as `messageView2AccountAvatarSize`.
export const messageInputEditor2IconButtonSize = "md";

// NOCOMMIT: No more "3" naming business
export const messageInputEditor3IconButtonMargin: Record<Platform, Spacing> = {
    desktop: "2",
    mobile: "1",
};

export const messageInputEditor3IconButtonNegativeMargin = mapObjectValues(
    messageInputEditor3IconButtonMargin,
    (spacing): `-${Spacing}` => `-${spacing}`,
);

export const messageInputEditor2PaddingX = createObjectFromKeys(allPlatforms, platform =>
    addRemLengths(
        messageInputEditor3IconButtonMargin[platform],
        messageView2AccountAvatarSize,
        messageView2RailGap,
    ),
);

export const messageInputEditor2PaddingYPx = createObjectFromKeys(allPlatforms, platform =>
    createObjectFromKeys(
        allSpacingScales,
        spacingScale =>
            (convertRemLengthToPx(
                addRemLengths(
                    messageInputEditor3IconButtonMargin[platform],
                    messageView2AccountAvatarSize,
                    messageInputEditor3IconButtonMargin[platform],
                ),
                spacingScale,
            ) -
                contentStyles.paragraphLineHeightPx[spacingScale]) /
            2,
    ),
);

// NOCOMMIT: Rename the "2" bits
export const messageInputEditor2MinHeightPx = createObjectFromKeys(allPlatforms, platform =>
    createObjectFromKeys(
        allSpacingScales,
        spacingScale =>
            contentStyles.paragraphLineHeightPx[spacingScale] +
            messageInputEditor2PaddingYPx[platform][spacingScale] * 2,
    ),
);

export const messageInputEditor2BorderRadiusPx = createObjectFromKeys(allPlatforms, platform =>
    createObjectFromKeys(
        allSpacingScales,
        spacingScale => messageInputEditor2MinHeightPx[platform][spacingScale] / 2,
    ),
);

// NOCOMMIT: Delete?
export const getMessageBubbleMarginLeft = (marginX: Spacing) => addRemLengths(marginX, "7", "2");

export const messageInputPaddingY: Record<Platform, Spacing> = {
    desktop: "3",
    mobile: "2",
};

// Our objective with `messageInputPaddingY` and
// `messageInputEditor3IconButtonMargin` is for the message input to have the same
// X and Y margin with the edge of the screen. Y margin is determined by this
// value and X margin is determined by `screenPaddingX`.
//
// Check that `screenPaddingX - messageInputEditor3IconButtonMargin` equals
// `messageInputPaddingY`.
if (process.env.NODE_ENV !== "production") {
    assert(
        allPlatforms.every(
            platform =>
                subtractRemLengths(
                    screenPaddingX[platform],
                    messageInputEditor3IconButtonMargin[platform],
                ) === spacing[messageInputPaddingY[platform]],
        ),
    );
}

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
    (messageViewBubbleMinHeight, platform) =>
        addRemLengths(
            messageInputPaddingY[platform],
            messageViewBubbleMinHeight,
            messageInputPaddingY[platform],
        ),
);

export const messageInput2MinHeightPx = createObjectFromKeys(allPlatforms, platform =>
    createObjectFromKeys(
        allSpacingScales,
        spacingScale =>
            messageInputEditor2MinHeightPx[platform][spacingScale] +
            convertRemLengthToPx(messageInputPaddingY[platform], spacingScale) * 2,
    ),
);

export const messagingViewMarginBottomCalcExpression =
    "var(--safe-area-inset-bottom, 0px) - var(--window-safe-area-inset-bottom, 0px)";

export const messagingViewMarginBottom = `calc(${messagingViewMarginBottomCalcExpression})`;

export const messagingTypingIndicatorsMinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        convertRemLengthToPx(messageView2AccountNameHeight, spacingScale) +
        contentStyles.paragraphLineHeightPx[spacingScale],
);
