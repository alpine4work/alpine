import escapeHTML from "escape-html";
import voidHtmlTagNames from "html-tags/void";
import {DOMOutputSpec, Fragment, Mark, Node} from "prosemirror-model";
import {assert} from "~/shared/helpers/control/assert";
import {isIdentifier} from "~/shared/helpers/string/is_identifier";
import {quote} from "~/shared/helpers/string/quote";

export type ProsemirrorHtmlSerializationOptions = {
    nodeRenderers?: {
        [nodeName: string]:
            | ((
                  node: Node,
                  pos: number,
              ) => {
                  html: HtmlGenerator;
                  contentHtml?: ElementHtmlGenerator;
              })
            | undefined;
    };
    markRenderers?: {
        [markName: string]: (
            mark: Mark,
            inline: boolean,
        ) => {
            html: ElementHtmlGenerator;
            contentHtml?: ElementHtmlGenerator;
        };
    };
};

/**
 * Serializes a ProseMirror node to an HTML string.
 *
 * ProseMirror only ships with a way to serialize nodes to DOM nodes. When
 * server-side rendering we don’t have access to the DOM and so need to be able
 * to serialize ProseMirror content to an HTML string.
 */
export function serializeProsemirrorNodeToHtml(
    node: Node,
    options: ProsemirrorHtmlSerializationOptions = {},
): string {
    return serializeProsemirrorNode(0, node, options).generateHtml();
}

/**
 * Serializes a ProseMirror fragment to an HTML string.
 *
 * ProseMirror only ships with a way to serialize nodes to DOM nodes. When
 * server-side rendering we don’t have access to the DOM and so need to be able
 * to serialize ProseMirror content to an HTML string.
 */
export function serializeProsemirrorFragmentToHtml(
    fragment: Fragment,
    options: ProsemirrorHtmlSerializationOptions & {startPos?: number} = {},
): string {
    return serializeProsemirrorFragment(
        options.startPos ?? 0,
        fragment,
        new FragmentHTMLGenerator(),
        options,
    ).generateHtml();
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
function serializeProsemirrorNode(
    pos: number, // Position at the start of the node
    node: Node,
    options: ProsemirrorHtmlSerializationOptions,
): HtmlGenerator {
    let html: HtmlGenerator;
    let contentHtml: ElementHtmlGenerator | undefined;

    const nodeRenderer = options.nodeRenderers?.[node.type.name];
    if (nodeRenderer) {
        ({html, contentHtml} = nodeRenderer(node, pos));
    } else {
        const toDOM = node.type.spec.toDOM ?? (node.type.name === "text" ? defaultTextToDom : null);
        assert(toDOM, `Could not find renderer for node type "${node.type.name}"`);
        ({html, contentHtml} = renderProsemirrorDomOutputSpec(toDOM(node)));
    }

    if (contentHtml !== undefined) {
        assert(!node.isLeaf, "Content hole not allowed in a leaf node spec");
        serializeProsemirrorFragment(pos + 1, node.content, contentHtml, options);
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
function serializeProsemirrorMark(
    mark: Mark,
    inline: boolean,
    options: ProsemirrorHtmlSerializationOptions,
): {html: ElementHtmlGenerator; contentHtml?: ElementHtmlGenerator} | null {
    let html: HtmlGenerator;
    let contentHtml: ElementHtmlGenerator | undefined;

    const markRenderer = options.markRenderers?.[mark.type.name];
    if (markRenderer) {
        ({html, contentHtml} = markRenderer(mark, inline));
    } else {
        const toDOM = mark.type.spec.toDOM;
        if (!toDOM) return null;
        ({html, contentHtml} = renderProsemirrorDomOutputSpec(toDOM(mark, inline)));
    }

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
function serializeProsemirrorFragment(
    pos: number, // Position of the first node in the fragment
    fragment: Fragment,
    targetContainer: ContainerHtmlGenerator,
    options: ProsemirrorHtmlSerializationOptions,
) {
    let currentTargetContainer: ContainerHtmlGenerator = targetContainer;
    let activeMarkContainers: Array<[Mark, ContainerHtmlGenerator]> | null = null;

    fragment.forEach((node, offset) => {
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
                const markHtml = serializeProsemirrorMark(newMark, node.isInline, options);
                if (markHtml) {
                    activeMarkContainers.push([newMark, currentTargetContainer]);
                    currentTargetContainer.appendChild(markHtml.html);
                    const nextTargetElement = markHtml.contentHtml ?? markHtml.html;
                    currentTargetContainer = nextTargetElement;
                }
            }
        }

        currentTargetContainer.appendChild(serializeProsemirrorNode(pos + offset, node, options));
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
export function renderProsemirrorDomOutputSpec(structure: DOMOutputSpec): {
    html: HtmlGenerator;
    contentHtml?: ElementHtmlGenerator;
} {
    if (typeof structure === "string") return {html: new TextHtmlGenerator(structure)};

    assert(Array.isArray(structure), "Can not server-side render node that returns a DOM node");

    return renderProsemirrorDomOutputSpecArray(structure);
}

function renderProsemirrorDomOutputSpecArray(structure: DOMOutputSpecArray): {
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
            const {html: innerHTML, contentHtml: innerContentHtml} =
                renderProsemirrorDomOutputSpec(child);
            html.appendChild(innerHTML);
            if (innerContentHtml !== undefined) {
                assert(contentHtml === undefined, "Multiple content holes");
                contentHtml = innerContentHtml;
            }
        }
    }

    return {html, contentHtml};
}

export interface HtmlGenerator {
    generateHtml(): string;
}

export class TextHtmlGenerator implements HtmlGenerator {
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

    protected _generateChildrenHtml() {
        let html = "";

        for (const child of this._children) {
            html += child.generateHtml();
        }

        return html;
    }

    abstract generateHtml(): string;
}

export class ElementHtmlGenerator extends ContainerHtmlGenerator {
    private readonly _tagName: string;
    private readonly _attributes = new Map<string, string>();

    constructor(tagName: string) {
        super();

        assert(
            isIdentifier(tagName),
            quote`Invalid tag name ${tagName}, we currently only support simple tag names`,
        );

        this._tagName = tagName;
    }

    setAttribute(attributeName: string, attributeValue: unknown) {
        assert(
            /^[a-z]([a-z0-9-]*[a-z0-9]|)$/.test(attributeName),
            quote`Invalid attribute name ${attributeName}, we currently only support simple attribute names`,
        );

        this._attributes.set(attributeName, escapeHTML(String(attributeValue)));
    }

    generateHtml() {
        let html = `<${this._tagName}`;

        for (const [attributeName, attributeValue] of this._attributes) {
            html += ` ${attributeName}="${attributeValue}"`;
        }

        html += ">";

        const childrenHtml = this._generateChildrenHtml();

        if (childrenHtml === "" && voidHtmlTagNames.includes(this._tagName as any)) {
            return html;
        }

        html += `${childrenHtml}</${this._tagName}>`;

        return html;
    }
}

export class FragmentHTMLGenerator extends ContainerHtmlGenerator {
    generateHtml() {
        return this._generateChildrenHtml();
    }
}
