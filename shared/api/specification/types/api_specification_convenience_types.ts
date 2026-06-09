import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";

export type ApiMessageRoomReference =
    ApiSpecification.components["schemas"]["MessageRoomReference"];

export type ApiAccountReference = ApiSpecification.components["schemas"]["AccountReference"];

export type ApiAccountReferenceResponse =
    ApiSpecification.components["schemas"]["AccountReference_Response"];

export type ApiChannelReference = ApiSpecification.components["schemas"]["ChannelReference"];

export type ApiChannelReferenceResponse =
    ApiSpecification.components["schemas"]["ChannelReference_Response"];

export type ApiChatReference = ApiSpecification.components["schemas"]["ChatReference"];

export type ApiChatReferenceResponse =
    ApiSpecification.components["schemas"]["ChatReference_Response"];

export type ApiPostReference = ApiSpecification.components["schemas"]["PostReference"];

export type ApiPostReferenceResponse =
    ApiSpecification.components["schemas"]["PostReference_Response"];

export type ApiTaskReference = ApiSpecification.components["schemas"]["TaskReference"];

export type ApiTaskReferenceResponse =
    ApiSpecification.components["schemas"]["TaskReference_Response"];

export type ApiMentionReference = ApiSpecification.components["schemas"]["MentionReference"];

export type ApiMentionReferenceResponse =
    ApiSpecification.components["schemas"]["MentionReference_Response"];

export type ApiContent = ApiSpecification.components["schemas"]["Content"];

export type ApiContentResponse = ApiSpecification.components["schemas"]["Content_Response"];

export type ApiContentBlockElement = ApiSpecification.components["schemas"]["ContentBlockElement"];

export type ApiContentBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentBlockElement_Response"];

export type ApiContentParagraphBlockElement =
    ApiSpecification.components["schemas"]["ContentParagraphBlockElement"];

export type ApiContentParagraphBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentParagraphBlockElement_Response"];

export type ApiContentUnorderedListBlockElement =
    ApiSpecification.components["schemas"]["ContentUnorderedListBlockElement"];

export type ApiContentUnorderedListBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentUnorderedListBlockElement_Response"];

export type ApiContentOrderedListBlockElement =
    ApiSpecification.components["schemas"]["ContentOrderedListBlockElement"];

export type ApiContentOrderedListBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentOrderedListBlockElement_Response"];

export type ApiContentCheckListBlockElement =
    ApiSpecification.components["schemas"]["ContentCheckListBlockElement"];

export type ApiContentCheckListBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentCheckListBlockElement_Response"];

export type ApiContentListBlockElement =
    ApiSpecification.components["schemas"]["ContentListBlockElement"];

export type ApiContentListBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentListBlockElement_Response"];

export type ApiContentListBlockElementItem =
    ApiSpecification.components["schemas"]["ContentListBlockElementItem"] & {checked?: undefined};

export type ApiContentListBlockElementItemResponse =
    ApiSpecification.components["schemas"]["ContentListBlockElementItem_Response"];

export type ApiContentCheckListBlockElementItem =
    ApiSpecification.components["schemas"]["ContentCheckListBlockElementItem"];

export type ApiContentCheckListBlockElementItemResponse =
    ApiSpecification.components["schemas"]["ContentCheckListBlockElementItem_Response"];

export type ApiContentQuoteBlockElement =
    ApiSpecification.components["schemas"]["ContentQuoteBlockElement"];

export type ApiContentQuoteBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentQuoteBlockElement_Response"];

export type ApiContentQuoteBlockElementBlockElement =
    ApiSpecification.components["schemas"]["ContentQuoteBlockElementBlockElement"];

export type ApiContentQuoteBlockElementBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentQuoteBlockElementBlockElement_Response"];

export type ApiContentHeadingBlockElement =
    ApiSpecification.components["schemas"]["ContentHeadingBlockElement"];

export type ApiContentHeadingBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentHeadingBlockElement_Response"];

export type ApiContentDividerBlockElement =
    ApiSpecification.components["schemas"]["ContentDividerBlockElement"];

export type ApiContentTableBlockElement =
    ApiSpecification.components["schemas"]["ContentTableBlockElement"];

export type ApiContentTableBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentTableBlockElement_Response"];

export type ApiContentTableBlockElementRowResponse =
    ApiSpecification.components["schemas"]["ContentTableBlockElementRow_Response"];

