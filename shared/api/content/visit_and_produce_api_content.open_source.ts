import {Draft, produce} from "immer";
import {
    ApiContentVisitor,
    visitApiContent,
    visitApiContentBlockElement,
    visitApiContentInlineElements,
} from "~/shared/api/content/visit_api_content.open_source.js";
import {
    ApiContentBlockElementWithOptionalKeys,
    ApiContentWithOptionalKeys,
} from "~/shared/api/specification/types/api_content_response_with_optional_keys.open_source.js";
import {ApiReference} from "~/shared/api/specification/types/api_reference.open_source.js";
import {
    ApiContentBlockElementRequest,
    ApiContentInlineElementMark,
    ApiContentInlineElementRequest,
    ApiContentMentionInlineElementRequest,
    ApiContentPreviewBlockElementRequest,
    ApiContentRequest,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";

export type ApiContentDraftVisitor = {
    readonly visitBlockElement?: (
        element: Draft<ApiContentBlockElementRequest>,
        context: {elements: Draft<ReadonlyArray<ApiContentBlockElementRequest>>; index: number},
    ) => void;
    readonly visitInlineElement?: (
        element: Draft<ApiContentInlineElementRequest>,
        context: {
            elements: Draft<ReadonlyArray<ApiContentInlineElementRequest>>;
            index: number;
            // TODO: Replace this ad hoc flag with a `parent` or `parents` array once we have a
            // better idea of what callers need from this traversal.
            withinCodeBlockElement: boolean;
        },
    ) => void;
    readonly visitMark?: (
        mark: Draft<ApiContentInlineElementMark>,
        context: {marks: Draft<ReadonlyArray<ApiContentInlineElementMark>>; index: number},
    ) => void;
    readonly visitReference?: (
        reference: Draft<ApiReference>,
        context: {
            element:
                | Draft<ApiContentMentionInlineElementRequest>
                | Draft<ApiContentPreviewBlockElementRequest>;
        },
    ) => void;
};

export function visitAndProduceApiContent<Content extends ApiContentWithOptionalKeys>(
    content: Content,
    visitor: ApiContentDraftVisitor,
): Content {
    return produce(content, content => {
        visitApiContent(content as Draft<ApiContentRequest>, visitor as ApiContentVisitor);
    });
}

export function visitDraftApiContent(
    content: Draft<ApiContentRequest>,
    visitor: ApiContentDraftVisitor,
) {
    visitApiContent(content, visitor as ApiContentVisitor);
}

export function visitAndProduceApiContentBlockElement<
    Element extends ApiContentBlockElementWithOptionalKeys,
>(element: Element, visitor: ApiContentDraftVisitor): Element {
    return produce(element, element => {
        visitApiContentBlockElement(
            element as Draft<ApiContentBlockElementRequest>,
            visitor as ApiContentVisitor,
        );
    });
}

export function visitDraftApiContentBlockElement(
    element: Draft<ApiContentBlockElementRequest>,
    visitor: ApiContentDraftVisitor,
) {
    visitApiContentBlockElement(element, visitor as ApiContentVisitor);
}

export function visitAndProduceApiContentInlineElements<
    Element extends ApiContentInlineElementRequest,
>(elements: ReadonlyArray<Element>, visitor: ApiContentDraftVisitor): ReadonlyArray<Element> {
    return produce(elements, elements => {
        visitApiContentInlineElements(elements, visitor as ApiContentVisitor);
    });
}

export function visitDraftApiContentInlineElements(
    elements: Draft<ReadonlyArray<ApiContentInlineElementRequest>>,
    visitor: ApiContentDraftVisitor,
) {
    visitApiContentInlineElements(elements, visitor as ApiContentVisitor);
}
