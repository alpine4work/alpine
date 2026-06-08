import {Draft, castDraft, produce} from "immer";
import {assertApiChecklistBlockElementItem} from "~/shared/api/markdown/assert_api_checklist_block_element_item.js";
import {
    ApiReferenceKey,
    printApiReferenceKey,
} from "~/shared/api/specification/api_reference_key.js";
import {ApiReference} from "~/shared/api/specification/types/api_reference.js";
import {ApiReferenceResponse} from "~/shared/api/specification/types/api_reference_response.js";
import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentFileBlockElementResponse,
    ApiContentFileGalleryBlockElement,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
    ApiMentionReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {FileId} from "~/shared/id/types/id_types.js";

/**
 * If two `ApiContent` objects normalize to the same object (based on an
 * `isDeepEqual()` check) then the two `ApiContent`s are considered to be
 * equivalent.
 */
export function normalizeApiContent(content: ApiContent): ApiContent {
    return produce(content, normalizeDraftApiContent);
}

export function normalizeDraftApiContent(content: Draft<ApiContent>) {
    ApiContentNormalizer.with(normalizer => {
        normalizer.normalize(content);
    });
}

export function normalizeApiContentBlockElement(
    element: ApiContentBlockElement,
): ApiContentBlockElement {
    return produce(element, element => {
        ApiContentNormalizer.with(normalizer => {
            normalizer.normalizeBlockElement(element);
        });
    });
}

export function normalizeApiContentInlineElements(
    elements: ReadonlyArray<ApiContentInlineElement>,
): ReadonlyArray<ApiContentInlineElement> {
    return produce(elements, elements => {
        ApiContentNormalizer.with(normalizer => {
            normalizer.normalizeInlineElements(elements);
        });
    });
}

export function normalizeApiReference(reference: ApiMentionReference): ApiMentionReference {
    return produce(reference, reference => {
        ApiContentNormalizer.with(normalizer => {
            normalizer.normalizeReference(reference);
        });
    });
}

export class ApiContentNormalizer {
    #isDestroyed = false;

