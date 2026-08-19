import {DOMOutputSpec, Fragment, Mark, Node} from "prosemirror-model";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {
    HtmlContainerGenerator,
    HtmlElementGenerator,
    HtmlFragmentGenerator,
    HtmlGenerator,
    HtmlTextGenerator,
} from "~/shared/helpers/html/html_generator.js";
import {clamp} from "~/shared/helpers/number/clamp.open_source.js";

export type RecursiveReadonlyArray<Value> = ReadonlyArray<Value | RecursiveReadonlyArray<Value>>;

/**
 * Options for customizing ProseMirror HTML serialization. Similar set of options
 * to the [ProseMirror editor options][1] so your content rendered to HTML can
 * match content in a ProseMirror editor.
 *
 * [1]: https://prosemirror.net/docs/ref/#view.EditorProps
 */
export type ProsemirrorHtmlSerializationOptions = {
    readonly withPosAttribute?: boolean;
    readonly posAttributeOffset?: number;
    readonly nodeRenderers?: {
        [nodeName: string]:
            | ((
                  node: Node,
                  pos: number,
              ) => {
                  html: HtmlElementGenerator;
                  contentHtml?: HtmlElementGenerator;
              })
            | undefined;
    };
    readonly markRenderers?: {
        [markName: string]: (
            mark: Mark,
            inline: boolean,
        ) => {
            html: HtmlElementGenerator;
            contentHtml?: HtmlElementGenerator;
        };
    };
    readonly decorations?: RecursiveReadonlyArray<ProsemirrorHtmlSerializationDecoration>;
};

type ProsemirrorHtmlSerializationContext = {
    readonly withPosAttribute: boolean;
    readonly posAttributeOffset: number;
    readonly nodeRenderers: {
        [nodeName: string]:
            | ((
                  node: Node,
                  pos: number,
              ) => {
                  html: HtmlElementGenerator;
                  contentHtml?: HtmlElementGenerator;
              })
            | undefined;
    };
    readonly markRenderers: {
        [markName: string]: (
            mark: Mark,
            inline: boolean,
        ) => {
            html: HtmlElementGenerator;
            contentHtml?: HtmlElementGenerator;
        };
    };
    readonly widgetDecorationQueue: Array<ProsemirrorHtmlSerializationWidgetDecoration>;
    readonly inlineDecorationQueue: Array<ProsemirrorHtmlSerializationInlineDecoration>;
    readonly nodeDecorations: ReadonlyArray<ProsemirrorHtmlSerializationNodeDecoration>;
};

export type ProsemirrorHtmlSerializationDecoration =
    | ProsemirrorHtmlSerializationWidgetDecoration
    | ProsemirrorHtmlSerializationInlineDecoration
    | ProsemirrorHtmlSerializationNodeDecoration;

/**
 * Creates a widget decoration, which is a DOM node that's shown in the document at
 * the given position.
 *
 * Similar to the [`prosemirror-view` widget decoration][1].
 *
 * [1]: https://prosemirror.net/docs/ref/#view.Decoration^widget
 */
export type ProsemirrorHtmlSerializationWidgetDecoration = {
    readonly type: "Widget";
    readonly pos: number;
    readonly html: HtmlElementGenerator;
};

/**
 * Creates an inline decoration, which adds the given attributes to each inline
 * node between from and to.
 *
 * Similar to the [`prosemirror-view` inline decoration][1].
 *
 * Only supports creating new nodes around the inline nodes for now. So you'll note
 * that the `nodeName` attr is not optional.
 *
 * We also haven't made sure inline decorations support all the same edge cases
 * `prosemirror-view` inline decorations do. Known limitations:
 *
 * - Inline nodes should be styled with an inline decoration. We only style text
 *   currently
 * - Widget decorations within an inline decoration should be styled
 *
 * [1]: https://prosemirror.net/docs/ref/#view.Decoration^inline
 */
export type ProsemirrorHtmlSerializationInlineDecoration = {
    readonly type: "Inline";
    readonly from: number;
    readonly to: number;
    readonly attrs: {
        readonly nodeName: string;
        readonly [key: string]: string;
    };
};

/**
 * Adds attributes to one non-text node when its outer document range exactly
 * matches `from` and `to`.
 *
 * Unlike inline decorations, node decorations augment the element produced by the
 * node serializer without wrapping its content.
 */
