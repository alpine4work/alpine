import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {
    messageInputMinHeight,
    messageViewMinHeight,
} from "~/shared/styles/messaging_shared_styles.js";

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
    messageViewMinHeight,
    (messageViewMinHeight, platform) =>
        parseRemLengthNumber(
            addRemLengths(documentCommentThreadHeaderMinHeight, messageInputMinHeight[platform]),
        ) / parseRemLengthNumber(messageViewMinHeight),
);
