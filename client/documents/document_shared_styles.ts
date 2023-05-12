import {messageViewMinHeight} from "~/client/messaging/message_view";
import {Spacing, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {messageInputMinHeight} from "~/shared/messaging/messaging_shared_styles";

export const documentCommentThreadPreviewHeight = spacing["32"];
export const documentCommentInputMinHeight = messageInputMinHeight;

// We want our Y margin to be the same as our X margin. We want to give items
// some margin top and some margin bottom so that the shadows don't overflow.
export const documentCommentThreadListViewMarginTop: Spacing = "2";
export const documentCommentThreadListViewMarginBottom: Spacing = "2";
export const documentCommentThreadListViewMarginY: Spacing = "4";

const documentCommentThreadHeightWithoutComments = addRemLengths(
    documentCommentThreadPreviewHeight,
    documentCommentInputMinHeight,
    spacing[documentCommentThreadListViewMarginY],
);

export const documentCommentThreadCountAgainstLimit =
    parseRemLengthNumber(documentCommentThreadHeightWithoutComments) /
    parseRemLengthNumber(messageViewMinHeight);
