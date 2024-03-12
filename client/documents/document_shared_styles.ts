import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {
    messageInputMinHeight,
    messageViewMinHeight,
} from "~/shared/messaging/messaging_shared_styles.js";

export const documentCommentThreadPreviewMinHeight = spacing["48"];
export const documentCommentInputMinHeight = messageInputMinHeight;

export const documentCommentThreadActionsHeight = "7";

export const documentCommentThreadHeaderPaddingY = "5";

export const documentCommentThreadHeaderMinHeightWithoutPaddingTop = addRemLengths(
    spacing[documentCommentThreadActionsHeight],
    spacing[documentCommentThreadHeaderPaddingY],
    documentCommentThreadPreviewMinHeight,
    spacing[documentCommentThreadHeaderPaddingY],
);

export const documentCommentThreadHeaderMinHeight = addRemLengths(
    spacing[documentCommentThreadHeaderPaddingY],
    documentCommentThreadHeaderMinHeightWithoutPaddingTop,
);

export const documentCommentThreadCountAgainstLimit =
    parseRemLengthNumber(
        addRemLengths(documentCommentThreadHeaderMinHeight, messageInputMinHeight),
    ) / parseRemLengthNumber(messageViewMinHeight);
