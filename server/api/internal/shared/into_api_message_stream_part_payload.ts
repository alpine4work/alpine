import {
    intoApiContentWithReferences,
    intoApiMessageContentWithReferences,
} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {parseApiMentionReference} from "~/shared/api/specification/parse_api_path.js";
import {
    ApiContentBlockElementResponseWithoutKeys,
    ApiContentInlineElementMark,
    ApiContentParagraphBlockElementResponseWithoutKeys,
    ApiLabelContentInlineElementMark,
    ApiLabelContentInlineElementResponse,
    ApiLabelContentResponse,
    ApiMentionReferenceResponse,
    ApiMessageExperimentalApprovalDecisionOptionResponse,
    ApiMessageExperimentalApprovalResponse,
    ApiMessageStreamPartPayloadResponse,
    ApiMessageStreamToolCallPartCreateCallReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {
    MessageExperimentalApproval,
    MessageExperimentalApprovalDecisionOption,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";

export async function intoApiMessageStreamPartPayload(
    context: ServerAccountActionContext,
    {
        spaceId,
        payload,
        contentKeyEncoder,
        posOffset,
    }: {
        spaceId: SpaceId;
        payload: MessageStreamPartPayload;
        contentKeyEncoder: ApiContentKeyEncoder;
        posOffset?: number;
    },
): Promise<ApiMessageStreamPartPayloadResponse> {
    switch (payload.type) {
        case "ToolCall": {
            switch (payload.call.type) {
                case "Read": {
                    return {
                        type: "ToolCall",
                        call: {
                            type: "Read",
                            // TODO(ifitzsimmons, 2026-01-26): This is what we were doing before, just within
                            // `printApiMentionReferenceResponse`. This is not type safe and I'm not really
                            // sure how this working before. For example, tasks require the task status in the
                            // response, but that's not available on the `targetPath`. I would expect this to
                            // break any time we try to return this response via the API.
                            reference: parseApiMentionReference(
                                payload.call.targetPath,
                            ) as ApiMentionReferenceResponse,
                        },
                    };
                }
                case "Search": {
                    return {
                        type: "ToolCall",
                        call: {
                            type: "Search",
                            query: payload.call.query,
                        },
                    };
                }
                case "Create": {
                    return {
                        type: "ToolCall",
                        call: {
                            type: "Create",
                            // TODO(ifitzsimmons, 2026-01-26): This is not type safe. For example, tasks
                            // require the task status in the response, but that's not available on the target
                            // I would expect this to break any time we try to return this response via the
                            // API.
                            reference: payload.call
                                .target as ApiMessageStreamToolCallPartCreateCallReferenceResponse,
                        },
                    };
                }
                default:
                    throw exhaustive(payload.call);
            }
        }
        case "Content": {
            const content = await intoApiMessageContentWithReferences(context, {
                spaceId,
                content: payload.content,
                contentKeyEncoder,
                posOffset,
            });
            return {type: "Content", content};
        }
        case "Reasoning": {
            const content = await intoApiMessageContentWithReferences(context, {
                spaceId,
                content: payload.content,
                contentKeyEncoder,
                posOffset,
            });
            return {type: "Reasoning", content};
        }
        case "ExperimentalApprovals": {
            return {
                type: "ExperimentalApprovals",
                approvals: await runAllPromises(
                    payload.approvals.map(approval =>
                        intoApiMessageExperimentalApproval(context, {
                            spaceId,
                            approval,
                        }),
                    ),
                ),
            };
        }
        default:
            throw exhaustive(payload);
    }
}

export async function intoApiMessageExperimentalApproval(
    context: ServerAccountActionContext,
    {
        spaceId,
        approval,
    }: {
        spaceId: SpaceId;
        approval: MessageExperimentalApproval;
    },
): Promise<ApiMessageExperimentalApprovalResponse> {
    return {
        summary: await intoApiMessageExperimentalApprovalSummary(context, {
            spaceId,
            content: approval.summary,
        }),
        decision: {
            schema: {
                options: await runAllPromises(
                    approval.decision.schema.options.map(option =>
                        intoApiMessageExperimentalApprovalDecisionOption(context, {
                            spaceId,
                            option,
                        }),
                    ),
                ),
            },
            value: approval.decision.value,
        },
    };
}

async function intoApiMessageExperimentalApprovalDecisionOption(
    context: ServerAccountActionContext,
    {
        spaceId,
        option,
    }: {
        spaceId: SpaceId;
        option: MessageExperimentalApprovalDecisionOption;
    },
): Promise<ApiMessageExperimentalApprovalDecisionOptionResponse> {
    switch (option.type) {
        case "Approved":
        case "Rejected":
            return option;
        case "ApprovedForSession":
            return {
                ...option,
                summary: option.summary
                    ? await intoApiMessageExperimentalApprovalSummary(context, {
                          spaceId,
                          content: option.summary,
                      })
                    : undefined,
            };
        default:
            throw exhaustive(option);
    }
}

async function intoApiMessageExperimentalApprovalSummary(
    context: ServerAccountActionContext,
    {
        spaceId,
        content,
    }: {
        spaceId: SpaceId;
        content: MessageContent;
    },
): Promise<ApiLabelContentResponse> {
    const apiContent = await intoApiContentWithReferences(context, {
        spaceId,
        content,
        contentKeyEncoder: null,
        fileAuthorizer: "AssertHasNoFiles",
    });

    const apiLabelContentElements = flatMapIterable(apiContent.elements, element =>
        intoApiLabelContent(element),
    );

    return {
        elements: Array.from(apiLabelContentElements),
    };
}

function* intoApiLabelContent(
    element: ApiContentBlockElementResponseWithoutKeys,
): IterableIterator<ApiLabelContentInlineElementResponse> {
    switch (element.type) {
        case "Paragraph": {
            yield* intoApiLabelContentInlineElement(element);
            break;
        }
        case "UnorderedList":
        case "OrderedList":
        case "CheckList":
        case "Quote":
        case "Heading":
        case "Divider":
        case "Code":
        case "File":
        case "FileGallery":
        case "FileFloat":
        case "Preview":
        case "Table":
            throw new InvalidArgumentError(
                quote`Block element ${element.type} is not allowed in the ApiLabelContent elements`,
            );
        default:
            throw exhaustive(element);
    }
}

function* intoApiLabelContentInlineElement(
    element: ApiContentParagraphBlockElementResponseWithoutKeys,
): IterableIterator<ApiLabelContentInlineElementResponse> {
    for (const inlineElement of element.elements) {
        switch (inlineElement.type) {
            case "Text": {
                yield {
                    type: "Text",
                    text: inlineElement.text,
                    marks: intoApiLabelContentInlineElementMarks(inlineElement.marks),
                };
                break;
            }
            case "Mention": {
                yield {
                    type: "Mention",
                    reference: inlineElement.reference,
                    isAccountShortName: inlineElement.isAccountShortName,
                };
                break;
            }
            case "Break":
                throw new InvalidArgumentError(
                    quote`Breaks are not allowed in the ApiLabelContent`,
                );
            default:
                throw exhaustive(inlineElement);
        }
    }
}

function intoApiLabelContentInlineElementMarks(
    marks: ReadonlyArray<ApiContentInlineElementMark> | undefined,
): ReadonlyArray<ApiLabelContentInlineElementMark> | undefined {
    if (marks === undefined) return undefined;

    return marks.filter((mark): mark is ApiLabelContentInlineElementMark => {
        switch (mark.type) {
            case "Italic":
            case "Code":
                return true;
            case "Bold":
            case "Strike":
            case "Link":
            case "Highlight":
            case "Comment":
                throw new InvalidArgumentError(
                    quote`Mark ${mark.type} is not allowed in the ApiLabelContent`,
                );
            default:
                throw exhaustive(mark);
        }
    });
}
