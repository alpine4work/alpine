import {
    messageInputMinHeight,
    messageViewMinHeight,
} from "~/client/styles/messaging_shared_styles.js";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const documentCommentThreadPreviewHeight = "48";

export const documentCommentThreadListViewMaxWidth = "160";
export const documentCommentThreadActionsHeight = "7";
export const documentCommentThreadHeaderPaddingY = "5";

export const documentCommentThreadHeaderMinHeightWithoutPaddingTop = addRemLengths(
    spacing[documentCommentThreadActionsHeight],
    spacing[documentCommentThreadHeaderPaddingY],
    spacing[documentCommentThreadPreviewHeight],
    spacing[documentCommentThreadHeaderPaddingY],
);

export const documentCommentThreadHeaderMinHeight = addRemLengths(
    spacing[documentCommentThreadHeaderPaddingY],
    documentCommentThreadHeaderMinHeightWithoutPaddingTop,
);

export const documentCommentThreadCountAgainstLimit = mapObjectValues(
    messageInputMinHeight,
    messageInputMinHeight =>
        parseRemLengthNumber(
            addRemLengths(documentCommentThreadHeaderMinHeight, messageInputMinHeight),
        ) / parseRemLengthNumber(messageViewMinHeight),
);

export const documentContentEditorSidebarWidth = "96";
