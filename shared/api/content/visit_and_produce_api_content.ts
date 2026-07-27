import {Draft, produce} from "immer";
import {
    ApiContentVisitor,
    visitApiContent,
    visitApiContentBlockElement,
    visitApiContentInlineElements,
} from "~/shared/api/content/visit_api_content.js";
import {
    ApiContentBlockElementWithOptionalKeys,
    ApiContentWithOptionalKeys,
} from "~/shared/api/specification/types/api_content_response_with_optional_keys.js";
import {ApiReference} from "~/shared/api/specification/types/api_reference.js";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
    ApiContentMentionInlineElement,
    ApiContentPreviewBlockElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";

export type ApiContentDraftVisitor = {
    readonly visitBlockElement?: (
        element: Draft<ApiContentBlockElement>,
        context: {elements: Draft<ReadonlyArray<ApiContentBlockElement>>; index: number},
    ) => void;
    readonly visitInlineElement?: (
        element: Draft<ApiContentInlineElement>,
        context: {
            elements: Draft<ReadonlyArray<ApiContentInlineElement>>;
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
            element: Draft<ApiContentMentionInlineElement> | Draft<ApiContentPreviewBlockElement>;
        },
    ) => void;
};

export function visitAndProduceApiContent<Content extends ApiContentWithOptionalKeys>(
    content: Content,
    visitor: ApiContentDraftVisitor,
): Content {
    return produce(content, content => {
        visitApiContent(content as Draft<ApiContent>, visitor as ApiContentVisitor);
    });
}

export function visitDraftApiContent(content: Draft<ApiContent>, visitor: ApiContentDraftVisitor) {
    visitApiContent(content, visitor as ApiContentVisitor);
}

export function visitAndProduceApiContentBlockElement<
    Element extends ApiContentBlockElementWithOptionalKeys,
>(element: Element, visitor: ApiContentDraftVisitor): Element {
    return produce(element, element => {
        visitApiContentBlockElement(
            element as Draft<ApiContentBlockElement>,
            visitor as ApiContentVisitor,
        );
    });
}

export function visitDraftApiContentBlockElement(
    element: Draft<ApiContentBlockElement>,
    visitor: ApiContentDraftVisitor,
) {
    visitApiContentBlockElement(element, visitor as ApiContentVisitor);
}

export function visitAndProduceApiContentInlineElements<Element extends ApiContentInlineElement>(
    elements: ReadonlyArray<Element>,
    visitor: ApiContentDraftVisitor,
): ReadonlyArray<Element> {
    return produce(elements, elements => {
        visitApiContentInlineElements(elements, visitor as ApiContentVisitor);
    });
}

export function visitDraftApiContentInlineElements(
    elements: Draft<ReadonlyArray<ApiContentInlineElement>>,
    visitor: ApiContentDraftVisitor,
) {
    visitApiContentInlineElements(elements, visitor as ApiContentVisitor);
}
