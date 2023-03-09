const focusableElements = [
    "input:not([disabled]):not([type=hidden])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "button:not([disabled])",
    "a[href]",
    "area[href]",
    "summary",
    "iframe",
    "object",
    "embed",
    "audio[controls]",
    "video[controls]",
    "[contenteditable]",
];

const focusableElementSelector = `${focusableElements.join(",")},[tabindex]`;

const tabbableElements = [...focusableElements, '[tabindex]:not([tabindex="-1"])'];

const tabbableElementSelector = tabbableElements.join(':not([tabindex="-1"]),');

function createFocusableTreeWalker(
    element: Element,
    {
        withinElement,
        includeElementsThatAreNotTabbable = false,
    }: {
        withinElement?: Element;
        includeElementsThatAreNotTabbable?: boolean;
    } = {},
) {
    const selector = includeElementsThatAreNotTabbable
        ? tabbableElementSelector
        : focusableElementSelector;

    const walker = document.createTreeWalker(
        withinElement ?? document.body,
        NodeFilter.SHOW_ELEMENT,
        {
            acceptNode(node) {
                // Skip nodes inside the starting node.
                if (element.contains(node)) return NodeFilter.FILTER_REJECT;

                if ((node as HTMLElement).matches(selector)) return NodeFilter.FILTER_ACCEPT;

                return NodeFilter.FILTER_SKIP;
            },
        },
    );

    walker.currentNode = element;

    return walker;
}

/**
 * Get the next focusable element in the tab sequence.
 *
 * You may also choose to include elements that are focusable but not a part of
 * the tab sequence (have `tabindex="-1"`).
 */
export function getNextFocusableElement(
    element: Element,
    options?: {
        withinElement?: Element;
        includeElementsThatAreNotTabbable?: boolean;
    },
) {
    const walker = createFocusableTreeWalker(element, options);
    return walker.nextNode() as HTMLElement | null;
}

/**
 * Get the previous focusable element in the tab sequence.
 *
 * You may also choose to include elements that are focusable but not a part of
 * the tab sequence (have `tabindex="-1"`).
 */
export function getPreviousFocusableElement(
    element: Element,
    options?: {
        withinElement?: Element;
        includeElementsThatAreNotTabbable?: boolean;
    },
) {
    const walker = createFocusableTreeWalker(element, options);
    return walker.previousNode() as HTMLElement | null;
}