export type ProsemirrorHtmlSerializationNodeDecoration = {
    readonly type: "Node";
    readonly from: number;
    readonly to: number;
    readonly attrs: {
        readonly [key: string]: string;
    };
};

/**
 * Serializes a ProseMirror node to an HTML string.
 *
 * ProseMirror only ships with a way to serialize nodes to DOM nodes. When
 * server-side rendering we don't have access to the DOM and so need to be able to
 * serialize ProseMirror content to an HTML string.
 */
export function serializeProsemirrorNodeToHtml(
    node: Node,
    options: ProsemirrorHtmlSerializationOptions = {},
): string {
    const widgetDecorationQueue: Array<ProsemirrorHtmlSerializationWidgetDecoration> = [];
    const inlineDecorationQueue: Array<ProsemirrorHtmlSerializationInlineDecoration> = [];
    const nodeDecorations: Array<ProsemirrorHtmlSerializationNodeDecoration> = [];

    const loop = (decorations: RecursiveReadonlyArray<ProsemirrorHtmlSerializationDecoration>) => {
        for (const decoration of decorations) {
            if (isReadonlyArray(decoration)) {
                loop(decoration);
                continue;
            }

            switch (decoration.type) {
                case "Widget": {
                    // Make it clear this HTML is a widget so `getContentViewPosFromDom()` can skip
                    // over the widget. This does mutate the decoration HTML but that should be fine
                    // since the calling function is unlikely to use the HTML for some other purpose.
                    decoration.html.setAttribute("data-widget", "");

                    widgetDecorationQueue.push(decoration);
                    break;
                }
                case "Inline": {
                    assert(decoration.from < decoration.to);
                    inlineDecorationQueue.push(decoration);
                    break;
                }
                case "Node": {
                    assert(decoration.from < decoration.to);
                    // Apply node decorations when their exact node is serialized.
                    nodeDecorations.push(decoration);
                    break;
                }
                default:
                    throw exhaustive(decoration);
            }
        }
    };

    if (options.decorations !== undefined) loop(options.decorations);

    widgetDecorationQueue.sort((a, b) => b.pos - a.pos);
    inlineDecorationQueue.reverse().sort((a, b) => b.from - a.from);

    const context: ProsemirrorHtmlSerializationContext = {
        withPosAttribute: options.withPosAttribute ?? false,
        posAttributeOffset: options.posAttributeOffset ?? 0,
        nodeRenderers: options.nodeRenderers ?? {},
        markRenderers: options.markRenderers ?? {},
        widgetDecorationQueue,
        inlineDecorationQueue,
        nodeDecorations,
    };

    return serializeProsemirrorRootNode(0, node, context).generateHtml();
}

/**
 * Serializes a ProseMirror fragment to an HTML string.
 *
 * ProseMirror only ships with a way to serialize nodes to DOM nodes. When
 * server-side rendering we don't have access to the DOM and so need to be able to
 * serialize ProseMirror content to an HTML string.
 */
export function serializeProsemirrorFragmentToHtml(
    fragment: Fragment,
    options: ProsemirrorHtmlSerializationOptions & {startPos?: number} = {},
): string {
    return serializeProsemirrorFragmentToHtmlGenerator(fragment, options).generateHtml();
}

export function serializeProsemirrorFragmentToHtmlGenerator(
    fragment: Fragment,
    options: ProsemirrorHtmlSerializationOptions & {startPos?: number} = {},
): HtmlFragmentGenerator {
    const widgetDecorationQueue: Array<ProsemirrorHtmlSerializationWidgetDecoration> = [];
    const inlineDecorationQueue: Array<ProsemirrorHtmlSerializationInlineDecoration> = [];
    const nodeDecorations: Array<ProsemirrorHtmlSerializationNodeDecoration> = [];

    const loop = (decorations: RecursiveReadonlyArray<ProsemirrorHtmlSerializationDecoration>) => {
        for (const decoration of decorations) {
            if (isReadonlyArray(decoration)) {
                loop(decoration);
                continue;
            }

            switch (decoration.type) {
                case "Widget": {
                    // Make it clear this HTML is a widget so `getContentViewPosFromDom()` can skip
                    // over the widget. This does mutate the decoration HTML but that should be fine
                    // since the calling function is unlikely to use the HTML for some other purpose.
                    decoration.html.setAttribute("data-widget", "");

                    widgetDecorationQueue.push(decoration);
                    break;
                }
                case "Inline": {
                    assert(decoration.from < decoration.to);
                    inlineDecorationQueue.push(decoration);
                    break;
                }
                case "Node": {
                    assert(decoration.from < decoration.to);
                    // Apply node decorations when their exact node is serialized.
                    nodeDecorations.push(decoration);
                    break;
                }
                default:
                    throw exhaustive(decoration);
            }
        }
    };

    if (options.decorations !== undefined) loop(options.decorations);

    widgetDecorationQueue.sort((a, b) => b.pos - a.pos);
    inlineDecorationQueue.reverse().sort((a, b) => b.from - a.from);

    const context: ProsemirrorHtmlSerializationContext = {
        withPosAttribute: options.withPosAttribute ?? false,
        posAttributeOffset: options.posAttributeOffset ?? 0,
        nodeRenderers: options.nodeRenderers ?? {},
        markRenderers: options.markRenderers ?? {},
        widgetDecorationQueue,
        inlineDecorationQueue,
        nodeDecorations,
    };

    const fragmentHtml = new HtmlFragmentGenerator();

    serializeProsemirrorFragment(options.startPos ?? 0, fragment, fragmentHtml, context);

    return fragmentHtml;
}

