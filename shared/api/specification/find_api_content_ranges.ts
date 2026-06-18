// IMPORTANT: Tests for this file live in
// `shared/api/content/find_api_content_ranges.test.ts`. So they can depend on our
// internal content format to API content format conversion code (and importantly
// `ApiContentKeyEncoder`).

import {normalizeApiContentInlineElementMarks} from "~/shared/api/markdown/normalize_api_content.js";
import {printApiReferenceKey} from "~/shared/api/specification/api_reference_key.js";
import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {
    ApiContentPosition,
    ApiContentRange,
} from "~/shared/api/specification/types/api_content_position.js";
import {
    ApiContentBlockElementWithOptionalKeys,
    ApiContentWithOptionalKeys,
} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiContent,
    ApiContentBreakInlineElement,
    ApiContentCheckListBlockElement,
    ApiContentHeadingBlockElement,
    ApiContentInlineElement,
    ApiContentInlineElementMark,
    ApiContentMentionInlineElement,
    ApiContentOrderedListBlockElement,
    ApiContentParagraphBlockElement,
    ApiContentQuoteBlockElement,
    ApiContentResponse,
    ApiContentUnorderedListBlockElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {LinkedList, NonEmptyLinkedList} from "~/shared/helpers/immutable/linked_list.js";

// NOCOMMIT: Document!
export function* findApiContentRanges(
    haystack: ApiContentResponse,
    needle: ApiContent,
): IterableIterator<ApiContentRange, undefined> {
    let needleIterator = iterateApiContent(null, needle);
    let needleStep = needleIterator.next();
    let rangeStart: ApiContentPosition | null = null;

    // We report no matches for an empty needle.
    if (needleStep.value === undefined) return;

    for (const haystackToken of iterateApiContent(null, haystack)) {
        if (!areTokensMatch(haystackToken, needleStep.value)) {
            // This match failed! Reset our state.
            if (rangeStart !== null) {
                needleIterator = iterateApiContent(null, needle);
                needleStep = needleIterator.next();
                rangeStart = null;

                // We report no matches for an empty needle.
                if (needleStep.value === undefined) return;
            }
        } else {
            // Ooh! The token is a match, let's see start a new range.
            if (rangeStart === null) {
                // We use the non-null assertion operator (`!`) because `haystack` is
                // `ApiContentResponse` and so it must always include keys.
                rangeStart = {key: haystackToken.key!, index: haystackToken.index};
            }

            needleStep = needleIterator.next();

            // Hooray! We've reached the last token in our needle. Yield the matched range and
            // reset our state.
            if (needleStep.value === undefined) {
                yield {
                    start: rangeStart,
                    // We use the non-null assertion operator (`!`) because `haystack` is
                    // `ApiContentResponse` and so it must always include keys.
                    end: {key: haystackToken.key!, index: haystackToken.index + 1},
                };

                needleIterator = iterateApiContent(null, needle);
                needleStep = needleIterator.next();
                rangeStart = null;

                // We report no matches for an empty needle.
                if (needleStep.value === undefined) return;
            }
        }
    }
}

type TokenParent =
    | ApiContentParagraphBlockElement
    | ApiContentHeadingBlockElement
    | ApiContentQuoteBlockElement
    | ApiContentUnorderedListBlockElement
    | ApiContentOrderedListBlockElement
    | {
          readonly type: "CheckListItem";
          readonly itemIndex: number;
          readonly listElement: ApiContentCheckListBlockElement;
      };

type Token = {
    parents: NonEmptyLinkedList<TokenParent>;
    key: ApiContentKey | undefined;
    index: number;
    value: TokenValue;
    marks: ReadonlyArray<ApiContentInlineElementMark> | undefined;
};

type TokenValue = string | ApiContentBreakInlineElement | ApiContentMentionInlineElement;

function areTokensMatch(haystackToken: Token, needleTokens: Token): boolean {
    return (
        // This is most likely to be different, put it first to short circuit early.
        areTokenValuesEqual(haystackToken.value, needleTokens.value) &&
        // This is unlikely to be different but is cheap to compute, put it second.
        areTokenParentListsMatch(haystackToken.parents, needleTokens.parents) &&
        // This is least likely to be different and also the most expensive to compute, put
        // it last.
        isDeepEqual(
            normalizeApiContentInlineElementMarks(haystackToken.marks),
            normalizeApiContentInlineElementMarks(needleTokens.marks),
        )
    );
}

function areTokenParentListsMatch(
    haystackParents: LinkedList<TokenParent>,
    needleParents: LinkedList<TokenParent>,
): boolean {
    if (haystackParents === null) {
        if (needleParents !== null) return false;
        return true;
    }

    // If the needle has no more parents but everything up to this point was a match,
    // then we consider the parent lists to be a match! This supports matching simply
    // `paragraph("bar")` with:
    //
    // ```
    // quoteBlock(paragraph("foo bar qux"))
    // ```
    //
    // `paragraph("bar")` isn't wrapped in a `quoteBlock()` but it matches content
    // inside the quote block.
    if (needleParents === null) return true;

    if (!areTokenParentsMatch(haystackParents.value, needleParents.value)) return false;

    return areTokenParentListsMatch(haystackParents.next, needleParents.next);
}

