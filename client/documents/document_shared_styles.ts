import {addRemLengths, spacing} from "~/shared/design/spacing";
import {messageInputMinHeight} from "~/shared/messaging/messaging_shared_styles";

export const documentCommentThreadPreviewHeaderHeight = spacing["10"];
export const documentCommentThreadPreviewHeightWithoutHeader = spacing["32"];
export const documentCommentThreadPreviewHeightWithHeader = addRemLengths(
    documentCommentThreadPreviewHeaderHeight,
    documentCommentThreadPreviewHeightWithoutHeader,
);

export const documentCommentInputMinHeight = messageInputMinHeight;
