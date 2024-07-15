import escapeHtml from "escape-html";
import voidHtmlTagNames from "html-tags/void.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {quote} from "~/shared/helpers/string/quote.js";

export interface HtmlGenerator {
    generateHtml(): string;
    generateNode(): Node;
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

    public appendChild(node: HtmlGenerator) {
        this._children.push(node);
    }

    public insertBefore(newNode: HtmlGenerator, referenceNode: HtmlGenerator) {
        const index = this._children.indexOf(referenceNode);
        assert(index !== -1, "Couldn't find reference node");
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

    public abstract generateHtml(): string;
    public abstract generateNode(): Node;
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
}