function areTokenParentsMatch(parent1: TokenParent, parent2: TokenParent): boolean {
    switch (parent1.type) {
        case "Paragraph": {
            return parent2.type === "Paragraph";
        }
        case "Heading": {
            return parent2.type === "Heading";
        }
        case "Quote": {
            return parent2.type === "Quote";
        }
        case "UnorderedList": {
            return parent2.type === "UnorderedList";
        }
        case "OrderedList": {
            // NOCOMMIT: Ordered list item `orderStart` situation?
            return parent2.type === "OrderedList";
        }
        case "CheckListItem": {
            return (
                parent2.type === "CheckListItem" &&
                parent1.listElement.items[parent1.itemIndex]!.checked ===
                    parent2.listElement.items[parent2.itemIndex]!.checked
            );
        }
        default:
            throw exhaustive(parent1);
    }
}

function areTokenValuesEqual(value1: TokenValue, value2: TokenValue): boolean {
    if (typeof value1 === "string") {
        if (typeof value2 !== "string") return false;
        return value1 === value2;
    }

    if (typeof value2 === "string") return false;

    switch (value1.type) {
        case "Break": {
            if (value2.type !== "Break") return false;
            return true;
        }
        case "Mention": {
            if (value2.type !== "Mention") return false;

            // If other keys are added to `ApiContentMentionInlineElement` in the future you
            // may need to add equality check for them here. TypeScript will error when a new
            // key is added forcing the developer to consider updating this equality logic.
            assertEqualTypes<
                keyof typeof value1,
                "type" | "reference" | "isAccountShortName" | "marks"
            >();

            return (
                printApiReferenceKey(value1.reference) === printApiReferenceKey(value2.reference) &&
                !!value1.isAccountShortName === !!value2.isAccountShortName
            );
        }
        default:
            throw exhaustive(value1);
    }
}

function* iterateApiContent(
    parents: LinkedList<TokenParent>,
    content: ApiContentWithOptionalKeys,
): IterableIterator<Token, undefined> {
    for (const element of content.elements) {
        yield* iterateApiContentBlockElement(parents, element);
    }
}

function* iterateApiContentBlockElement(
    parents: LinkedList<TokenParent>,
    element: ApiContentBlockElementWithOptionalKeys,
): IterableIterator<Token, undefined> {
    switch (element.type) {
        case "Paragraph": {
            yield* iterateApiContentInlineElements(
                {value: element, next: parents},
                element.key,
                element.elements,
            );
            break;
        }
        case "Heading": {
            yield* iterateApiContentInlineElements(
                {value: element, next: parents},
                element.key,
                element.elements,
            );
            break;
        }
        case "Quote": {
            const childParents = {value: element, next: parents};

            for (const childElement of element.elements) {
                yield* iterateApiContentBlockElement(childParents, childElement);
            }
            break;
        }
        case "UnorderedList":
        case "OrderedList": {
            const childParents = {value: element, next: parents};

            for (let itemIndex = 0; itemIndex < element.items.length; itemIndex++) {
                const item = element.items[itemIndex]!;

                for (const childElement of item.elements) {
                    yield* iterateApiContentBlockElement(childParents, childElement);
                }

                if (item.nestedListElements) {
                    for (const nestedElement of item.nestedListElements) {
                        yield* iterateApiContentBlockElement(childParents, nestedElement);
                    }
                }
            }
            break;
        }
        case "CheckList": {
            for (let itemIndex = 0; itemIndex < element.items.length; itemIndex++) {
                const item = element.items[itemIndex]!;

                const childParents: NonEmptyLinkedList<TokenParent> = {
                    value: {type: "CheckListItem", itemIndex, listElement: element},
                    next: parents,
                };

                for (const childElement of item.elements) {
                    yield* iterateApiContentBlockElement(childParents, childElement);
                }

                if (item.nestedListElements) {
                    for (const nestedElement of item.nestedListElements) {
                        yield* iterateApiContentBlockElement(childParents, nestedElement);
                    }
                }
            }
            break;
        }
        default:
            throw exhaustive(element);
    }
}

function* iterateApiContentInlineElements(
    parents: NonEmptyLinkedList<TokenParent>,
    key: ApiContentKey | undefined,
    elements: ReadonlyArray<ApiContentInlineElement>,
): IterableIterator<Token, undefined> {
    let index = 0;

    // We reuse the same `token` object for every character to avoid creating a lot of
    // garbage collector pressure from tiny objects.
    const token: Token = {
        parents,
        key,
        index,
        value: "",
        marks: undefined,
    };

    for (const element of elements) {
        switch (element.type) {
            case "Text": {
                for (let i = 0; i < element.text.length; i++) {
                    token.index = index;
                    token.value = element.text[i]!;
                    token.marks = element.marks;
                    yield token;
                    index++;
                }
                break;
            }
            case "Break":
            case "Mention": {
                token.index = index;
                token.value = element;
                token.marks = element.marks;
                yield token;
                index++;
                break;
            }
            default:
                throw exhaustive(element);
        }
    }
}
