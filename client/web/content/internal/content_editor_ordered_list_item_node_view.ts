import {DOMSerializer, Node} from "prosemirror-model";
import {NodeView} from "prosemirror-view";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

/**
 * Creates a node view for an `orderedListItem`. We need a custom node view so we
 * can use JavaScript to set the ordered list item number. We can't use CSS to set
 * the list item number because instead of having a proper `<ul>`/`<li>` nesting
 * structure for lists, each node is included flat in the parent.
 *
 * After our node is added to the DOM, we set its `data-list-number` property to
 * the correct value. We also set the `data-list-number` property for all list
 * items that follow.
 *
 * Then we have a mutation observer that watches for nodes removed above a list
 * item. If a node is removed above a list item then we may need to renumber that
 * list. For example, if we're merging two ordered lists together.
 */
export function createContentEditorOrderedListItemNodeView(node: Node): NodeView {
    const {dom, contentDOM: contentDom} = DOMSerializer.renderSpec(
        document,
        node.type.spec.toDOM!(node),
    );

    assert(dom instanceof HTMLElement);

    let isDestroyed = false;
    let unobserve: (() => void) | undefined;

    // Wait until ProseMirror has updated the DOM to set our list item numbers. Since
    // we set list item numbers by reading the DOM.
    scheduleMicrotask(() => {
        if (isDestroyed) return;
        assert(dom.parentNode, "Expected node DOM to be synchronously inserted");
        setOrderedListItemNumber(dom);
        unobserve = observeOrderListItemSiblingMutations(dom.parentNode);
    });

    return {
        dom,
        contentDOM: contentDom,
        destroy: () => {
            isDestroyed = true;
            unobserve?.();
        },
        ignoreMutation: mutation => {
            // Prevent infinite recursion by telling ProseMirror to ignore the mutations to the
            // `data-list-number` attribute that we're making.
            return mutation.type === "attributes" && mutation.attributeName === "data-list-number";
        },
    };
}

/**
 * Parses data from the element if its a list item. If its a list item returns an
 * object with indentation. If its an ordered list item then we'll also return a
 * non-null `number`. If it's not an ordered list item then `number` will be null.
 */
function parseListItemData(
    element: HTMLElement,
): {indent: number; orderStart: number | null; number: number | null} | null {
    if (element.dataset.listIndent === undefined) return null;

    let indent = parseInt(element.dataset.listIndent, 10);
    indent = !isNaN(indent) && Number.isInteger(indent) && indent >= 0 ? indent : 0;

    let orderStart =
        element.dataset.listStart !== undefined ? parseInt(element.dataset.listStart, 10) : null;

    if (orderStart !== null) {
        orderStart =
            !isNaN(orderStart) && Number.isInteger(orderStart) && orderStart >= 1 ? orderStart : 1;
    }

    let number =
        element.dataset.listNumber !== undefined ? parseInt(element.dataset.listNumber, 10) : null;

    if (number !== null) {
        number = !isNaN(number) && Number.isInteger(number) && number >= 0 ? number : 0;
    }

    return {indent, orderStart, number};
}

/**
 * If the provided node is an ordered list item, set its `data-list-number`
 * attribute to the correct value.
 *
 * If `data-list-number` changed then we also update all ordered list items that
 * follow.
 */
