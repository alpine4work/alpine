import {DOMSerializer, Fragment, Mark, Node, Schema} from "prosemirror-model";
import {clampListItemIndentation} from "~/shared/content/content-schema";
import {iterableEvery} from "~/shared/helpers/iterable/iterable-every";

// Augment with types for some internal methods from:
// https://github.com/ProseMirror/prosemirror-model/blob/26c634ffff8ad6544fda12ed70c99f12a65959f3/src/to_dom.ts#L27
declare module "prosemirror-model" {
    class DOMSerializer {
        serializeNodeInner(node: Node, options: {document?: Document}): globalThis.Node;
        serializeMark(
            mark: Mark,
            inline: boolean,
            options: {document?: Document},
        ):
            | {
                  dom: globalThis.Node;
                  contentDOM?: HTMLElement;
              }
            | undefined;
    }
}

/**
 * `DOMSerializer` but with better support for serializing nested lists
 * to HTML.
 */
export class ContentEditorDomClipboardSerializer extends DOMSerializer {
    static override fromSchema(schema: Schema): ContentEditorDomClipboardSerializer {
        return (
            schema.cached.contentEditorDomClipboardSerializer ||
            (schema.cached.contentEditorDomClipboardSerializer =
                new ContentEditorDomClipboardSerializer(
                    this.nodesFromSchema(schema),
                    this.marksFromSchema(schema),
                ))
        );
    }

    override serializeNodeInner(node: Node, options: {document?: Document}): globalThis.Node {
        const document = options.document ?? window.document;

        if (node.type.name === "unorderedListItem")
            return this._serializeListItemNode("ul", node, options);
        if (node.type.name === "orderedListItem")
            return this._serializeListItemNode("ol", node, options);

        if (node.type.name === "checkListItem") {
            const checkboxDom = document.createElement("input");

            checkboxDom.setAttribute("type", "checkbox");
            checkboxDom.setAttribute("disabled", "");
            if (node.attrs.checked) checkboxDom.setAttribute("checked", "");

            return this._serializeListItemNode("ul", node, {
                ...options,
                prependContentDom: checkboxDom,
            });
        }

        const dom = super.serializeNodeInner(node, options);

        // Remove any custom styling for this element. Let the user agent styles for
        // wherever we're pasting apply.
        if (dom instanceof HTMLElement) {
            dom.removeAttribute("class");
            dom.removeAttribute("style");
        }

        return dom;
    }

    override serializeMark(mark: Mark, inline: boolean, options: {document?: Document}) {
        const result = super.serializeMark(mark, inline, options);

        // Remove any custom styling for this element. Let the user agent styles for
        // wherever we're pasting apply.
        if (result && result.dom instanceof HTMLElement) {
            result.dom.removeAttribute("class");
            result.dom.removeAttribute("style");
        }

        return result;
    }

    /**
     * When serializing a list item node, created nested `<ul>` and `<ol>` elements
     * to the list item's level of indentation.
     */
    private _serializeListItemNode(
        listTagName: "ul" | "ol",
        node: Node,
        options: {document?: Document; prependContentDom?: globalThis.Node},
    ): globalThis.Node {
        const document = options?.document ?? window.document;

        const indent = clampListItemIndentation(node.attrs.indent);

        const rootListDom = document.createElement(listTagName);
        let listDom = rootListDom;

        for (let i = 0; i < indent; i++) {
            const nestedListDom = document.createElement(listTagName);
            listDom.appendChild(nestedListDom);
            listDom = nestedListDom;
        }

        const listItemDom = document.createElement("li");
        listDom.appendChild(listItemDom);

        if (options.prependContentDom) {
            listItemDom.appendChild(options.prependContentDom);
        }

        this.serializeFragment(node.content, options, listItemDom);

        return rootListDom;
    }

    override serializeFragment(
        fragment: Fragment,
        options: {document?: Document} = {},
        target?: HTMLElement | DocumentFragment,
    ): HTMLElement | DocumentFragment {
        const dom = super.serializeFragment(fragment, options, target);

        this._flattenSerializedFragment(dom);

        return dom;
    }

    /**
     * Merge all adjacent `<ul>` and `<ol>` elements to create semantic list HTML.
     * Nested lists will not be nested under `<li>`s which is not, technically,
     * semantic but browsers and copy/paste systems commonly support it.
     */
    private _flattenSerializedFragment(dom: HTMLElement | DocumentFragment) {
        const flattenChildDoms = new Set<HTMLElement>();

        let childDom = dom.firstChild;
        while (childDom) {
            if (
                childDom instanceof HTMLElement &&
                (childDom.tagName === "UL" || childDom.tagName === "OL") &&
                childDom.nextSibling instanceof HTMLElement &&
                (childDom.nextSibling.tagName === "UL" || childDom.nextSibling.tagName === "OL") &&
                // We can merge if the list type is the same or if there are not any direct
                // `<li>` children. If there's a direct `<li>` children then we need to
                // preserve the list type.
                (childDom.nextSibling.tagName === childDom.tagName ||
                    iterableEvery(
                        childDom.nextSibling.childNodes,
                        cousinDom =>
                            !(cousinDom instanceof HTMLElement) || cousinDom.tagName !== "LI",
                    ))
            ) {
                for (const cousinDom of childDom.nextSibling.childNodes) {
                    childDom.appendChild(cousinDom);
                }
                dom.removeChild(childDom.nextSibling);
                flattenChildDoms.add(childDom);
            } else {
                childDom = childDom.nextSibling;
            }
        }

        for (const childDom of flattenChildDoms) {
            this._flattenSerializedFragment(childDom);
        }
    }
}