type DOMOutputSpecArray = _DOMOutputSpecArray<DOMOutputSpec>;
type _DOMOutputSpecArray<Spec extends DOMOutputSpec> =
    Spec extends ReadonlyArray<any> ? Spec : never;

function isDomNode(structure: object): structure is globalThis.Node {
    return (structure as any).contentType != null;
}

/**
 * Same as `serializeProsemirrorNode()` but adds decorations before/after the node.
 * For nested nodes `serializeProsemirrorFragment()` handles this but the root node
 * is not wrapped in a fragment.
 */
function serializeProsemirrorRootNode(
    pos: number, // Position at the start of the node
    node: Node,
    context: ProsemirrorHtmlSerializationContext,
): HtmlGenerator {
    let prependDecorationHtml: HtmlGenerator | undefined;
    let appendDecorationHtml: HtmlGenerator | undefined;

    if (context.widgetDecorationQueue[context.widgetDecorationQueue.length - 1]?.pos === pos) {
        const decoration = context.widgetDecorationQueue.pop()!;
        prependDecorationHtml = decoration.html;
    }

    let html = serializeProsemirrorNode(pos, node, context);

    if (
        context.widgetDecorationQueue[context.widgetDecorationQueue.length - 1]?.pos ===
        pos + node.nodeSize
    ) {
        const decoration = context.widgetDecorationQueue.pop()!;
        appendDecorationHtml = decoration.html;
    }

    if (prependDecorationHtml || appendDecorationHtml) {
        const htmlWithDecoration = new HtmlFragmentGenerator();
        if (prependDecorationHtml) htmlWithDecoration.appendChild(prependDecorationHtml);
        htmlWithDecoration.appendChild(html);
        if (appendDecorationHtml) htmlWithDecoration.appendChild(appendDecorationHtml);
        html = htmlWithDecoration;
    }

    return html;
}

/**
 * Serializes a ProseMirror node to HTML. Has the same implementation as
 * [`DOMSerializer.serializeNode()`][1] but for an HTML string instead of DOM
 * nodes.
 *
 * [1]:
 *     https://github.com/ProseMirror/prosemirror-model/blob/a0556b82869a7ecda732f7c4e26d42caed1a4e40/src/to_dom.js#L84-L96
 */
