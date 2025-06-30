import escapeHtml from "escape-html";
import voidHtmlTagNames from "html-tags/void.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {SafeString} from "~/shared/helpers/string/safe_string.js";

export interface HtmlGenerator {
    /**
     * Generate an HTML string. Can be provided to a web browser for parsing and
     * rendering. Useful for rendering ProseMirror content outside of React in a
     * server context.
     */
    generateHtml(): string;

    /**
     * Generate a DOM node in the browser which is identical to if the browser
     * parsed the result of `generateHtml()`.
     */
    generateNode(): Node;

    /**
     * Patch a DOM node (ideally from `generateNode()`) to be the same as our HTML
     * generator. Leaving in place as much of the tree as we can. This function is
     * not as smart as React's diff/patch algorithm. For instance, it doesn't
     * understand when you reorder children. But it's useful for implementing
     * interactive content in `<ContentEditor>` that uses `HtmlGenerator` so it can
     * also be rendered by `<ContentView>`.
     *
     * Returns false if we can't patch the provided node. For example HTML elements
     * can only patch other HTML elements with the same tag name.
     *
     * If you have the previous `HtmlGenerator` instance used to generate `node`
     * then you should pass that into `previous`. It'll be used for more
     * intelligent patching of the DOM. For example, preserving class names that
     * were manually added to the DOM and aren't included in `HtmlGenerator`.
     */
    patchNode(previous: HtmlGenerator | null, node: Node): boolean;
}

export class HtmlTextGenerator implements HtmlGenerator {
    private _text: string;

    constructor(text: string) {
        this._text = text;
    }

    public generateHtml() {
        return escapeHtml(this._text);
    }

    public generateNode() {
        return document.createTextNode(this._text);
    }

    public patchNode(previous: HtmlGenerator | null, node: Node) {
        if (!(node instanceof Text)) return false;

        if (node.data !== this._text) {
            node.data = this._text;
        }

        return true;
    }
}

export abstract class HtmlContainerGenerator implements HtmlGenerator {
    private _children: Array<HtmlGenerator> = [];

    public get childElementCount(): number {
        let count = 0;

        for (const node of this._children) {
            if (node instanceof HtmlElementGenerator) {
                count++;
            }
        }

        return count;
    }

    public get firstElementChild(): HtmlElementGenerator | null {
        for (const node of this._children) {
            if (node instanceof HtmlElementGenerator) {
                return node;
            }
        }

        return null;
    }

    // An API similar to `Element.children` that only returns child elements.
    // Instead of a property this is a function that returns an iterable.
    //
    // https://developer.mozilla.org/en-US/docs/Web/API/Element/children
    public *children(): Iterable<HtmlElementGenerator> {
        for (const generator of this._children) {
            if (generator instanceof HtmlElementGenerator) {
                yield generator;
            }
        }
    }

    public appendChild<Node extends HtmlGenerator>(node: Node): Node {
        this._children.push(node);

        // The DOM `appendChild()` method returns the appended child. Which is
        // convenient so we do it here too.
        // https://developer.mozilla.org/en-US/docs/Web/API/Node/appendChild
        return node;
    }

    public insertBefore(newNode: HtmlGenerator, referenceNode: HtmlGenerator) {
        const index = this._children.indexOf(referenceNode);
        assert(index !== -1, "Couldn’t find reference node");
        this._children.splice(index, 0, newNode);
    }

    public removeAllChildren() {
        this._children = [];
    }

    protected _generateChildrenHtml() {
        let html = "";

        for (const child of this._children) {
            html += child.generateHtml();
        }

        return html;
    }

    protected _appendChildNodes(parentNode: Node) {
        for (const child of this._children) {
            parentNode.appendChild(child.generateNode());
        }
    }

    protected _patchChildNodes(previous: HtmlGenerator | null, parentNode: Node) {
        const endChildNodeIndex = this._actuallyPatchChildNodes(previous, parentNode, 0);

        while (parentNode.childNodes.length > endChildNodeIndex) {
            parentNode.lastChild!.remove();
        }
    }

