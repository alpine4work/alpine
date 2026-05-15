import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
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
        const context = {elements, index};
        visitor.visitBlockElement?.(element, context);
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
        case "File":
        case "Preview": {
            // File/Preview don't contain children that need visiting.
            break;
        }
        case "FileGallery": {
            for (const row of element.rows) {
                const elements = row.items.map(
                    i => i.element,
                ) as ReadonlyArray<ApiContentBlockElement>;

                for (let itemIndex = 0; itemIndex < row.items.length; itemIndex++) {
                    const item = assertExists(row.items[itemIndex]);
                    const context = {elements, index: itemIndex};

                    visitor.visitBlockElement?.(item.element, context);

                    // HACK: `visitAndProduceApiContent` uses immer, which means in-place property
                    // mutations on the element work automatically. But if a visitor _replaces_ the
                    // element by assigning to `context.elements[index]`, we need to propagate that
                    // back into the parent `row.items` array manually because the `elements` array we
                    // built above is a snapshot, not a live reference into the tree.
                    if (context.elements[itemIndex] !== item.element) {
                        (item as {element: ApiContentBlockElement}).element =
                            context.elements[itemIndex]!;
                    }
                }
            }
            break;
        }
        case "FileFloat": {
            // HACK: `visitAndProduceApiContent` uses immer, which means in-place property
            // mutations on the element work automatically. But if a visitor _replaces_ the
            // element by assigning to `context.elements[0]`, we need to propagate that back
            // into the parent `FileFloat` manually because the `elements` array we build here
            // is a snapshot, not a live reference into the tree.
            const context = {
                elements: [element.element] as ReadonlyArray<ApiContentBlockElement>,
                index: 0,
            };

            visitor.visitBlockElement?.(element.element, context);
            assert(context.elements.length === 1, "`FileFloat` can only have one child");

            if (context.elements[0] !== element.element) {
                (element as {element: ApiContentBlockElement}).element = context.elements[0]!;
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
