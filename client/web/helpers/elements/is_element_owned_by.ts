import {assert} from "~/shared/helpers/control/assert.js";

/**
 * An attribute that points to the element which owns the attributed element. If
 * this attribute is not present then the parent of the element is the owner.
 *
 * We named this attribute with the same convention as [`aria-labelledby`][1].
 *
 * [1]:
 *     https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-labelledby
 */
const ownedByAttributeName = "data-ownedby";

/**
 * Is the second element owned by the first element? Defaults to
 * `ownerElement.contains(childElement)` but if any element in the parent stack of
 * `childElement` has the `data-ownedby` set then we move to that element and
 * search the parents of that element. This allows us to establish an ownership
 * relationship between overlays and their target element.
 */
export function isElementOwnedBy(ownerElement: Element, childElement: Element): boolean {
    const seenElements = new Set<Element>();

    let currentElement: Element | null = childElement;
    while (currentElement !== null) {
        if (currentElement === ownerElement) return true;

        assert(!seenElements.has(currentElement), "Element ownership cycle detected");
        seenElements.add(currentElement);

        let nextElement: Element | null = null;

        if (nextElement === null) {
            nextElement = elementByOwnerElement?.get(currentElement) ?? null;
        }

        if (nextElement === null) {
            const ownerElementId: string | null = currentElement.getAttribute(ownedByAttributeName);
            nextElement = ownerElementId ? document.getElementById(ownerElementId) : null;
        }

        if (nextElement === null) {
            nextElement = currentElement.parentElement;
        }

        currentElement = nextElement;
    }

    return false;
}

let elementByOwnerElement: WeakMap<Element, Element> | null = null;

/**
 * Set that the provided `childElement` is owned by `ownerElement`. You may use
 * this to establish a parent/child relationship without the child being a direct
 * child element of the owner. Normally we use the `data-ownedby` attribute to
 * specify this relationship however sometimes you the element you want to
 * reference doesn't have an `id` and you can't add one.
 */
export function setElementOwnedBy(childElement: Element, ownerElement: Element | null) {
    elementByOwnerElement ??= new WeakMap();

    if (ownerElement === null) {
        elementByOwnerElement.delete(childElement);
    } else {
        elementByOwnerElement.set(childElement, ownerElement);
    }
}
