// We put styling constants in this file that are needed outside of
// `client/messaging` by packages that don't want to take a dependency on
// `client/messaging`. For example `client/content`.

import {contentStyles, fontSizes} from "~/client/styles/styles.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {Platform, allPlatforms} from "~/shared/design/core/platform.js";
import {
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

export const messageViewAccountAvatarSize = "6";
export const messageViewRailGap = "2";

export const messageViewMarginLeft = addRemLengths(
    messageViewAccountAvatarSize,
    messageViewRailGap,
);

// Ideally, `messageViewAccountNameHeight` is a whole pixel value on all
// spacing scales so that `<MessageView>` heights will be measured in full
// pixels.
export const messageViewAccountNameFontSize = "50";
export const messageViewAccountNameHeight = "4";

export const messageViewAvatarOffsetYPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        convertRemLengthToPx(messageViewAccountNameHeight, spacingScale) +
        contentStyles.paragraphLineHeightPx[spacingScale] / 2 -
        convertRemLengthToPx(messageViewAccountAvatarSize, spacingScale) / 2,
);

export const messageViewMarginY: Spacing = contentStyles.standaloneBlockMargin;

export const messageViewOutlineBorderRadius = "1";
export const messageViewOutlineMargin = "1";

export const messageViewNotMergedOutlineMinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        convertRemLengthToPx(messageViewOutlineMargin, spacingScale) +
        messageViewAvatarOffsetYPx[spacingScale] +
        convertRemLengthToPx(messageViewAccountAvatarSize, spacingScale) +
        convertRemLengthToPx(messageViewOutlineMargin, spacingScale),
);

export const messageViewEditorOutlineMarginLeft = addRemLengths(
    messageViewAccountAvatarSize,
    messageViewRailGap,
    messageViewOutlineMargin,
);

export const messageViewNotMergedEditorOutlineMarginTop = addRemLengths(
    messageViewOutlineMargin,
    messageViewAccountNameHeight,
);

export const messageViewNotMergedEditorOutlineMarginBottomPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        messageViewNotMergedOutlineMinHeightPx[spacingScale] -
        (convertRemLengthToPx(messageViewOutlineMargin, spacingScale) +
            convertRemLengthToPx(messageViewAccountNameHeight, spacingScale) +
            contentStyles.paragraphLineHeightPx[spacingScale]),
);

export const messageViewMinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        contentStyles.paragraphLineHeightPx[spacingScale] +
        convertRemLengthToPx(contentStyles.paragraphMargin, spacingScale),
);

export const messageViewParentFontSize = "75";

export const messageViewParentLineHeightPx = createObjectFromKeys(allSpacingScales, spacingScale =>
    Math.floor(
        fontSizesBySpacingScale[messageViewParentFontSize][spacingScale].fontSize *
            contentStyles.paragraphLineHeightMultiple,
    ),
);

export const messageViewParentAccountAvatarSize = assertSpacing(
    Math.round(
        parseInt(messageViewAccountAvatarSize, 10) *
            (fontSizesBySpacingScale[messageViewParentFontSize].small.fontSize /
                fontSizesBySpacingScale[contentStyles.paragraphActualFontSize].small.fontSize),
    ),
);

export const messageViewParentAvatarOffsetYRem =
    (parseRemLength(messageViewParentAccountAvatarSize) -
        parseRemLength(fontSizes[messageViewParentFontSize].lineHeight)) /
    -2;

export const messageViewTimestampDividerHeight = "4";
export const messageViewTimestampDividerMarginY = "2";

// Should be the same size as `messageViewAccountAvatarSize`.
export const messageInputEditorIconButtonSize = "md";

export const messageInputEditorIconButtonMarginX: Record<Platform, Spacing> = {
    desktop: "2",
    mobile: "1",
};

export const messageInputEditorIconButtonNegativeMarginX = mapObjectValues(
    messageInputEditorIconButtonMarginX,
    (spacing): `-${Spacing}` => `-${spacing}`,
);

export const messageInputEditorPaddingX = createObjectFromKeys(allPlatforms, platform =>
    addRemLengths(
        messageInputEditorIconButtonMarginX[platform],
        messageViewAccountAvatarSize,
        messageViewRailGap,
    ),
);

export const messageInputEditorPaddingYPx = createObjectFromKeys(allPlatforms, platform =>
    createObjectFromKeys(
        allSpacingScales,
        spacingScale =>
            (convertRemLengthToPx(
                addRemLengths(
                    messageInputEditorIconButtonMarginX[platform],
                    messageViewAccountAvatarSize,
                    messageInputEditorIconButtonMarginX[platform],
                ),
                spacingScale,
            ) -
                contentStyles.paragraphLineHeightPx[spacingScale]) /
            2,
    ),
);

export const messageInputEditorMinHeightPx = createObjectFromKeys(allPlatforms, platform =>
    createObjectFromKeys(
        allSpacingScales,
        spacingScale =>
            contentStyles.paragraphLineHeightPx[spacingScale] +
            messageInputEditorPaddingYPx[platform][spacingScale] * 2,
    ),
);

export const messageInputEditorBorderRadiusPx = createObjectFromKeys(allPlatforms, platform =>
    createObjectFromKeys(
        allSpacingScales,
        spacingScale => messageInputEditorMinHeightPx[platform][spacingScale] / 2,
    ),
);

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
                    messageInputEditorIconButtonMarginX[platform],
                ) === spacing[messageInputPaddingY[platform]],
        ),
    );
}

export const messageInputMinHeightPx = createObjectFromKeys(allPlatforms, platform =>
    createObjectFromKeys(
        allSpacingScales,
        spacingScale =>
            messageInputEditorMinHeightPx[platform][spacingScale] +
            convertRemLengthToPx(messageInputPaddingY[platform], spacingScale) * 2,
    ),
);

export const messageInputFilesOverflowGradientWidth = "2";

// Extra slop that extends beneath the bottom of the message input. This is
// always cut off on desktop. However, it matters in our native mobile app.
// When we animate the message input with the keyboard, their translations
// aren't perfectly in sync (even though the timing is in sync). So there are
// moments in the animation where the content may be revealed between the
// message input and the keyboard. To fix this, we just make them message input
// bigger so it can cover content below while animating. To debug this turn on
// slow animations in an iOS emulator and open the keyboard.
export const messageInputBottomBarBackgroundSlopBottom = spacing["96"];

export const messagingViewMarginBottomCalcExpression =
    "var(--safe-area-inset-bottom, 0px) - var(--window-safe-area-inset-bottom, 0px)";

export const messagingViewMarginBottom = `calc(${messagingViewMarginBottomCalcExpression})`;

export const messagingTypingIndicatorsMinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        convertRemLengthToPx(messageViewAccountNameHeight, spacingScale) +
        contentStyles.paragraphLineHeightPx[spacingScale],
);
