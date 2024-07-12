import {DOMOutputSpec, DOMSerializer, Fragment, Mark, Node, Schema} from "prosemirror-model";
import {getAccountClientStoreForClient} from "~/client/accounts/account_client_store_context_provider.js";
import {createContentMentionTextStore} from "~/client/accounts/create_content_mention_text_store.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {clampListItemIndentation} from "~/shared/content/content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

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
    static fromSchemaWithContentReferences(
        schema: Schema,
        getSpaceId: () => SpaceId,
        getContentReferences: () => ContentReferences,
    ): ContentEditorDomClipboardSerializer {
        return new ContentEditorDomClipboardSerializer(
            this.nodesFromSchema(schema),
            this.marksFromSchema(schema),
            getSpaceId,
            getContentReferences,
        );
    }

    private readonly _getSpaceId: () => SpaceId;
    private readonly _getContentReferences: () => ContentReferences;

    protected constructor(
        nodes: {[node: string]: (node: Node) => DOMOutputSpec},
        marks: {[mark: string]: (mark: Mark, inline: boolean) => DOMOutputSpec},
        getSpaceId: () => SpaceId,
        getContentReferences: () => ContentReferences,
    ) {
        super(nodes, marks);
        this._getSpaceId = getSpaceId;
        this._getContentReferences = getContentReferences;
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

        if (node.type.name === "mention") {
            const dom = document.createElement("span");
            const mention: ContentMention = node.attrs.mention;
            const mentionText = createContentMentionTextStore(
                getAccountClientStoreForClient(this._getSpaceId()),
                this._getContentReferences(),
                mention,
            ).getSnapshot();
            dom.dataset.mentionAccount = mention.accountId;
            if (mention.isShort) dom.dataset.mentionShort = "true";
            dom.textContent = `@${mentionText}`;
            return dom;
        }

        if (node.type.name === "codeBlock") {
            const preDom = document.createElement("pre");
            const codeDom = document.createElement("code");

            if (node.attrs.language && node.attrs.language !== "text") {
                codeDom.setAttribute("data-language", node.attrs.language);
            }

            let isFirstChild = true;

            node.forEach(childNode => {
                assert(childNode.type.name === "codeBlockLine");

                if (isFirstChild) {
                    isFirstChild = false;
                } else {
                    codeDom.appendChild(document.createTextNode("\n"));
                }

                // Serialize each `codeBlockLine` directly into our `<code>` element. We don't
                // want to call `serializeNodeInner()` for `codeBlockLine` since that'll create
                // a DOM element for each line which we don't want to put on the clipboard.
                this.serializeFragment(childNode.content, options, codeDom);
            });

            preDom.appendChild(codeDom);
            return preDom;
        }

        // If we're serializing content within a single `codeBlockLine` then serialize
        // to a `<code>` element. So when pasted the text gets code styles. This
        // happens when you copy some text in a single line of a code block.
        //
        // This branch is not executed when serializing a `codeBlock`. Instead we
        // serialize `codeBlockLine` children directly in the `codeBlock` serializer.
        if (node.type.name === "codeBlockLine") {
            const codeDom = document.createElement("code");

            this.serializeFragment(node.content, options, codeDom);

            return codeDom;
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
                // `<li>` children. If there's a direct `<li>` child then we need to
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