function serializeProsemirrorNode(
    pos: number, // Position at the start of the node
    node: Node,
    context: ProsemirrorHtmlSerializationContext,
): HtmlGenerator {
    let html: HtmlGenerator;
    let contentHtml: HtmlElementGenerator | undefined;

    if (!node.isText) {
        const nodeRenderer = context.nodeRenderers[node.type.name];
        if (nodeRenderer) {
            ({html, contentHtml} = nodeRenderer(node, pos - 1));
        } else {
            const toDOM = node.type.spec.toDOM;
            assert(toDOM, `Could not find renderer for node type \`${node.type.name}\``);
            ({html, contentHtml} = renderProsemirrorDomOutputSpec(toDOM(node)));
        }

        assert(html instanceof HtmlElementGenerator);

        for (const decoration of context.nodeDecorations) {
            // `pos` starts inside the node, while node decoration bounds surround it.
            if (decoration.from !== pos - 1 || decoration.to !== pos - 1 + node.nodeSize) continue;

            for (const [attributeName, attributeValue] of Object.entries(decoration.attrs)) {
                if (attributeName === "class") {
                    const existingClassName = html.getAttribute("class");
                    // Preserve classes supplied by the node's renderer.
                    html.setAttribute(
                        "class",
                        existingClassName
                            ? `${existingClassName} ${attributeValue}`
                            : attributeValue,
                    );
                } else {
                    html.setAttribute(attributeName, attributeValue);
                }
            }
        }

        if (context.withPosAttribute && pos > 0) {
            // Mark the position of every node in the document. We use this so we can map the
            // DOM selection back to our ProseMirror document. Only nodes get the `data-pos`
            // attribute. So if we see `data-pos` we can be confident we have a node element
            // not a mark element.
            html.setAttribute("data-pos", pos - 1 + context.posAttributeOffset);
            if (node.isInline) html.setAttribute("data-inline", "");
        }

        if (contentHtml !== undefined) {
            assert(!node.isLeaf, "Content hole not allowed in a leaf node spec");
            serializeProsemirrorFragment(pos + 1, node.content, contentHtml, context);
        }
    } else {
        const text = node.text!;

        const textSegments: Array<
            | {
                  type: "Text";
                  text: string;
                  inlineDecoration: ProsemirrorHtmlSerializationInlineDecoration | null;
              }
            | {
                  type: "WidgetDecoration";
                  widgetDecoration: ProsemirrorHtmlSerializationWidgetDecoration;
              }
        > = [];

        // Initialize our `textSegments` array with widget decorations in the right
        // positions.
        {
            let textIndex = 0;

            while (true) {
                const lastWidgetDecoration =
                    context.widgetDecorationQueue[context.widgetDecorationQueue.length - 1];
                if (!lastWidgetDecoration) break;

                const isWidgetInText =
                    pos < lastWidgetDecoration.pos && lastWidgetDecoration.pos < pos + text.length;

                if (!isWidgetInText) break;

                context.widgetDecorationQueue.pop();

                const nextTextIndex = lastWidgetDecoration.pos - pos;
                const textSlice = text.slice(textIndex, nextTextIndex);
                if (textSlice.length > 0)
                    textSegments.push({type: "Text", text: textSlice, inlineDecoration: null});

                textSegments.push({
                    type: "WidgetDecoration",
                    widgetDecoration: lastWidgetDecoration,
                });

                textIndex = nextTextIndex;
            }

            const lastTextSlice = text.slice(textIndex);
            if (lastTextSlice.length > 0)
                textSegments.push({type: "Text", text: lastTextSlice, inlineDecoration: null});
        }

        // Transform our `textSegments` array by applying any inline decorations.
        {
            let inlineDecorationQueueIndex = context.inlineDecorationQueue.length - 1;

            while (inlineDecorationQueueIndex >= 0) {
                const inlineDecoration = context.inlineDecorationQueue[inlineDecorationQueueIndex]!;

                // The inline decoration is before our text and so will be before all nodes after.
                // Remove it from the queue and try again.
                if (inlineDecoration.to + 1 <= pos) {
                    context.inlineDecorationQueue.splice(inlineDecorationQueueIndex, 1);
                    inlineDecorationQueueIndex--;
                    continue;
                }

                // All inline decorations in the queue before this one are outside the text
                // (including this one). Stop iterating.
                if (inlineDecoration.from + 1 >= pos + text.length) break;

                let textIndex = 0;
                for (
                    let textSegmentIndex = 0;
                    textSegmentIndex < textSegments.length;
                    textSegmentIndex++
                ) {
                    const textSegment = textSegments[textSegmentIndex]!;

                    // NOTE(calebmer): Inline decorations are applied to widgets in `prosemirror-view`
                    // but we are not implementing this yet until we have a use case and can more
                    // thoroughly test edge cases.
                    if (textSegment.type === "WidgetDecoration") continue;

                    if (textSegment.text.length === 0) continue;

                    const inlineDecorationStartTextIndex = clamp(
                        0,
                        inlineDecoration.from + 1 - (pos + textIndex),
                        textSegment.text.length,
                    );
                    const inlineDecorationEndTextIndex = clamp(
                        0,
                        inlineDecoration.to + 1 - (pos + textIndex),
                        textSegment.text.length,
                    );

                    const beforeInlineDecorationTextSlice = textSegment.text.slice(
                        0,
                        inlineDecorationStartTextIndex,
                    );
                    const withinInlineDecorationTextSlice = textSegment.text.slice(
                        inlineDecorationStartTextIndex,
                        inlineDecorationEndTextIndex,
                    );
                    const afterInlineDecorationTextSlice = textSegment.text.slice(
                        inlineDecorationEndTextIndex,
                    );

                    // If we don't apply an inline decoration to any text in this segment then skip.
                    if (withinInlineDecorationTextSlice.length === 0) {
                        textIndex += textSegment.text.length;
                        continue;
                    }

                    const newTextSegments: Array<{
                        type: "Text";
                        text: string;
                        inlineDecoration: ProsemirrorHtmlSerializationInlineDecoration | null;
                    }> = [];

                    let hasMergedWithLastDecoration = false;

                    if (beforeInlineDecorationTextSlice.length > 0) {
                        newTextSegments.push({
                            type: "Text",
                            text: beforeInlineDecorationTextSlice,
                            inlineDecoration: textSegment.inlineDecoration,
                        });
                    } else if (textSegmentIndex >= 1) {
                        const previousTextSegment = textSegments[textSegmentIndex - 1]!;
                        if (
                            previousTextSegment.type === "Text" &&
                            previousTextSegment.inlineDecoration === inlineDecoration
                        ) {
                            hasMergedWithLastDecoration = true;
                            previousTextSegment.text += withinInlineDecorationTextSlice;
                        }
                    }

                    if (!hasMergedWithLastDecoration) {
                        newTextSegments.push({
                            type: "Text",
                            text: withinInlineDecorationTextSlice,
                            inlineDecoration,
                        });
                    }

                    if (afterInlineDecorationTextSlice.length > 0) {
                        newTextSegments.push({
                            type: "Text",
                            text: afterInlineDecorationTextSlice,
                            inlineDecoration: textSegment.inlineDecoration,
                        });
                    }

                    textSegments.splice(textSegmentIndex, 1, ...newTextSegments);

                    textIndex += textSegment.text.length;
                    textSegmentIndex += newTextSegments.length - 1;
                }

                // Go to the next inline decoration object in the next iteration...
                inlineDecorationQueueIndex--;
            }
        }

        // Turn our text segments into HTML.
        if (
            textSegments.length === 1 &&
            textSegments[0]!.type === "Text" &&
            !textSegments[0]!.inlineDecoration
        ) {
            html = new HtmlTextGenerator(text);
        } else {
            const fragmentHtml = new HtmlFragmentGenerator();
            html = fragmentHtml;

            for (const textSegment of textSegments) {
                switch (textSegment.type) {
                    case "Text": {
                        if (!textSegment.inlineDecoration) {
                            fragmentHtml.appendChild(new HtmlTextGenerator(textSegment.text));
                        } else {
                            const inlineDecorationHtml = new HtmlElementGenerator(
                                textSegment.inlineDecoration.attrs.nodeName,
                            );
                            for (const [key, value] of Object.entries(
                                textSegment.inlineDecoration.attrs,
                            )) {
                                if (key === "nodeName") continue;
                                inlineDecorationHtml.setAttribute(key, value);
                            }
                            inlineDecorationHtml.appendChild(
                                new HtmlTextGenerator(textSegment.text),
                            );
                            fragmentHtml.appendChild(inlineDecorationHtml);
                        }
                        break;
                    }
                    case "WidgetDecoration": {
                        fragmentHtml.appendChild(textSegment.widgetDecoration.html);
                        break;
                    }
                    default:
                        throw exhaustive(textSegment);
                }
            }
        }
    }

    return html;
}

