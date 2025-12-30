import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export type ApiContentVisitor = {
    readonly visitBlockElement?: (
        element: ApiContentBlockElement,
        context: {elements: ReadonlyArray<ApiContentBlockElement>; index: number},
    ) => void;
    readonly visitInlineElement?: (
        element: ApiContentInlineElement,
        context: {elements: ReadonlyArray<ApiContentInlineElement>; index: number},
    ) => void;
    readonly visitInlineElementMark?: (
        mark: ApiContentInlineElementMark,
        context: {marks: ReadonlyArray<ApiContentInlineElementMark>; index: number},
    ) => void;
};

export function visitApiContent(content: ApiContent, visitor: ApiContentVisitor) {
    visitApiContentBlockElements(content.elements, visitor);
}

function visitApiContentBlockElements(
    elements: ReadonlyArray<ApiContentBlockElement>,
    visitor: ApiContentVisitor,
) {
    for (let index = 0; index < elements.length; index++) {
        const element = elements[index]!;
        visitor.visitBlockElement?.(element, {elements, index});
        visitApiContentBlockElement(element, visitor);
    }
}

function visitApiContentBlockElement(element: ApiContentBlockElement, visitor: ApiContentVisitor) {
    switch (element.type) {
        case "Paragraph": {
            visitApiContentInlineElements(element.elements, visitor);
            break;
        }
        case "UnorderedList":
        case "OrderedList":
        case "CheckList": {
            for (const item of element.items) {
                visitApiContentBlockElements(item.elements, visitor);

                if (item.nestedListElements !== undefined) {
                    visitApiContentBlockElements(item.nestedListElements, visitor);
                }
            }
            break;
        }
        case "Quote": {
            visitApiContentBlockElements(element.elements, visitor);
            break;
        }
        case "Heading": {
            visitApiContentInlineElements(element.elements, visitor);
            break;
        }
        case "Divider": {
            // Dividers don't have children. Nothing to visit here.
            break;
        }
        case "Table": {
            for (const row of element.rows) {
                for (const cell of row.cells) {
                    visitApiContentBlockElements(cell.elements, visitor);
                }
            }
            break;
        }
        case "Code": {
            for (const line of element.lines) {
                visitApiContentInlineElements(line.elements, visitor);
            }
            break;
        }
        default:
            throw exhaustive(element);
    }
}

function visitApiContentInlineElements(
    elements: ReadonlyArray<ApiContentInlineElement>,
    visitor: ApiContentVisitor,
) {
    for (let index = 0; index < elements.length; index++) {
        const element = elements[index]!;
        visitor.visitInlineElement?.(element, {elements, index});
        visitApiContentInlineElement(element, visitor);
    }
}

function visitApiContentInlineElement(
    element: ApiContentInlineElement,
    visitor: ApiContentVisitor,
) {
    if (element.marks !== undefined) {
        for (let index = 0; index < element.marks.length; index++) {
            const mark = element.marks[index]!;
            visitor.visitInlineElementMark?.(mark, {marks: element.marks, index});
        }
    }

    switch (element.type) {
        // Nothing more to visit in these elements.
        case "Text":
        case "Break":
        case "Mention":
            break;
        default:
            throw exhaustive(element);
    }
}