    #response: {
        referencesByKey: DefaultMap<ApiReferenceKey, Array<Draft<ApiReferenceResponse>>>;
        fileElementsById: DefaultMap<FileId, Array<Draft<ApiContentFileBlockElementResponse>>>;
    } | null;

    #withinTableElement = false;
    #withDummyFileGalleryElementLayout: boolean;

    private constructor({
        isResponse,
        withDummyFileGalleryElementLayout,
    }: {
        isResponse: boolean;
        withDummyFileGalleryElementLayout: boolean;
    }) {
        this.#response = isResponse
            ? {
                  referencesByKey: new DefaultMap(() => []),
                  fileElementsById: new DefaultMap(() => []),
              }
            : null;

        this.#withDummyFileGalleryElementLayout = withDummyFileGalleryElementLayout;
    }

    static with<Value>(
        action: (normalizer: ApiContentNormalizer) => Value,
        {
            isResponse = false,
            withDummyFileGalleryElementLayout = false,
        }: {
            isResponse?: boolean;
            withDummyFileGalleryElementLayout?: boolean;
        } = {},
    ): Value {
        const normalizer = new ApiContentNormalizer({
            isResponse,
            withDummyFileGalleryElementLayout,
        });

        try {
            const value = action(normalizer);
            return value;
        } finally {
            normalizer.#isDestroyed = true;
        }
    }

    normalize(content: Draft<ApiContent>) {
        this.normalizeBlockElements(content.elements);
    }

    normalizeBlockElements(elements: Draft<ReadonlyArray<ApiContentBlockElement>>) {
        let index = 0;
        while (index < elements.length) {
            const element = elements[index]!;

            // Remove empty unordered and ordered lists.
            if (
                (element.type === "UnorderedList" ||
                    element.type === "OrderedList" ||
                    element.type === "CheckList") &&
                element.items.length === 0
            ) {
                elements.splice(index, 1);

                // After removing an element, the previous element may now be adjacent to a
                // file-like element it should merge with. Back up so we re-check.
                if (index > 0) {
                    const prev = elements[index - 1]!;
                    if (
                        prev.type === "File" ||
                        prev.type === "Preview" ||
                        prev.type === "FileGallery"
                    ) {
                        index--;
                    }
                }
                continue;
            }

            // Merge adjacent lists of the same type.
            if (
                element.type === "UnorderedList" ||
                element.type === "OrderedList" ||
                element.type === "CheckList"
            ) {
                while (index < elements.length - 1) {
                    const nextElement = elements[index + 1]!;

                    if (
                        nextElement.type !== "UnorderedList" &&
                        nextElement.type !== "OrderedList" &&
                        nextElement.type !== "CheckList"
                    ) {
                        break;
                    }

                    // Remove empty unordered and ordered lists in between lists of the same type we
                    // want to merge.
                    if (nextElement.items.length === 0) {
                        elements.splice(index + 1, 1);
                        continue;
                    }

                    if (element.type !== nextElement.type) {
                        break;
                    }

                    // Don't merge ordered lists if the next ordered list has a custom order start.
                    if (
                        nextElement.type === "OrderedList" &&
                        nextElement.orderStart !== undefined
                    ) {
                        break;
                    }

                    for (const item of nextElement.items) {
                        if (element.type === "CheckList") {
                            element.items.push(castDraft(assertApiChecklistBlockElementItem(item)));
                        } else {
                            element.items.push(item);
                        }
                    }

                    elements.splice(index + 1, 1);
                }
            }

            // Unwrap FileGallery with a single row containing a single element. This runs
            // before merging so that two adjacent single-item galleries become two standalone
            // elements rather than a merged two-row gallery. The printer already unwraps these
            // when printing, so the parser never produces single-item galleries from printed
            // content.
            if (
                element.type === "FileGallery" &&
                element.rows.length === 1 &&
                element.rows[0]!.items.length === 1
            ) {
                const unwrapped = element.rows[0]!.items[0]!.element;
                elements.splice(index, 1, castDraft(unwrapped));
                // Don't increment index, re-process the unwrapped element.
                continue;
            }

            // Merge adjacent file-like elements into a single FileGallery.
            //
            // `FileGallery` is an API-only concept. In ProseMirror, each row is an independent
            // `fileRow` node, and there's no wrapper node that groups rows into a "gallery".
            // We introduced `FileGallery` in the API to give consumers a structured way to
            // represent multi-file layouts (rows of files displayed side by side). Since
            // `fileRow` nodes are independent in ProseMirror, adjacent `fileRow` nodes always
            // belong to the same visual gallery, so we merge their API representations here.
            //
            // We also absorb standalone File/Preview elements that follow a gallery. This
            // happens because the printer unwraps single-item gallery rows into standalone
            // elements for cleaner markdown. When the parser reads this back, those rows
            // become standalone elements. Absorbing them restores the original multi-row
            // structure.
            //
            // Example: `FileGallery([A, B], [C])` prints as: `<div>A B</div>` + `![C](url)` (C
            // unwrapped by printer) Parser produces: `FileGallery([A, B])` + `File(C)`
            // Normalization absorbs C back: `FileGallery([A, B], [C])` Also handle adjacent
            // standalone File/Preview elements that should be merged into a gallery. This
            // happens when the printer unwraps all single-item rows from a multi-row gallery
            // into standalone elements.
            if (
                (element.type === "File" || element.type === "Preview") &&
                // File galleries aren't supported inside table elements. So don't merge adjacent
                // files/previews into file galleries when normalizing within a table.
                !this.#withinTableElement &&
                index < elements.length - 1
            ) {
                const nextElement = elements[index + 1]!;
                if (
                    nextElement.type === "File" ||
                    nextElement.type === "Preview" ||
                    nextElement.type === "FileGallery"
                ) {
                    // Replace the current element with a FileGallery wrapping it, then fall through to
                    // the FileGallery merge logic below.
                    const gallery = castDraft<ApiContentFileGalleryBlockElement>({
                        type: "FileGallery",
                        rows: [{items: [{element}]}],
                    });
                    elements.splice(index, 1, gallery);
                }
            }

            // Re-read element since we may have replaced it above.
            const mergeElement = elements[index]!;
            if (mergeElement.type === "FileGallery") {
                while (index < elements.length - 1) {
                    const nextElement = elements[index + 1]!;

                    if (nextElement.type === "FileGallery") {
                        for (const row of nextElement.rows) {
                            mergeElement.rows.push(row);
                        }
                        elements.splice(index + 1, 1);
                        continue;
                    }

                    if (nextElement.type === "File" || nextElement.type === "Preview") {
                        mergeElement.rows.push({items: [{element: nextElement}]});
                        elements.splice(index + 1, 1);
                        continue;
                    }

                    break;
                }
            }

            this.normalizeBlockElement(elements[index]!);
            index++;
        }
    }

    normalizeBlockElement(element: Draft<ApiContentBlockElement>) {
        switch (element.type) {
            case "Paragraph": {
                this.normalizeInlineElements(element.elements);
                break;
            }
            case "UnorderedList":
            case "OrderedList":
            case "CheckList": {
                for (const item of element.items) {
                    if (item.elements.length > 0) {
                        this.normalizeBlockElements(item.elements);
                    } else if (element.type !== "UnorderedList") {
                        // NOTE(ifitzsimmons, 2025-12-29): We only allow UnorderedList to create phantom
                        // lists. `CheckList` and `OrderedList` can't support phantom lists in the same
                        // way.
                        //
                        // So while unordered phantom lists look like:
                        //
                        // ```markdown
                        // -   -   - item at 3rd level in a phantom unordered list
                        // ```
                        //
                        // Checklists and ordered phantom lists get an empty paragraph and look like:
                        //
                        // ```markdown
                        // 1. <p></p>
                        //
                        // - Mixed types with phantoms
                        //
                        // OR
                        //
                        // [ ] <p></p>
                        //
                        // - Mixed types with phantoms
                        // ```
                        item.elements = [{type: "Paragraph", elements: []}];
                    }

                    if (item.nestedListElements !== undefined) {
                        this.normalizeBlockElements(item.nestedListElements);

                        if (item.nestedListElements.length === 0) {
                            item.nestedListElements = undefined;
                        }
                    }
                }
                break;
            }
            case "Quote": {
                this.normalizeBlockElements(element.elements);
                break;
            }
            case "Heading": {
                this.normalizeInlineElements(element.elements);
                break;
            }
            case "Divider": {
                // Already normalized.
                break;
            }
            case "Code": {
                if (element.lines.length === 0) {
                    element.lines.push({elements: []});
                } else {
                    for (const line of element.lines) {
                        this.normalizeInlineElements(line.elements);
                    }
                }
                break;
            }
            case "Table": {
                this.#withinTableElement = true;
                try {
                    if (element.hasHeaderRow === false) element.hasHeaderRow = undefined;
                    if (element.hasHeaderColumn === false) element.hasHeaderColumn = undefined;

                    if (element.rows.length === 0) {
                        element.rows.push({cells: []});
                    }

                    let columnCount = 0;

                    for (const row of element.rows) {
                        while (row.cells.length < 2) {
                            row.cells.push({elements: []});
                        }

                        columnCount = Math.max(columnCount, row.cells.length);

                        for (const cell of row.cells) {
                            this.normalizeBlockElements(cell.elements);

                            // A single empty paragraph is the default for empty cells. Remove it since the
                            // parser will recreate it.
                            if (
                                cell.elements.length === 1 &&
                                cell.elements[0]!.type === "Paragraph" &&
                                cell.elements[0]!.elements.length === 0
                            ) {
                                cell.elements.splice(0, 1);
                            }
                        }
                    }

                    for (const row of element.rows) {
                        while (row.cells.length < columnCount) {
                            row.cells.push({elements: []});
                        }
                    }

                    while (element.columns.length < columnCount) {
                        element.columns.push({width: 1});
                    }

                    while (element.columns.length > columnCount) {
                        element.columns.pop();
                    }
                } finally {
                    this.#withinTableElement = false;
                }
                break;
            }
            case "File": {
                if (!this.#response) {
                    // `contentType` and `contentLength` are response-only metadata that don't survive
                    // the markdown round trip. Strip them so that content with and without metadata
                    // normalizes to the same form.
                    if (hasOwnProperty(element, "contentType")) delete element.contentType;
                    if (hasOwnProperty(element, "contentLength")) delete element.contentLength;
                } else {
                    // Don't allow updating old response properties after the normalizer is destroyed.
                    assert(!this.#isDestroyed);

                    // If `response` is non-null that means we're normalizing response content.
                    //
                    // All files with the same `FileId` should have identical `contentType`s and
                    // `contentLength`s. Use the `contentType` and `contentLength` from the last time
                    // the file is referenced (this matches the behavior of
                    // `printApiContentToAgentWebMarkdown()` which ends up with the last seen response
                    // data in storage.)
                    const actualElement = element as ApiContentFileBlockElementResponse;

                    const otherFileElements = this.#response.fileElementsById.getOrSetDefault(
                        actualElement.id,
                    );

                    for (const otherFileElement of otherFileElements) {
                        otherFileElement.contentType = actualElement.contentType;
                        otherFileElement.contentLength = actualElement.contentLength;
                    }

                    otherFileElements.push(actualElement);
                }
                break;
            }
            case "Preview": {
                this.normalizeReference(element.reference);
                break;
            }
            case "FileFloat": {
                this.normalizeBlockElement(element.element);
                break;
            }
            case "FileGallery": {
                // FileGallery with a single row containing a single element should be unwrapped to
                // the bare File/Preview element. This is handled in
                // `normalizeApiContentBlockElements` above.
                //
                // Normalize elements inside each row and strip response-only metadata (`width` on
                // items, `contentType` on File elements).
                for (const row of element.rows) {
                    for (let index = 0; index < row.items.length; index++) {
                        const item = row.items[index]!;

                        if (this.#withDummyFileGalleryElementLayout) {
                            // We don't want to delete `width` since we want conform to the response type. So
                            // instead set `width` to a dummy value where all widths are shared evenly across
                            // the row.
                            //
                            // We have the same logic in `parseApiContentBlockElementsFromMarkdown()`.
                            item.width =
                                index !== row.items.length - 1
                                    ? Math.round((1 / row.items.length) * 100) / 100
                                    : (100 -
                                          (row.items.length - 1) *
                                              Math.round((1 / row.items.length) * 100)) /
                                      100;
                        } else if (!this.#response && hasOwnProperty(item, "width")) {
                            delete item.width;
                        }
                        this.normalizeBlockElement(item.element);
                    }
                }
                break;
            }
            default:
                throw exhaustive(element);
        }
    }

    normalizeInlineElements(elements: Draft<ReadonlyArray<ApiContentInlineElement>>) {
        let index = 0;
        let lastElement: Draft<ApiContentInlineElement> | undefined;

        while (index < elements.length) {
            const element = elements[index]!;

            // Ignore empty text elements.
            if (element.type === "Text" && element.text.length === 0) {
                elements.splice(index, 1);
                continue;
            }

            if (element.type === "Mention") {
                this.normalizeReference(element.reference);

                // `isAccountShortName` can only be true for account targets. Otherwise set to
                // undefined.
                if (
                    element.isAccountShortName === false ||
                    (element.isAccountShortName && element.reference.type !== "Account")
                ) {
                    element.isAccountShortName = undefined;
                }
            }

            const normalizedMarks = normalizeApiContentInlineElementMarks(element.marks);
            if (!isDeepEqual(normalizedMarks, element.marks))
                element.marks = castDraft(normalizedMarks);

            // Merge any adjacent text elements with the same marks.
            if (
                element.type === "Text" &&
                lastElement?.type === "Text" &&
                isDeepEqual(element.marks, lastElement.marks)
            ) {
                lastElement.text += element.text;
                elements.splice(index, 1);
                continue;
            }

            lastElement = element;
            index++;
        }
    }

    normalizeReference(reference: Draft<ApiReference>) {
        if (!this.#response) {
            // Cleanup response properties that aren't compared when determining content
            // equality.
            if (hasOwnProperty(reference, "title")) delete reference.title;
            if (hasOwnProperty(reference, "shortName")) delete reference.shortName;
            if (hasOwnProperty(reference, "botId")) delete reference.botId;
            if (hasOwnProperty(reference, "status")) delete reference.status;
        } else {
            // Don't allow updating old response properties after the normalizer is destroyed.
            assert(!this.#isDestroyed);

            // If `response` is non-null that means we're normalizing response content.
            //
            // All references with the same key should have identical data.
            const actualReference = reference as ApiReferenceResponse;

            const otherReferences = this.#response.referencesByKey.getOrSetDefault(
                printApiReferenceKey(reference),
            );

            for (const otherReference of otherReferences) {
                otherReference.title = actualReference.title;

                if (hasOwnProperty(actualReference, "shortName"))
                    (otherReference as any).shortName = actualReference.shortName;
                else delete (otherReference as any).shortName;

                if (hasOwnProperty(actualReference, "botId"))
                    (otherReference as any).botId = actualReference.botId;
                else delete (otherReference as any).botId;

                if (hasOwnProperty(actualReference, "status"))
                    (otherReference as any).status = actualReference.status;
                else delete (otherReference as any).status;
            }

            otherReferences.push(actualReference);
        }
    }
}