export type ApiContentTableBlockElementCell =
    ApiSpecification.components["schemas"]["ContentTableBlockElementCell"];

export type ApiContentTableBlockElementCellResponse =
    ApiSpecification.components["schemas"]["ContentTableBlockElementCell_Response"];

export type ApiContentTableBlockElementCellBlockElement =
    ApiSpecification.components["schemas"]["ContentTableBlockElementCellBlockElement"];

export type ApiContentTableBlockElementCellBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentTableBlockElementCellBlockElement_Response"];

export type ApiContentCodeBlockElement =
    ApiSpecification.components["schemas"]["ContentCodeBlockElement"];

export type ApiContentCodeBlockElementTextInlineElement =
    ApiSpecification.components["schemas"]["ContentCodeBlockElementTextInlineElement"];

export type ApiContentCodeBlockElementTextInlineElementMark =
    ApiSpecification.components["schemas"]["ContentCodeBlockElementTextInlineElementMark"];

export type ApiContentFileBlockElement =
    ApiSpecification.components["schemas"]["ContentFileBlockElement"];

export type ApiContentFileBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentFileBlockElement_Response"];

export type ApiContentPreviewBlockElement =
    ApiSpecification.components["schemas"]["ContentPreviewBlockElement"];

export type ApiContentPreviewBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentPreviewBlockElement_Response"];

export type ApiContentFileGalleryBlockElement =
    ApiSpecification.components["schemas"]["ContentFileGalleryBlockElement"];

export type ApiContentFileGalleryBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentFileGalleryBlockElement_Response"];

export type ApiContentFileGalleryBlockElementRow =
    ApiSpecification.components["schemas"]["ContentFileGalleryBlockElementRow"];

export type ApiContentFileGalleryBlockElementRowResponse =
    ApiSpecification.components["schemas"]["ContentFileGalleryBlockElementRow_Response"];

export type ApiContentFileGalleryBlockElementRowItem =
    ApiSpecification.components["schemas"]["ContentFileGalleryBlockElementRowItem"];

export type ApiContentFileGalleryBlockElementRowItemResponse =
    ApiSpecification.components["schemas"]["ContentFileGalleryBlockElementRowItem_Response"];

export type ApiContentFileFloatBlockElement =
    ApiSpecification.components["schemas"]["ContentFileFloatBlockElement"];

export type ApiContentFileFloatBlockElementResponse =
    ApiSpecification.components["schemas"]["ContentFileFloatBlockElement_Response"];

export type ApiPreviewReference = ApiSpecification.components["schemas"]["PreviewReference"];

export type ApiPreviewReferenceResponse =
    ApiSpecification.components["schemas"]["PreviewReference_Response"];

export type ApiContentInlineElement =
    ApiSpecification.components["schemas"]["ContentInlineElement"];

export type ApiContentInlineElementResponse =
    ApiSpecification.components["schemas"]["ContentInlineElement_Response"];

export type ApiContentTextInlineElement =
    ApiSpecification.components["schemas"]["ContentTextInlineElement"];

export type ApiContentBreakInlineElement =
    ApiSpecification.components["schemas"]["ContentBreakInlineElement"];

export type ApiContentMentionInlineElement =
    ApiSpecification.components["schemas"]["ContentMentionInlineElement"];

export type ApiContentMentionInlineElementResponse =
    ApiSpecification.components["schemas"]["ContentMentionInlineElement_Response"];

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

export type ApiChat = ApiSpecification.components["schemas"]["Chat"];

export type ApiDirectChat = ApiSpecification.components["schemas"]["DirectChat"];

export type ApiRoomChat = ApiSpecification.components["schemas"]["RoomChat"];

export type ApiDocumentThreadResponse =
    ApiSpecification.components["schemas"]["DocumentThread_Response"];

export type ApiTask = ApiSpecification.components["schemas"]["Task"];

export type ApiTaskResponse = ApiSpecification.components["schemas"]["Task_Response"];

export type ApiMessageResponse = ApiSpecification.components["schemas"]["Message_Response"];

export type ApiPostResponse = ApiSpecification.components["schemas"]["Post_Response"];

export type ApiMessagePayloadResponse =
    ApiSpecification.components["schemas"]["MessagePayload_Response"];

export type ApiMessageContentPayloadResponse =
    ApiSpecification.components["schemas"]["MessageContentPayload_Response"];