function setOrderedListItemNumber(element: HTMLElement) {
    const listItemData = parseListItemData(element);
    if (!listItemData) return;

    let newListItemNumber: number;

    if (listItemData.orderStart !== null) {
        newListItemNumber = listItemData.orderStart;
    } else {
        // Find the previous list item. Skipping over any list items with a nested
        // indentation.
        let previousListItem: {
            element: HTMLElement;
            data: {indent: number; number: number | null};
        } | null = {
            element,
            data: listItemData,
        };
        do {
            const previousElement: ChildNode | null = previousListItem.element.previousSibling;
            if (!previousElement || !(previousElement instanceof HTMLElement)) {
                previousListItem = null;
                break;
            }

            const previousListItemData = parseListItemData(previousElement);
            if (!previousListItemData) {
                previousListItem = null;
                break;
            }

            previousListItem = {
                element: previousElement,
                data: previousListItemData,
            };
        } while (previousListItem.data.indent > listItemData.indent);

        // If the previous list item is at a lower indentation then this is the start of
        // our numbering for the indented list.
        if (previousListItem?.data.indent !== listItemData.indent) {
            previousListItem = null;
        }

        newListItemNumber =
            typeof previousListItem?.data.number === "number"
                ? previousListItem.data.number + 1
                : 1;
    }

    // Our list item already has the right number. We don't need to update.
    if (newListItemNumber === listItemData.number) return;

    element.dataset.listNumber = String(newListItemNumber);

    // The list items following this one may have incorrect numbers. Let's fix them.
    resetSiblingOrderedListItemNumbers(
        listItemData.indent,
        element.nextSibling,
        newListItemNumber + 1,
    );
}

function resetSiblingOrderedListItemNumbers(
    indent: number,
    startNode: ChildNode | null,
    nextListItemNumber: number,
) {
    let nextListItemElement: ChildNode | null = startNode;

    while (nextListItemElement && nextListItemElement instanceof HTMLElement) {
        const nextListItemData = parseListItemData(nextListItemElement);

        // Non-list items end the list.
        if (!nextListItemData) break;

        // List items with an explicit `orderStart` start a new sequence.
        if (nextListItemData.orderStart !== null) break;

        // A list item at a lower indentation level ends the child list.
        if (nextListItemData.indent < indent) break;

        // A list item at a higher indentation level is nested and should be skipped.
        if (nextListItemData.indent > indent) {
            nextListItemElement = nextListItemElement.nextSibling;
            continue;
        }

        // If the next list item is already numbered correctly then the rest of the
        // sequence should also be correctly numbered so we don't need to continue.
        if (nextListItemData.indent === nextListItemNumber) break;

        nextListItemElement.dataset.listNumber = String(nextListItemNumber);

        nextListItemElement = nextListItemElement.nextSibling;
        nextListItemNumber++;
    }
}

const orderListItemSiblingObserverByParentNode = new Map<
    ParentNode,
    {
        count: number;
        disconnect: () => void;
    }
>();

/**
 * Watch the provided node and when nodes are removed above an ordered list item,
 * update the numbers for the list item.
 */
function observeOrderListItemSiblingMutations(parentNode: ParentNode): () => void {
    const observer = getOrSetDefaultMapValue(
        orderListItemSiblingObserverByParentNode,
        parentNode,
        () => {
            const observer = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    if (
                        mutation.type !== "childList" ||
                        (mutation.addedNodes.length === 0 && mutation.removedNodes.length === 0) ||
                        !mutation.nextSibling
                    ) {
                        continue;
                    }

                    let nextListItemElement: globalThis.Node | null = mutation.nextSibling;
                    let currentListItemIndent: number | undefined;

                    while (nextListItemElement && nextListItemElement instanceof HTMLElement) {
                        const nextListItemData = parseListItemData(nextListItemElement);

                        // Non-list items end the list.
                        if (!nextListItemData) break;

                        // The first time we see a list item at a given indentation level, reset its number
                        // in case the deleted element changed anything.
                        if (
                            currentListItemIndent === undefined ||
                            nextListItemData.indent < currentListItemIndent
                        ) {
                            currentListItemIndent = nextListItemData.indent;
                            setOrderedListItemNumber(nextListItemElement);
                        }

                        // Once we reach the lowest indentation level there's no other list sequence we may
                        // need to reset.
                        if (currentListItemIndent === 0) break;

                        nextListItemElement = nextListItemElement.nextSibling;
                    }
                }
            });

            observer.observe(parentNode, {childList: true});

            return {
                count: 0,
                disconnect: () => observer.disconnect(),
            };
        },
    );

    observer.count++;

    return () => {
        observer.count--;

        if (observer.count === 0) {
            observer.disconnect();
            orderListItemSiblingObserverByParentNode.delete(parentNode);
        }
    };
}
