import {Draft, castDraft, produce} from "immer";
import {assertApiCheckListBlockElementItem} from "~/shared/api/content/assert_api_check_list_block_element_item.open_source.js";
import {
    ApiReferenceKey,
    printApiReferenceKey,
} from "~/shared/api/specification/api_reference_key.open_source.js";
import {ApiContentFileBlockElementResponseWithOptionalKeys} from "~/shared/api/specification/types/api_content_response_with_optional_keys.open_source.js";
import {ApiReference} from "~/shared/api/specification/types/api_reference.open_source.js";
import {ApiReferenceResponse} from "~/shared/api/specification/types/api_reference_response.open_source.js";
import {
    ApiContentBlockElementRequest,
    ApiContentFileBlockElement,
    ApiContentFileGalleryBlockElementRequest,
    ApiContentInlineElementMark,
    ApiContentInlineElementRequest,
    ApiContentRequest,
    ApiMentionReferenceRequest,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.open_source.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.open_source.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.open_source.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";

/**
 * If two `ApiContentRequest` objects normalize to the same object (based on an
 * `isDeepEqual()` check) then the two `ApiContentRequest`s are considered to be
 * equivalent.
 */
export function normalizeApiContent(content: ApiContentRequest): ApiContentRequest {
    return produce(content, normalizeDraftApiContent);
}

export function normalizeDraftApiContent(content: Draft<ApiContentRequest>) {
    ApiContentNormalizer.with(normalizer => {
        normalizer.normalize(content);
    });
}

export function normalizeApiContentBlockElement(
    element: ApiContentBlockElementRequest,
): ApiContentBlockElementRequest {
    return produce(element, element => {
        ApiContentNormalizer.with(normalizer => {
            normalizer.normalizeBlockElement(element);
        });
    });
}

export function normalizeApiContentInlineElements(
    elements: ReadonlyArray<ApiContentInlineElementRequest>,
): ReadonlyArray<ApiContentInlineElementRequest> {
    return produce(elements, elements => {
        ApiContentNormalizer.with(normalizer => {
            normalizer.normalizeInlineElements(elements);
        });
    });
}

export function normalizeApiReference(
    reference: ApiMentionReferenceRequest,
): ApiMentionReferenceRequest {
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
        fileElementsById: DefaultMap<
            FileId,
            Array<Draft<ApiContentFileBlockElementResponseWithOptionalKeys>>
        >;
    } | null;

    #withKeys: boolean;

    #withinTableElement = false;
    #withDummyFileGalleryElementLayout: boolean;

    private constructor({
        isResponse,
        withKeys,
        withDummyFileGalleryElementLayout,
    }: {
        isResponse: boolean;
        withKeys: boolean;
        withDummyFileGalleryElementLayout: boolean;
    }) {
        this.#response = isResponse
            ? {
                  referencesByKey: new DefaultMap(() => []),
                  fileElementsById: new DefaultMap(() => []),
              }
            : null;

        this.#withKeys = withKeys;

        this.#withDummyFileGalleryElementLayout = withDummyFileGalleryElementLayout;
    }

    static with<Value>(
        action: (normalizer: ApiContentNormalizer) => Value,
        {
            isResponse = false,
            withKeys = false,
            withDummyFileGalleryElementLayout = false,
        }: {
            isResponse?: boolean;
            withKeys?: boolean;
            withDummyFileGalleryElementLayout?: boolean;
        } = {},
    ): Value {
        const normalizer = new ApiContentNormalizer({
            isResponse,
            withKeys,
            withDummyFileGalleryElementLayout,
        });

        try {
            const value = action(normalizer);
            return value;
        } finally {
            normalizer.#isDestroyed = true;
        }
    }

    normalize(content: Draft<ApiContentRequest>) {
        this.normalizeBlockElements(content.elements);
    }

    normalizeBlockElements(elements: Draft<ReadonlyArray<ApiContentBlockElementRequest>>) {
        this.normalizePossiblyEmptyBlockElements(elements);

        // All block element lists in our underlying ProseMirror content are non-empty. So
        // don't allow empty block element lists, always insert a paragraph.
        if (elements.length === 0) {
            if (this.#withKeys) {
                throw new InternalError(
                    "Can\u2019t normalize an empty block element list when the underlying format requires a non-empty block element list (`withKeys: true` requires this, otherwise we automatically add empty paragraphs to fill empty block element lists)",
                );
            }

            elements.push({type: "Paragraph", elements: []});
        }
    }

    normalizePossiblyEmptyBlockElements(
        elements: Draft<ReadonlyArray<ApiContentBlockElementRequest>>,
    ) {
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

            // ProseMirror stores nested list items as indented siblings. A leading phantom
            // unordered-list item after another list is therefore indistinguishable from
            // nested content on the preceding list's last item. Canonicalize the API shape
            // before merging adjacent lists so the phantom boundary is not lost.
            if (
                (element.type === "UnorderedList" ||
                    element.type === "OrderedList" ||
                    element.type === "CheckList") &&
                index < elements.length - 1
            ) {
                // Empty lists don't print any Markdown, so they can't preserve a boundary between
                // the lists on either side of them.
                while (index < elements.length - 1) {
                    const nextElement = elements[index + 1]!;
                    if (
                        (nextElement.type === "UnorderedList" ||
                            nextElement.type === "OrderedList" ||
                            nextElement.type === "CheckList") &&
                        nextElement.items.length === 0
                    ) {
                        elements.splice(index + 1, 1);
                    } else {
                        break;
                    }
                }

                const nextElement = elements[index + 1];
                if (nextElement?.type === "UnorderedList") {
                    const nextItem = nextElement.items[0];

                    if (
                        nextItem !== undefined &&
                        nextItem.elements.length === 0 &&
                        nextItem.nestedListElements !== undefined &&
                        nextItem.nestedListElements.some(
                            nestedElement => nestedElement.items.length > 0,
                        )
                    ) {
                        const lastItem = element.items[element.items.length - 1]!;
                        lastItem.nestedListElements ??= [];
                        lastItem.nestedListElements.push(...nextItem.nestedListElements);
                        nextElement.items.splice(0, 1);

                        if (nextElement.items.length === 0) {
                            elements.splice(index + 1, 1);
                            continue;
                        }
                    }
                }
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
                            element.items.push(castDraft(assertApiCheckListBlockElementItem(item)));
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
                    const gallery = castDraft<ApiContentFileGalleryBlockElementRequest>({
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

    normalizeBlockElement(element: Draft<ApiContentBlockElementRequest>) {
        switch (element.type) {
            case "Paragraph": {
                if (!this.#withKeys && hasOwnProperty(element, "key")) delete element.key;
                this.normalizeInlineElements(element.elements);
                break;
            }
            case "UnorderedList":
            case "OrderedList":
            case "CheckList": {
                if (hasOwnProperty(element, "orderStart") && element.orderStart === undefined) {
                    delete element.orderStart;
                }

                let nextIndex = 0;
                while (nextIndex < element.items.length) {
                    const index = nextIndex;
                    nextIndex++;
                    const item = element.items[index]!;

                    if (
                        item.elements.length > 0 ||
                        element.type !== "UnorderedList" ||
                        index > 0 ||
                        item.nestedListElements === undefined ||
                        item.nestedListElements.every(
                            nestedElement => nestedElement.items.length === 0,
                        )
                    ) {
                        this.normalizeBlockElements(item.elements);
                    }

                    if (item.nestedListElements === undefined) {
                        if (hasOwnProperty(item, "nestedListElements")) {
                            delete item.nestedListElements;
                        }
                    } else {
                        if (item.nestedListElements.length === 0) {
                            delete item.nestedListElements;
                        } else {
                            this.normalizePossiblyEmptyBlockElements(item.nestedListElements);
                            if (item.nestedListElements.length === 0)
                                delete item.nestedListElements;
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
                if (!this.#withKeys && hasOwnProperty(element, "key")) delete element.key;
                this.normalizeInlineElements(element.elements);
                break;
            }
            case "Divider": {
                if (!this.#withKeys && hasOwnProperty(element, "key")) delete element.key;

                // Already normalized.
                break;
            }
            case "Code": {
                if (element.lines.length === 0) {
                    if (this.#withKeys) {
                        throw new InternalError(
                            "Can\u2019t normalize an empty code block line list when the underlying format requires a non-empty code block line list (`withKeys: true` requires this, otherwise we automatically add empty code block lines to fill empty code block line lists)",
                        );
                    }

                    element.lines.push({elements: []});
                } else {
                    for (const line of element.lines) {
                        if (!this.#withKeys && hasOwnProperty(line, "key")) delete line.key;
                        this.normalizeInlineElements(line.elements);
                    }
                }
                break;
            }
            case "Table": {
                this.#withinTableElement = true;
                try {
                    if (element.hasHeaderRow !== true) delete element.hasHeaderRow;
                    if (element.hasHeaderColumn !== true) delete element.hasHeaderColumn;

                    if (element.rows.length === 0) {
                        element.rows.push({cells: []});
                    }

                    let columnCount = 0;

                    for (const row of element.rows) {
                        for (const cell of row.cells) {
                            this.normalizeBlockElements(cell.elements);
                        }

                        while (row.cells.length < 2) {
                            if (this.#withKeys) {
                                throw new InternalError(
                                    "Can\u2019t normalize an empty block element list when the underlying format requires a non-empty block element list (`withKeys: true` requires this, otherwise we automatically add empty paragraphs to fill empty block element lists)",
                                );
                            }

                            // The underlying ProseMirror format requires at least two cells. And each cell in
                            // the underlying ProseMirror format must have at least one block element in it. So
                            // if we are missing cells in our API content format then fill it out with empty
                            // cells with empty paragraphs.
                            row.cells.push({elements: [{type: "Paragraph", elements: []}]});
                        }

                        columnCount = Math.max(columnCount, row.cells.length);
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
                if (!this.#withKeys && hasOwnProperty(element, "key")) delete element.key;

                const marks = normalizeApiContentInlineElementMarks(element.marks);
                if (marks !== undefined) element.marks = marks;
                else delete element.marks;

                if (!this.#response) {
                    // File metadata doesn't survive the markdown round trip. Strip it so that content
                    // with and without metadata normalizes to the same form.
                    if (hasOwnProperty(element.file, "contentType")) {
                        delete element.file.contentType;
                    }
                    if (hasOwnProperty(element.file, "contentLength")) {
                        delete element.file.contentLength;
                    }
                    if (hasOwnProperty(element.file, "caption")) {
                        delete element.file.caption;
                    }
                } else {
                    // Don't allow updating old response properties after the normalizer is destroyed.
                    assert(!this.#isDestroyed);

                    // If `response` is non-null that means we're normalizing response content.
                    //
                    // All files with the same `FileId` should have identical metadata. Use the
                    // metadata from the last time the file is referenced (this matches the behavior of
                    // `printApiContentToAgentWebMarkdown()` which ends up with the last seen response
                    // data in storage.)
                    const actualElement = element as Draft<ApiContentFileBlockElement>;
                    const actualFile = actualElement.file;

                    const otherFileElements = this.#response.fileElementsById.getOrSetDefault(
                        actualFile.id,
                    );

                    for (const otherFileElement of otherFileElements) {
                        otherFileElement.file.contentType = actualFile.contentType;
                        otherFileElement.file.contentLength = actualFile.contentLength;
                        if (actualFile.caption !== undefined) {
                            otherFileElement.file.caption = actualFile.caption;
                        } else {
                            delete otherFileElement.file.caption;
                        }
                    }

                    otherFileElements.push(actualElement);
                }
                break;
            }
            case "Preview": {
                if (!this.#withKeys && hasOwnProperty(element, "key")) delete element.key;

                const marks = normalizeApiContentInlineElementMarks(element.marks);
                if (marks !== undefined) element.marks = marks;
                else delete element.marks;

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

    normalizeInlineElements(elements: Draft<ReadonlyArray<ApiContentInlineElementRequest>>) {
        let index = 0;
        let lastElement: Draft<ApiContentInlineElementRequest> | undefined;

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
                    (hasOwnProperty(element, "isAccountShortName") &&
                        element.isAccountShortName === undefined) ||
                    element.isAccountShortName === false ||
                    (element.isAccountShortName && element.reference.type !== "Account")
                ) {
                    delete element.isAccountShortName;
                }
            }

            const normalizedMarks = normalizeApiContentInlineElementMarks(element.marks);
            if (!isDeepEqual(normalizedMarks, element.marks)) {
                if (normalizedMarks !== undefined) element.marks = normalizedMarks;
                else delete element.marks;
            } else if (normalizedMarks === undefined && hasOwnProperty(element, "marks")) {
                delete element.marks;
            }

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
            if (hasOwnProperty(reference, "bot")) delete reference.bot;
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
                if (hasOwnProperty(actualReference, "title"))
                    (otherReference as any).title = actualReference.title;
                else delete (actualReference as any).title;

                if (hasOwnProperty(actualReference, "shortName"))
                    (otherReference as any).shortName = actualReference.shortName;
                else delete (otherReference as any).shortName;

                if (hasOwnProperty(actualReference, "bot"))
                    (otherReference as any).bot = actualReference.bot;
                else delete (otherReference as any).bot;

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

    const markByKey = new Map<string, {mark: Mark; index: number}>();

    let nextIndex = 0;
    for (const mark of marks) {
        const index = nextIndex;
        nextIndex++;

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

        markByKey.set(markKey, {mark, index});
    }

    const sortedMarkEntries = Array.from(markByKey.entries()).sort(
        ([, mark1], [, mark2]) =>
            apiContentInlineElementMarkTypeNormalizedOrder.indexOf(mark1.mark.type) -
                apiContentInlineElementMarkTypeNormalizedOrder.indexOf(mark2.mark.type) ||
            mark1.index - mark2.index,
    );

    const normalizedMarks = sortedMarkEntries.map(([, {mark}]) => mark);

    if (normalizedMarks.length === 0) {
        return undefined;
    } else {
        return normalizedMarks;
    }
}