    private _actuallyPatchChildNodes(
        previous: HtmlGenerator | null,
        parentNode: Node,
        startChildNodeIndex: number,
    ): number {
        const previousContainer = previous instanceof HtmlContainerGenerator ? previous : null;
        let childNodeIndex = startChildNodeIndex;

        for (let childIndex = 0; childIndex < this._children.length; childIndex++) {
            const child = this._children[childIndex]!;
            const previousChild = previousContainer?._children[childIndex] ?? null;

            // When a `DocumentFragment` (created by `HtmlFragmentGenerator`) is appended
            // to an `HTMLElement` its child contents are inlined directly in the
            // `HTMLElement`. So when patching a `HtmlFragmentGenerator` we need to unwrap
            // its children.
            if (child instanceof HtmlFragmentGenerator) {
                childNodeIndex = child._actuallyPatchChildNodes(
                    previousChild,
                    parentNode,
                    childNodeIndex,
                );
                continue;
            }

            if (childNodeIndex < parentNode.childNodes.length) {
                const childNode = parentNode.childNodes[childNodeIndex]!;

                // If we can't patch the child node, then replace it.
                if (!child.patchNode(previousChild, childNode)) {
                    const newChildNode = child.generateNode();
                    parentNode.replaceChild(newChildNode, childNode);
                }
            } else {
                parentNode.appendChild(child.generateNode());
            }

            childNodeIndex++;
        }

        return childNodeIndex;
    }

    public abstract generateHtml(): string;
    public abstract generateNode(): Node;
    public abstract patchNode(previous: HtmlGenerator | null, node: Node): boolean;
}

export class HtmlElementGenerator extends HtmlContainerGenerator {
    public readonly tagName: string;
    private readonly _attributes = new Map<string, string>();

    constructor(tagName: string) {
        super();

        assert(
            /^[a-z][a-z0-9]*$/.test(tagName),
            quote`Invalid tag name ${tagName}, we currently only support simple, lower case, tag names`,
        );

        this.tagName = tagName;
    }

    public getAttribute(attributeName: string): string | null {
        return this._attributes.get(attributeName) ?? null;
    }

    public setAttribute(attributeName: string, attributeValue: unknown) {
        assert(
            /^[a-z]([a-z0-9-]*[a-z0-9]|)$/.test(attributeName),
            quote`Invalid attribute name ${attributeName}, we currently only support simple attribute names`,
        );

        this._attributes.set(attributeName, String(attributeValue));
    }

    public generateHtml() {
        let html = `<${this.tagName}`;

        for (const [attributeName, attributeValue] of this._attributes) {
            // eslint-disable-next-line string-quotes
            html += ` ${attributeName}="${escapeHtml(attributeValue)}"`;
        }

        html += ">";

        const childrenHtml = this._generateChildrenHtml();

        if (childrenHtml === "" && voidHtmlTagNames.includes(this.tagName as any)) {
            return html;
        }

        html += `${childrenHtml}</${this.tagName}>`;

        return html;
    }

    public generateNode() {
        const element = document.createElement(this.tagName);

        for (const [attributeName, attributeValue] of this._attributes) {
            element.setAttribute(attributeName, attributeValue);
        }

        this._appendChildNodes(element);

        return element;
    }

