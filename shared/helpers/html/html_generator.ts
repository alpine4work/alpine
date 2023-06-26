import escapeHtml from "escape-html";
import voidHtmlTagNames from "html-tags/void";
import {assert} from "~/shared/helpers/control/assert.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
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

    generateHtml() {
        return escapeHtml(this._text);
    }

    generateNode() {
        return document.createTextNode(this._text);
    }
}

export abstract class HtmlContainerGenerator implements HtmlGenerator {
    private _children: Array<HtmlGenerator> = [];

    appendChild(node: HtmlGenerator) {
        this._children.push(node);
    }

    removeAllChildren() {
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

    abstract generateHtml(): string;
    abstract generateNode(): Node;
}

export class HtmlElementGenerator extends HtmlContainerGenerator {
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

        this._attributes.set(attributeName, String(attributeValue));
    }

    generateHtml() {
        let html = `<${this._tagName}`;

        for (const [attributeName, attributeValue] of this._attributes) {
            html += ` ${attributeName}="${escapeHtml(attributeValue)}"`;
        }

        html += ">";

        const childrenHtml = this._generateChildrenHtml();

        if (childrenHtml === "" && voidHtmlTagNames.includes(this._tagName as any)) {
            return html;
        }

        html += `${childrenHtml}</${this._tagName}>`;

        return html;
    }

    generateNode() {
        const element = document.createElement(this._tagName);

        for (const [attributeName, attributeValue] of this._attributes) {
            element.setAttribute(attributeName, attributeValue);
        }

        this._appendChildNodes(element);

        return element;
    }
}

export class HtmlFragmentGenerator extends HtmlContainerGenerator {
    generateHtml() {
        return this._generateChildrenHtml();
    }

    generateNode() {
        const fragment = document.createDocumentFragment();

        this._appendChildNodes(fragment);

        return fragment;
    }
}
