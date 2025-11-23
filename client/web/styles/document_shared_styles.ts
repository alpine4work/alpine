import {
    messageInputMinHeightPx,
    messageViewMinHeightPx,
} from "~/client/web/styles/messaging_shared_styles.js";
import {allPlatforms} from "~/shared/design/core/platform.js";
import {addRemLengths, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {allSpacingScales} from "~/shared/design/core/spacing_scale.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";

export const documentCommentThreadPreviewHeight = "48";

export const documentCommentThreadActionsHeight = "7";
export const documentCommentThreadHeaderPaddingY = "5";

export const documentCommentThreadHeaderMinHeightWithoutPaddingTop = addRemLengths(
    documentCommentThreadActionsHeight,
    documentCommentThreadHeaderPaddingY,
    documentCommentThreadPreviewHeight,
    documentCommentThreadHeaderPaddingY,
);

export const documentCommentThreadHeaderMinHeight = addRemLengths(
    documentCommentThreadHeaderPaddingY,
    documentCommentThreadHeaderMinHeightWithoutPaddingTop,
);

export const documentCommentThreadCountAgainstLimit = createObjectFromKeys(allPlatforms, platform =>
    createObjectFromKeys(
        allSpacingScales,
        spacingScale =>
            (convertRemLengthToPx(documentCommentThreadHeaderMinHeight, spacingScale) +
                messageInputMinHeightPx[platform][spacingScale]) /
            messageViewMinHeightPx[spacingScale],
    ),
);

export const documentContentEditorSidebarWidth = "96";
