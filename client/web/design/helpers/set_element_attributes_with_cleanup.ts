/**
 * Convenient helper for managing DOM attributes in React lifecycle functions.
 *
 * Allows us to change the values of attributes on an element in bulk and
 * remembers the old values of the attributes so we can revert that change as a
 * part of a React lifecycle cleanup.
 */
export function setElementAttributesWithCleanup(
    element: Element,
    attributes: {[attributeName: string]: string | null | undefined},
): () => void {
    const attributeEntries = Object.entries(attributes).filter(
        ([, attributeValue]) => attributeValue !== undefined,
    ) as Array<[string, string | null]>;

    const lastAttributeEntries: Array<[string, string | null]> = attributeEntries.map(
        ([attributeName]) => [attributeName, element.getAttribute(attributeName)],
    );

    setElementAttributes(element, attributeEntries);

    return () => {
        // Future enhancement: If something else changes our element's attributes
        // between initialization and cleanup, we want that code to "take control"
        // of the attribute which means we shouldn't revert back to the original
        // attribute.
        //
        // For example, if a React component also declares an attribute and the
        // value changes through React then we want to cede control to React.
        //
        // We don't have a case where this happens right now, though.
        setElementAttributes(element, lastAttributeEntries);
    };
}

function setElementAttributes(element: Element, attributeEntries: Array<[string, string | null]>) {
    for (const [attributeName, attributeValue] of attributeEntries) {
        if (attributeValue === null) {
            element.removeAttribute(attributeName);
        } else {
            element.setAttribute(attributeName, attributeValue);
        }
    }
}
