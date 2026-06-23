import {Draft, produce} from "immer";

import {
    type ApiContentInlineElementVisitorContext,
    ApiContentVisitor,
    visitApiContent,
} from "~/shared/api/content/visit_api_content.js";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";

export type ApiContentDraftVisitor = {
    readonly visitBlockElement?: (
        element: Draft<ApiContentBlockElement>,
        context: {elements: Draft<ReadonlyArray<ApiContentBlockElement>>; index: number},
    ) => void;
    readonly visitInlineElement?: (
        element: Draft<ApiContentInlineElement>,
        context: ApiContentInlineElementVisitorContext<
            Draft<ReadonlyArray<ApiContentInlineElement>>
        >,
    ) => void;
    readonly visitInlineElementMark?: (
        mark: Draft<ApiContentInlineElementMark>,
        context: {marks: Draft<ReadonlyArray<ApiContentInlineElementMark>>; index: number},
    ) => void;
};

export function visitAndProduceApiContent<Content extends ApiContent>(
    content: Content,
    visitor: ApiContentDraftVisitor,
): Content {
    return produce(content, content => {
        visitApiContent(content, visitor as ApiContentVisitor);
    });
}

export function visitDraftApiContent(content: Draft<ApiContent>, visitor: ApiContentDraftVisitor) {
    visitApiContent(content, visitor as ApiContentVisitor);
}