export type ApiMessageContentPayloadParent =
    ApiSpecification.components["schemas"]["MessageContentPayloadParent"];

export type ApiMessageContentPayloadParentResponse =
    ApiSpecification.components["schemas"]["MessageContentPayloadParent_Response"];

export type ApiMessageContentPayloadParentContentSnippet =
    ApiSpecification.components["schemas"]["MessageContentPayloadParentContentSnippet"];

export type ApiMessageContentPayloadParentContentSnippetTextInlineElement =
    ApiSpecification.components["schemas"]["MessageContentPayloadParentContentSnippetTextInlineElement"];

export type ApiMessageContentPayloadParentContentSnippetInlineElementMark =
    ApiSpecification.components["schemas"]["MessageContentPayloadParentContentSnippetInlineElementMark"];

export type ApiMessageStreamPartPayload =
    ApiSpecification.components["schemas"]["MessageStreamPartPayload"];

export type ApiMessageStreamPartPayloadResponse =
    ApiSpecification.components["schemas"]["MessageStreamPartPayload_Response"];

export type ApiMessageStreamContentPartPayload =
    ApiSpecification.components["schemas"]["MessageStreamContentPartPayload"];

export type ApiMessageStreamContentPartPayloadResponse =
    ApiSpecification.components["schemas"]["MessageStreamContentPartPayload_Response"];

export type ApiMessageStreamToolCallPartPayloadCall =
    ApiSpecification.components["schemas"]["MessageStreamToolCallPartPayloadCall"];

export type ApiSearchResult = ApiSpecification.components["schemas"]["SearchResult"];

export type ApiSearchTaskMessageResult =
    ApiSpecification.components["schemas"]["SearchTaskMessageResult"];

export type ApiSearchPostMessageResult =
    ApiSpecification.components["schemas"]["SearchPostMessageResult"];

export type ApiSearchDocumentMessageResult =
    ApiSpecification.components["schemas"]["SearchDocumentMessageResult"];

export type ApiSearchChatMessageResult =
    ApiSpecification.components["schemas"]["SearchChatMessageResult"];

export type ApiSearchResultBodyMatch =
    ApiSpecification.components["schemas"]["SearchResultBodyMatch"];

export type ApiSearchResultParsedFilter =
    ApiSpecification.components["schemas"]["SearchResultParsedFilter"];

export type ApiSearchResultBodyMatchItem = ApiSearchResultBodyMatch[number];

export type ApiErrorResponseBody =
    ApiSpecification.components["responses"]["Error"]["content"]["application/json"];

export type ApiBotWebhookRequestBody =
    ApiSpecification.webhooks["bot"]["post"]["requestBody"]["content"]["application/json"];

export type ApiBotWebhookEvent = ApiBotWebhookRequestBody["event"];

export type ApiBotWebhookCreatedMessageEvent =
    ApiSpecification.components["schemas"]["BotWebhookCreatedMessageEvent"];

export type ApiBotWebhookCreatedMessageEventParent =
    ApiSpecification.components["schemas"]["BotWebhookCreatedMessageEventParent"];

export type ApiBotWebhookCreatedMessageEventMessageParent =
    ApiSpecification.components["schemas"]["BotWebhookCreatedMessageEventMessageParent"];

export type ApiBotWebhookCreatedMessageEventPostParent =
    ApiSpecification.components["schemas"]["BotWebhookCreatedMessageEventPostParent"];

export type ApiTaskWithoutContent = ApiSpecification.components["schemas"]["TaskWithoutContent"];

export type ApiTaskStatus = ApiSpecification.components["schemas"]["TaskStatus"];

export type ApiTaskCollection = ApiSpecification.components["schemas"]["TaskCollection"];

export type ApiMessageStreamToolCallPartCreateCallReference =
    ApiSpecification.components["schemas"]["MessageStreamToolCallPartCreateCallReference"];

export type ApiMessageStreamToolCallPartCreateCallReferenceResponse =
    ApiSpecification.components["schemas"]["MessageStreamToolCallPartCreateCallReference_Response"];

export type ApiGetDocumentResponse =
    ApiSpecification.components["responses"]["GetDocument"]["content"]["application/json"];

export type ApiCreateDocumentRequestBody =
    ApiSpecification.paths["/documents"]["post"]["requestBody"]["content"]["application/json"];
