const focusableElementSelectors = [
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
    "[contenteditable]:not([contenteditable=false])",
    "[tabindex]",
];

export const focusableElementSelector = focusableElementSelectors.join(", ");

const tabbableElementSelector = focusableElementSelectors
    .map(selector => `${selector}:not([tabindex="-1"])`)
    .join(", ");

function createFocusableTreeWalker(
    element: Element | null,
    {
        withinElement,
        includeElementsThatAreNotTabbable = false,
    }: {
        withinElement?: Element | null;
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
                if (element?.contains(node)) return NodeFilter.FILTER_REJECT;

                if ((node as HTMLElement).matches(selector)) return NodeFilter.FILTER_ACCEPT;

                return NodeFilter.FILTER_SKIP;
            },
        },
    );

    if (element) {
        walker.currentNode = element;
    }

    return walker;
}

/**
 * Get the next focusable element in the tab sequence.
 *
 * You may also choose to include elements that are focusable but not a part of the
 * tab sequence (have `tabindex="-1"`).
 */
export function getNextFocusableElementIfExists(
    element: Element | null,
    options?: {
        withinElement?: Element | null;
        includeElementsThatAreNotTabbable?: boolean;
        skipElements?: number;
    },
): HTMLElement | null {
    const walker = createFocusableTreeWalker(element, options);

    let lastNode: HTMLElement | null = null;
    for (let i = 0; i < (options?.skipElements ?? 0); i++) {
        const node = walker.nextNode() as HTMLElement | null;
        if (!node) return lastNode;
        lastNode = node;
    }

    const node = walker.nextNode() as HTMLElement | null;
    if (!node) return lastNode;
    return node;
}

/**
 * Get the previous focusable element in the tab sequence.
 *
 * You may also choose to include elements that are focusable but not a part of the
 * tab sequence (have `tabindex="-1"`).
 */
export function getPreviousFocusableElementIfExists(
    element: Element | null,
    options?: {
        withinElement?: Element | null;
        includeElementsThatAreNotTabbable?: boolean;
    },
): HTMLElement | null {
    const walker = createFocusableTreeWalker(element, options);
    return walker.previousNode() as HTMLElement | null;
}

/**
 * Get the last focusable element in the tab sequence.
 *
 * You may also choose to include elements that are focusable but not a part of the
 * tab sequence (have `tabindex="-1"`).
 */
export function getLastFocusableElementIfExists(options?: {
    withinElement?: Element | null;
    includeElementsThatAreNotTabbable?: boolean;
}): HTMLElement | null {
    const selector = options?.includeElementsThatAreNotTabbable
        ? tabbableElementSelector
        : focusableElementSelector;

    let lastElementChild: Element = options?.withinElement ?? document.body;
    while (lastElementChild.lastElementChild) {
        lastElementChild = lastElementChild.lastElementChild;
    }

    if (lastElementChild.matches(selector)) {
        return lastElementChild as HTMLElement;
    } else {
        return getPreviousFocusableElementIfExists(lastElementChild, options);
    }
}