    public patchNode(previous: HtmlGenerator | null, node: Node) {
        if (!(node instanceof HTMLElement)) return false;
        if (node.tagName.toLowerCase() !== this.tagName) return false;

        // If we have the previous `HtmlElementGenerator` then when updating the
        // element's attributes only remove attributes that were in our previous
        // `HtmlElementGenerator`.
        //
        // React does this as well. Our implementation may not be as smart as React's.
        // We may leave around some incorrect attributes if child nodes are re-ordered.
        for (const attributeName of previous instanceof HtmlElementGenerator
            ? previous._attributes.keys()
            : node.getAttributeNames()) {
            // If we have the previous `HtmlElementGenerator` then when updating the
            // `class` attribute only remove classes that were in our previous
            // `HtmlElementGenerator`. This way if a class was manually added to the
            // element (e.g. ProseMirror manually adds the `ProseMirror-selectednode` class
            // when a node is selected) we don't remove the class from the node.
            //
            // React does this as well. Our implementation may not be as smart as React's.
            // We may leave around some incorrect classes if child nodes are re-ordered.
            //
            // Test case for checking this logic in the product: Upload a file to a
            // document. The file should be immediately selected and get the
            // `ProseMirror-selectednode` class. Eventually the file will finish updating
            // causing the file node to re-render and `patchNode()` to be called. At this
            // point, `ProseMirror-selectednode` should not be removed from the element.
            if (attributeName === "class" && previous instanceof HtmlElementGenerator) {
                const previousClassName = previous.getAttribute("class");
                const newClassName = this._attributes.get(attributeName);

                const previousClassList = previousClassName?.split(/\s+/);
                const newClassList =
                    newClassName !== undefined ? new Set(newClassName.split(/\s+/)) : undefined;

                if (previousClassList !== undefined) {
                    for (const previousClassItem of previousClassList) {
                        if (newClassList?.has(previousClassItem) !== true) {
                            node.classList.remove(previousClassItem);
                        }
                    }
                }

                if (newClassList !== undefined) {
                    for (const newClassItem of newClassList) {
                        node.classList.add(newClassItem);
                    }
                }

                if (node.classList.length === 0) {
                    node.removeAttribute("class");
                }
                continue;
            }

            const oldAttributeValue = node.getAttribute(attributeName)!;
            const newAttributeValue = this._attributes.get(attributeName);

            if (newAttributeValue === undefined) {
                node.removeAttribute(attributeName);
            } else if (oldAttributeValue !== newAttributeValue) {
                node.setAttribute(attributeName, newAttributeValue);
            }
        }

        for (const [attributeName, attributeValue] of this._attributes) {
            if (
                previous instanceof HtmlElementGenerator
                    ? !previous._attributes.has(attributeName)
                    : !node.hasAttribute(attributeName)
            ) {
                node.setAttribute(attributeName, attributeValue);
            }
        }

        this._patchChildNodes(previous, node);

        return true;
    }
}

export class HtmlFragmentGenerator extends HtmlContainerGenerator {
    public generateHtml() {
        return this._generateChildrenHtml();
    }

    public generateNode() {
        const fragment = document.createDocumentFragment();

        this._appendChildNodes(fragment);

        return fragment;
    }

    public patchNode(previous: HtmlGenerator | null, node: Node) {
        if (!(node instanceof DocumentFragment) && !(node instanceof Element)) return false;

        this._patchChildNodes(previous, node);

        return true;
    }
}

export class HtmlScriptGenerator extends HtmlElementGenerator {
    private readonly _scriptContent: string;

    constructor(scriptContent: SafeString) {
        super("script");
        this._scriptContent = scriptContent.string;
    }

    public override generateHtml() {
        return `<script>${this._scriptContent}</script>`;
    }

    public override generateNode() {
        const script = document.createElement("script");
        script.textContent = this._scriptContent;
        return script;
    }

    public override patchNode(previous: HtmlGenerator | null, node: Node) {
        if (!(node instanceof HTMLScriptElement)) return false;

        if (node.textContent !== this._scriptContent) {
            node.textContent = this._scriptContent;
        }

        return true;
    }

    private disallowedMethod() {
        // We don't allow modifying the script tag's attributes.
        throw new FailedPreconditionError("Cannot set attributes on HtmlScriptGenerator");
    }

    public override setAttribute() {
        this.disallowedMethod();
    }

    public override appendChild<Node extends HtmlGenerator>(node: Node): Node {
        this.disallowedMethod();
        return node;
    }

    public override insertBefore() {
        this.disallowedMethod();
    }

    public override removeAllChildren() {
        this.disallowedMethod();
    }
}