/**
 * Serializes a ProseMirror mark to HTML. Has the same implementation as
 * [`DOMSerializer.serializeMark()`][1] but for an HTML string instead of DOM
 * nodes.
 *
 * [1]:
 *     https://github.com/ProseMirror/prosemirror-model/blob/a0556b82869a7ecda732f7c4e26d42caed1a4e40/src/to_dom.js#L110-L113
 */
function serializeProsemirrorMark(
    mark: Mark,
    inline: boolean,
    context: ProsemirrorHtmlSerializationContext,
): {html: HtmlElementGenerator; contentHtml?: HtmlElementGenerator} | null {
    let html: HtmlGenerator;
    let contentHtml: HtmlElementGenerator | undefined;

    const markRenderer = context.markRenderers[mark.type.name];
    if (markRenderer) {
        ({html, contentHtml} = markRenderer(mark, inline));
    } else {
        const toDOM = mark.type.spec.toDOM;
        if (!toDOM) return null;
        ({html, contentHtml} = renderProsemirrorDomOutputSpec(toDOM(mark, inline)));
    }

    assert(html instanceof HtmlElementGenerator, "Marks are expected to return DOM elements");
    return {html, contentHtml};
}

/**
 * Serializes a ProseMirror fragment to HTML. Has the same implementation as
 * [`DOMSerializer.serializeFragment()`][1] but for an HTML string instead of DOM
 * nodes.
 *
 * [1]:
 *     https://github.com/ProseMirror/prosemirror-model/blob/a0556b82869a7ecda732f7c4e26d42caed1a4e40/src/to_dom.js#L44-L76
 */
