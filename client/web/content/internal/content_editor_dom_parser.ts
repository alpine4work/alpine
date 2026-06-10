import {DOMParser, Node, ParseOptions, ParseRule, Schema, Slice} from "prosemirror-model";

// Augment with types for some internal methods from:
// https://github.com/ProseMirror/prosemirror-model/blob/26c634ffff8ad6544fda12ed70c99f12a65959f3/src/from_dom.ts#L161
declare module "prosemirror-model" {
    interface DOMParser {
        normalizeLists: boolean;
    }
}

/**
 * `DOMParser` but with better support for parsing list items into our schema.
 */
export class ContentEditorDomParser extends DOMParser {
    static override fromSchema(schema: Schema): ContentEditorDomParser {
        return (
            schema.cached.contentEditorDomParser ||
            (schema.cached.contentEditorDomParser = new ContentEditorDomParser(
                schema,
                // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                // fixing for now.
                // @ts-expect-error
                DOMParser.schemaRules(schema),
            ))
        );
    }

    constructor(schema: Schema, rules: ReadonlyArray<ParseRule>) {
        super(schema, rules);

        // Never normalize lists. We actually want to do the opposite of `DOMParser` list
        // normalization. We want `<li>`s to NOT contain nested lists.
        this.normalizeLists = false;
    }

    override parse(dom: globalThis.Node, options?: ParseOptions): Node {
        normalizeLists(dom);
        return super.parse(dom, options);
    }

    override parseSlice(dom: globalThis.Node, options?: ParseOptions): Slice {
        normalizeLists(dom);
        return super.parseSlice(dom, options);
    }
}

/**
 * Does the opposite of the built-in DOM parser [list normalization][1]. If we find
 * a list nested inside an `<li>`, remove it from the `<li>` and put it directly in
 * the parent `<ul>`/`<ol>`. While this is not semantic list HTML, it matches our
 * content schema for lists (which has no `<ul>`/`<ol>` nesting).
 *
 * So:
 *
 * ```html
 * <ul>
 *     <li>
 *         Item 1
 *         <ul>
 *             <li>Item 1a</li>
 *         </ul>
 *     </li>
 *     <li>Item 2</li>
 * </ul>
 * ```
 *
 * Becomes:
 *
 * ```html
 * <ul>
 *     <li>Item 1</li>
 *     <ul>
 *         <li>Item 1a</li>
 *     </ul>
 *     <li>Item 2</li>
 * </ul>
 * ```
 *
 * [1]:
 *     https://github.com/ProseMirror/prosemirror-model/blob/26c634ffff8ad6544fda12ed70c99f12a65959f3/src/from_dom.ts#L774-L789
 */
function normalizeLists(rootNode: globalThis.Node) {
    if (!(rootNode instanceof HTMLElement)) return;

    const elements = rootNode.querySelectorAll("ul, ol");

    for (const element of elements) {
        for (
            let childNode = element.firstElementChild;
            childNode;
            childNode = childNode.nextElementSibling
        ) {
            if (
                childNode.tagName === "LI" &&
                childNode.lastElementChild &&
                (childNode.lastElementChild.tagName === "UL" ||
                    childNode.lastElementChild.tagName === "OL")
            ) {
                const listNode = childNode.lastElementChild;
                childNode.removeChild(listNode);
                element.insertBefore(listNode, childNode.nextSibling);
            }
        }
    }
}
