import escapeHTML from "escape-html";
import voidHTMLTagNames from "html-tags";
import {DOMOutputSpec, Fragment, Mark, Node} from "prosemirror-model";
import {assert} from "~/shared/helpers/control/assert";
import {isIdentifier} from "~/shared/helpers/string/is_identifier";
import {quote} from "~/shared/helpers/string/quote";

/**
 * Serializes a ProseMirror node to an HTML string.
 *
 * ProseMirror only ships with a way to serialize nodes to DOM nodes. When
 * server-side rendering we don’t have access to the DOM and so need to be able
 * to serialize ProseMirror content to an HTML string.
 */
export function serializeProsemirrorNodeToHtml(node: Node): string {
    return serializeNode(node).generateHtml();
}

/**
 * Serializes a ProseMirror fragment to an HTML string.
 *
 * ProseMirror only ships with a way to serialize nodes to DOM nodes. When
 * server-side rendering we don’t have access to the DOM and so need to be able
 * to serialize ProseMirror content to an HTML string.
 */
export function serializeProsemirrorFragmentToHtml(fragment: Fragment): string {
    return serializeFragment(fragment, new FragmentHTMLGenerator()).generateHtml();
}

type DOMOutputSpecArray = _DOMOutputSpecArray<DOMOutputSpec>;
type _DOMOutputSpecArray<Spec extends DOMOutputSpec> = Spec extends Array<any> ? Spec : never;

function defaultTextToDom(node: Node): DOMOutputSpec {
    assert(node.isText);
    return node.text!;
}

function isDomNode(structure: object): structure is globalThis.Node {
    return (structure as any).contentType != null;
}

/**
 * Serializes a ProseMirror node to HTML. Has the same implementation as
 * [`DOMSerializer.serializeNode()`][1] but for an HTML string instead of DOM
 * nodes.
 *
 * [1]: https://github.com/ProseMirror/prosemirror-model/blob/a0556b82869a7ecda732f7c4e26d42caed1a4e40/src/to_dom.js#L84-L96
 */
function serializeNode(node: Node): HtmlGenerator {
    const toDOM = node.type.spec.toDOM ?? (node.type.name === "text" ? defaultTextToDom : null);

    assert(toDOM, quote`Expected a "toDOM" function for node type ${node.type.name}`);

    const {html, contentHtml} = renderSpec(toDOM(node));

    if (contentHtml !== undefined) {
        assert(!node.isLeaf, "Content hole not allowed in a leaf node spec");
        serializeFragment(node.content, contentHtml);
    }

    return html;
}

/**
 * Serializes a ProseMirror mark to HTML. Has the same implementation as
 * [`DOMSerializer.serializeMark()`][1] but for an HTML string instead of DOM
 * nodes.
 *
 * [1]: https://github.com/ProseMirror/prosemirror-model/blob/a0556b82869a7ecda732f7c4e26d42caed1a4e40/src/to_dom.js#L110-L113
 */
function serializeMark(
    mark: Mark,
    inline: boolean,
): {html: ElementHtmlGenerator; contentHtml?: ElementHtmlGenerator} | null {
    const toDOM = mark.type.spec.toDOM;
    if (!toDOM) return null;
    const {html, contentHtml} = renderSpec(toDOM(mark, inline));
    assert(html instanceof ElementHtmlGenerator, "Marks are expected to return DOM elements");
    return {html, contentHtml};
}

/**
 * Serializes a ProseMirror fragment to HTML. Has the same implementation as
 * [`DOMSerializer.serializeFragment()`][1] but for an HTML string instead of
 * DOM nodes.
 *
 * [1]: https://github.com/ProseMirror/prosemirror-model/blob/a0556b82869a7ecda732f7c4e26d42caed1a4e40/src/to_dom.js#L44-L76
 */
function serializeFragment(fragment: Fragment, targetContainer: ContainerHtmlGenerator) {
    let currentTargetContainer: ContainerHtmlGenerator = targetContainer;
    let activeMarkContainers: Array<[Mark, ContainerHtmlGenerator]> | null = null;

    fragment.forEach(node => {
        if (activeMarkContainers || node.marks.length) {
            if (!activeMarkContainers) activeMarkContainers = [];

            let keepActiveMarks = 0;
            let renderedMarks = 0;

            // We don't want to render any marks that are already active.
            while (
                keepActiveMarks < activeMarkContainers.length &&
                renderedMarks < node.marks.length
            ) {
                const mark = node.marks[renderedMarks]!;
                if (!mark.type.spec.toDOM) {
                    renderedMarks++;
                    continue;
                }

                if (
                    !mark.eq(activeMarkContainers[keepActiveMarks]![0]) ||
                    mark.type.spec.spanning === false
                )
                    break;

                keepActiveMarks++;
                renderedMarks++;
            }

            while (keepActiveMarks < activeMarkContainers.length) {
                currentTargetContainer = activeMarkContainers.pop()![1];
            }

            while (renderedMarks < node.marks.length) {
                const newMark = node.marks[renderedMarks++]!;
                const markHTML = serializeMark(newMark, node.isInline);
                if (markHTML) {
                    activeMarkContainers.push([newMark, currentTargetContainer]);
                    currentTargetContainer.appendChild(markHTML.html);
                    const nextTargetElement = markHTML.contentHtml ?? markHTML.html;
                    currentTargetContainer = nextTargetElement;
                }
            }
        }

        currentTargetContainer.appendChild(serializeNode(node));
    });

    return targetContainer;
}