export const apiContentInlineElementMarkTypeNormalizedOrder = getObjectKeysWithKeyofType(
    // We use an object so TypeScript makes sure we list each type once. Then convert
    // to an array with `Object.keys()`.
    cast<Record<ApiContentInlineElementMark["type"], true>>({
        // Always put other marks inside comments so the `<mark>` HTML isn't broken apart.
        // Like this:
        //
        // ```md
        // <mark data-comment="abc">123</mark>[<mark data-comment="abc">456</mark>](https://example.com)<mark data-comment="abc">789</mark>
        // ```
        //
        // "Yuck! Terrible!" (source: Ian)
        //
        // Instead we want:
        //
        // ```md
        // <mark data-comment="abc">123[456](https://example.com)789</mark>
        // ```
        Comment: true,

        // We put link first since this influences print order. We'll be able to merge
        // adjacent links since they're always wrapping all other marks.
        Link: true,

        Highlight: true,
        Bold: true,
        Italic: true,
        Strike: true,
        Code: true,
    }),
);

export function normalizeApiContentInlineElementMarks<Mark extends ApiContentInlineElementMark>(
    marks: Iterable<Mark> | undefined,
): Array<Mark> | undefined {
    if (marks === undefined) return undefined;

    const markByKey = new Map<string, Mark>();

    for (const mark of marks) {
        let markKey: string;

        switch (mark.type) {
            // You can only have one of these mark types on any given text.
            case "Bold":
            case "Italic":
            case "Strike":
            case "Link":
            case "Code":
            case "Highlight":
                markKey = mark.type;
                break;

            // You can have multiple comment marks for different threads on any given text.
            case "Comment":
                markKey = `${mark.type}:${mark.thread.id}`;
                break;

            default:
                throw exhaustive(mark);
        }

        markByKey.set(markKey, mark);
    }

    const sortedMarkEntries = Array.from(markByKey.entries()).sort(
        ([markKey1, mark1], [markKey2, mark2]) =>
            apiContentInlineElementMarkTypeNormalizedOrder.indexOf(mark1.type) -
                apiContentInlineElementMarkTypeNormalizedOrder.indexOf(mark2.type) ||
            defaultCompareStrings(markKey1, markKey2),
    );

    const normalizedMarks = sortedMarkEntries.map(([, mark]) => mark);

    if (normalizedMarks.length === 0) {
        return undefined;
    } else {
        return normalizedMarks;
    }
}
