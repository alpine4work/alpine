import {ApiSpecification} from "~/server/api/specification/types/api_specification_types.js";

export type ApiMessageRoomPath = ApiSpecification.components["schemas"]["MessageRoomPath"];

export type ApiContentMentionInlineElementTargetPath =
    ApiSpecification.components["schemas"]["ContentMentionInlineElementTargetPath"];

export type ApiContent = ApiSpecification.components["schemas"]["Content"];

export type ApiContentBlockElement = ApiSpecification.components["schemas"]["ContentBlockElement"];

export type ApiContentParagraphBlockElement =
    ApiSpecification.components["schemas"]["ContentParagraphBlockElement"];

export type ApiContentUnorderedListBlockElement =
    ApiSpecification.components["schemas"]["ContentUnorderedListBlockElement"];

export type ApiContentOrderedListBlockElement =
    ApiSpecification.components["schemas"]["ContentOrderedListBlockElement"];

export type ApiContentListBlockElement =
    ApiSpecification.components["schemas"]["ContentListBlockElement"];

export type ApiContentListBlockElementItem =
    ApiSpecification.components["schemas"]["ContentListBlockElementItem"];

export type ApiContentQuoteBlockElement =
    ApiSpecification.components["schemas"]["ContentQuoteBlockElement"];

export type ApiContentQuoteBlockElementBlockElement =
    ApiSpecification.components["schemas"]["ContentQuoteBlockElementBlockElement"];

export type ApiContentHeadingBlockElement =
    ApiSpecification.components["schemas"]["ContentHeadingBlockElement"];

export type ApiContentDividerBlockElement =
    ApiSpecification.components["schemas"]["ContentDividerBlockElement"];

export type ApiContentTableBlockElement =
    ApiSpecification.components["schemas"]["ContentTableBlockElement"];

export type ApiContentTableBlockElementRow =
    ApiSpecification.components["schemas"]["ContentTableBlockElementRow"];

export type ApiContentTableBlockElementCell =
    ApiSpecification.components["schemas"]["ContentTableBlockElementCell"];

export type ApiContentTableBlockElementCellBlockElement =
    ApiSpecification.components["schemas"]["ContentTableBlockElementCellBlockElement"];

export type ApiContentCodeBlockElement =
    ApiSpecification.components["schemas"]["ContentCodeBlockElement"];

export type ApiContentCodeBlockElementTextInlineElement =
    ApiSpecification.components["schemas"]["ContentCodeBlockElementTextInlineElement"];

export type ApiContentCodeBlockElementTextInlineElementMark =
    ApiSpecification.components["schemas"]["ContentCodeBlockElementTextInlineElementMark"];

export type ApiContentInlineElement =
    ApiSpecification.components["schemas"]["ContentInlineElement"];

export type ApiContentTextInlineElement =
    ApiSpecification.components["schemas"]["ContentTextInlineElement"];

export type ApiContentBreakInlineElement =
    ApiSpecification.components["schemas"]["ContentBreakInlineElement"];

export type ApiContentMentionInlineElement =
    ApiSpecification.components["schemas"]["ContentMentionInlineElement"];

export type ApiContentInlineElementMark =
    ApiSpecification.components["schemas"]["ContentInlineElementMark"];

export type ApiContentInlineElementCodeMark =
    ApiSpecification.components["schemas"]["ContentInlineElementCodeMark"];

export type ApiContentInlineElementLinkMark =
    ApiSpecification.components["schemas"]["ContentInlineElementLinkMark"];

export type ApiContentInlineElementHighlightMark =
    ApiSpecification.components["schemas"]["ContentInlineElementHighlightMark"];

export type ApiContentInlineElementHighlightMarkColor =
    ApiSpecification.components["schemas"]["ContentInlineElementHighlightMarkColor"];

export type ApiContentInlineElementCommentMark =
    ApiSpecification.components["schemas"]["ContentInlineElementCommentMark"];

export type ApiAccount = ApiSpecification.components["schemas"]["Account"];

export type ApiAccountWithoutSpace = ApiSpecification.components["schemas"]["AccountWithoutSpace"];

export type ApiTask = ApiSpecification.components["schemas"]["Task"];

export type ApiMessage = ApiSpecification.components["schemas"]["Message"];

export type ApiMessagePayload = ApiSpecification.components["schemas"]["MessagePayload"];

export type ApiErrorResponseBody =
    ApiSpecification.components["responses"]["Error"]["content"]["application/json"];

export type ApiBotWebhookRequestBody =
    ApiSpecification.webhooks["bot"]["post"]["requestBody"]["content"]["application/json"];

export type ApiBotWebhookEvent = ApiBotWebhookRequestBody["event"];