/**
 * Renders a `DOMOutputSpec` to HTML. Has the same implementation as
 * [`DOMSerializer.renderSpec()`][1] but for an HTML string instead of DOM
 * nodes.
 *
 * [1]: https://github.com/ProseMirror/prosemirror-model/blob/a0556b82869a7ecda732f7c4e26d42caed1a4e40/src/to_dom.js#L115-L157
 */
function renderSpec(structure: DOMOutputSpec): {
    html: HtmlGenerator;
    contentHtml?: ElementHtmlGenerator;
} {
    if (typeof structure === "string") return {html: new TextHtmlGenerator(structure)};

    assert(Array.isArray(structure), "Can not server-side render node that returns a DOM node");

    return renderSpecArray(structure);
}

function renderSpecArray(structure: DOMOutputSpecArray): {
    html: HtmlGenerator;
    contentHtml?: ElementHtmlGenerator;
} {
    const tagName = structure[0];
    const attributes = structure[1];

    const html = new ElementHtmlGenerator(tagName);
    let contentHtml = undefined;

    let childrenStart = 1;
    if (
        attributes &&
        typeof attributes === "object" &&
        !isDomNode(attributes) &&
        !Array.isArray(attributes)
    ) {
        childrenStart = 2;
        for (const attributeName in attributes) {
            if (attributes[attributeName] == null) continue;
            html.setAttribute(attributeName, attributes[attributeName]);
        }
    }

    const structureLength: number = (structure as any).length;
    for (let i = childrenStart; i < structureLength; i++) {
        const child = (structure as any)[i];
        if (child === 0) {
            assert(
                !(i < structureLength - 1 || i > childrenStart),
                "Content hole must be the only child of its parent node",
            );
            return {html, contentHtml: html};
        } else {
            const {html: innerHTML, contentHtml: innerContentHtml} = renderSpec(child);
            html.appendChild(innerHTML);
            if (innerContentHtml !== undefined) {
                assert(contentHtml === undefined, "Multiple content holes");
                contentHtml = innerContentHtml;
            }
        }
    }

    return {html, contentHtml};
}

interface HtmlGenerator {
    generateHtml(): string;
}

class TextHtmlGenerator implements HtmlGenerator {
    private _escapedText: string;

    constructor(text: string) {
        this._escapedText = escapeHTML(text);
    }

    generateHtml() {
        return this._escapedText;
    }
}

abstract class ContainerHtmlGenerator implements HtmlGenerator {
    private _children: Array<HtmlGenerator> = [];

    appendChild(node: HtmlGenerator) {
        this._children.push(node);
    }

    protected _generateChildrenHTML() {
        let html = "";

        for (const child of this._children) {
            html += child.generateHtml();
        }

        return html;
    }

    abstract generateHtml(): string;
}

class ElementHtmlGenerator extends ContainerHtmlGenerator {
    private readonly _tagName: string;
    private _openTagAndAttributes: string;

    constructor(tagName: string) {
        super();

        assert(
            isIdentifier(tagName),
            quote`Invalid tag name ${tagName}, we currently only support simple tag names`,
        );

        this._tagName = tagName;
        this._openTagAndAttributes = `<${tagName}`;
    }

    setAttribute(attributeName: string, attributeValue: unknown) {
        assert(
            isIdentifier(attributeName),
            quote`Invalid attribute name ${attributeName}, we currently only support simple attribute names`,
        );

        this._openTagAndAttributes += ` ${attributeName}="${escapeHTML(String(attributeValue))}"`;
    }

    generateHtml() {
        let html = `${this._openTagAndAttributes}>`;

        const childrenHTML = this._generateChildrenHTML();

        if (childrenHTML === "" && voidHTMLTagNames.includes(this._tagName as any)) {
            return html;
        }

        html += `${childrenHTML}</${this._tagName}>`;

        return html;
    }
}

class FragmentHTMLGenerator extends ContainerHtmlGenerator {
    generateHtml() {
        return this._generateChildrenHTML();
    }
}
