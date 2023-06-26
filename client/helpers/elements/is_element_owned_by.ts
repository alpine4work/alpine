import {assert} from "~/shared/helpers/control/assert.js";

/**
 * An attribute that points to the element which owns the attributed element.
 * If this attribute is not present then the parent of the element is the
 * owner.
 *
 * We named this attribute with the same convention as [`aria-labelledby`][1].
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-labelledby
 */
const ownedByAttributeName = "data-ownedby";

/**
 * Is the second element owned by the first element? Defaults to
 * `ownerElement.contains(childElement)` but if any element in the parent stack
 * of `childElement` has the `data-ownedby` set then we move to that element
 * and search the parents of that element. This allows us to establish an
 * ownership relationship between overlays and their target element.
 */
export function isElementOwnedBy(ownerElement: Element, childElement: Element): boolean {
    const seenElements = new Set<Element>();

    let currentElement: Element | null = childElement;
    while (currentElement !== null) {
        if (currentElement === ownerElement) return true;

        assert(!seenElements.has(currentElement), "Element ownership cycle detected");
        seenElements.add(currentElement);

        const ownerElementId: string | null = currentElement.getAttribute(ownedByAttributeName);
        const currentOwnerElement: Element | null = ownerElementId
            ? document.getElementById(ownerElementId)
            : null;

        let currentParentElement: Node | null = currentElement.parentNode;
        while (currentParentElement !== null && !(currentParentElement instanceof Element))
            currentParentElement = currentParentElement.parentNode;

        currentElement = currentOwnerElement ?? currentParentElement;
    }

    return false;
}