function serializeProsemirrorFragment(
    pos: number, // Position of the first node in the fragment
    fragment: Fragment,
    targetContainer: HtmlContainerGenerator,
    context: ProsemirrorHtmlSerializationContext,
) {
    let currentTargetContainer: HtmlContainerGenerator = targetContainer;
    let activeMarkContainers: Array<[Mark, HtmlContainerGenerator]> | null = null;

    if (context.widgetDecorationQueue[context.widgetDecorationQueue.length - 1]?.pos === pos) {
        const decoration = context.widgetDecorationQueue.pop()!;
        targetContainer.appendChild(decoration.html);
    }

    fragment.forEach((node, offset) => {
        if (!activeMarkContainers && node.marks.length === 0) {
            if (
                context.widgetDecorationQueue[context.widgetDecorationQueue.length - 1]?.pos ===
                pos + offset
            ) {
                const decoration = context.widgetDecorationQueue.pop()!;
                currentTargetContainer.appendChild(decoration.html);
            }
        } else {
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
                ) {
                    break;
                }

                keepActiveMarks++;
                renderedMarks++;
            }

            while (keepActiveMarks < activeMarkContainers.length) {
                currentTargetContainer = activeMarkContainers.pop()![1];
            }

            // Insert decoration between nodes at the point with the fewest marks.
            if (
                context.widgetDecorationQueue[context.widgetDecorationQueue.length - 1]?.pos ===
                pos + offset
            ) {
                const decoration = context.widgetDecorationQueue.pop()!;
                currentTargetContainer.appendChild(decoration.html);
            }

            while (renderedMarks < node.marks.length) {
                const newMark = node.marks[renderedMarks++]!;
                const markHtml = serializeProsemirrorMark(newMark, node.isInline, context);
                if (markHtml) {
                    activeMarkContainers.push([newMark, currentTargetContainer]);
                    currentTargetContainer.appendChild(markHtml.html);
                    const nextTargetElement = markHtml.contentHtml ?? markHtml.html;
                    currentTargetContainer = nextTargetElement;
                }
            }
        }

        currentTargetContainer.appendChild(serializeProsemirrorNode(pos + offset, node, context));
    });

    if (
        context.widgetDecorationQueue[context.widgetDecorationQueue.length - 1]?.pos ===
        pos + fragment.size
    ) {
        const decoration = context.widgetDecorationQueue.pop()!;
        targetContainer.appendChild(decoration.html);
    }
}

/**
 * Renders a `DOMOutputSpec` to HTML. Has the same implementation as
 * [`DOMSerializer.renderSpec()`][1] but for an HTML string instead of DOM nodes.
 *
 * [1]:
 *     https://github.com/ProseMirror/prosemirror-model/blob/a0556b82869a7ecda732f7c4e26d42caed1a4e40/src/to_dom.js#L115-L157
 */
export function renderProsemirrorDomOutputSpec(structure: DOMOutputSpec): {
    html: HtmlGenerator;
    contentHtml?: HtmlElementGenerator;
} {
    if (typeof structure === "string") return {html: new HtmlTextGenerator(structure)};

    assert(isReadonlyArray(structure), "Can not server-side render node that returns a DOM node");

    return renderProsemirrorDomOutputSpecArray(structure);
}

function renderProsemirrorDomOutputSpecArray(structure: DOMOutputSpecArray): {
    html: HtmlGenerator;
    contentHtml?: HtmlElementGenerator;
} {
    const tagName = structure[0];
    const attributes = structure[1];

    const html = new HtmlElementGenerator(tagName);
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
