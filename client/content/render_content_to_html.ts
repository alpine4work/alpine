import classNames from "classnames";
import {DOMOutputSpec, Node} from "prosemirror-model";
import {getContentMentionText} from "~/client/accounts/get_content_mention_text";
import {AccountModel} from "~/shared/accounts/account_model";
import {contentCheckListItemIconSvg} from "~/shared/content/content_check_list_item_icon_svg";
import {ContentMention} from "~/shared/content/content_mention";
import {ContentWithReferences} from "~/shared/content/content_references";
import {clampListItemIndentation} from "~/shared/content/content_schema";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title";
import {assert} from "~/shared/helpers/control/assert";
import {omitObject} from "~/shared/helpers/object/omit_object";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {
    ElementHtmlGenerator,
    ProsemirrorHtmlSerializationDecoration,
    TextHtmlGenerator,
    renderProsemirrorDomOutputSpec,
    serializeProsemirrorFragmentToHtml,
} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {contentSchemaStyles} from "~/shared/styles/styles";

const {
    docClassName,
    checkListItemCheckboxContainerClassName,
    checkListItemCheckboxClassName,
    checkListItemContentClassName,
    mentionClassName,
    currentAccountMentionClassName,
    mentionAtClassName,
    mentionTextClassName,
} = contentSchemaStyles;

/**
 * Renders content from `content_schema.tsx` into HTML. Contains all the same
 * custom node renderers as `<ContentEditor>` so you get the same HTML as you
 * saw in the editor.
 */
export function renderContentToHtml(
    content: ContentWithReferences,
    options: {currentAccount: AccountModel | null; placeholder?: string},
): string {
    const fragmentHtml = renderContentFragmentToHtml(content, options);
    return `<div class="${docClassName}">${fragmentHtml}</div>`;
}

/**
 * Renders content from `content_schema.tsx` into HTML. Contains all the same
 * custom node renderers as `<ContentEditor>` so you get the same HTML as you
 * saw in the editor.
 *
 * Does not render the wrapping `<div>` for the entire doc. Only the inner
 * content. Generally you want `renderContentToHtml()`. This is useful if you
 * want to add other attributes to the wrapping `<div>`.
 *
 * If `isInert` is set to true then elements which were interactive, like
 * links, are made non clickable or focusable. But visually the stay the same.
 */
export function renderContentFragmentToHtml(
    content: ContentWithReferences,
    {
        currentAccount,
        placeholder,
        isInert,
        decorations,
        shouldHighlightComment,
    }: {
        currentAccount: AccountModel | null;
        placeholder?: string;
        isInert?: boolean;
        decorations?: ReadonlyArray<ProsemirrorHtmlSerializationDecoration>;
        shouldHighlightComment?: (commentThreadId: DocumentCommentThreadId) => boolean;
    },
): string {
    assert(content.doc.type.schema.topNodeType === content.doc.type);

    const isTitleEmpty = isContentTitleEmpty(content.doc);
    const isBodyEmpty = isContentBodyEmpty(content.doc);

    const orderedListItemNumberByNode = new Map<Node, number>();

    const computeChildrenOrderedListItemNumbers = (node: Node) => {
        let previousListItemNumberByIndent: Array<number> = [];

        node.content.forEach(childNode => {
            if (childNode.type.name !== "orderedListItem") {
                previousListItemNumberByIndent = [];
                return;
            }

            const indent = clampListItemIndentation(childNode.attrs.indent);

            // If this item's indentation level is higher than the previous item's
            // indentation level, add new counters for the new indentation levels.
            //
            // If this item's indentation level is lower than the previous item's
            // indentation level, clear deeper indentation level counters since those
            // counters are done.
            if (previousListItemNumberByIndent.length < indent + 1) {
                for (let i = previousListItemNumberByIndent.length; i < indent + 1; i++) {
                    previousListItemNumberByIndent.push(0);
                }
            } else if (previousListItemNumberByIndent.length > indent + 1) {
                previousListItemNumberByIndent = previousListItemNumberByIndent.slice(
                    0,
                    indent + 1,
                );
            }

            const previousListItemNumber = previousListItemNumberByIndent[indent]!;
            const listItemNumber = previousListItemNumber + 1;
            previousListItemNumberByIndent[indent] = listItemNumber;

            orderedListItemNumberByNode.set(childNode, listItemNumber);
        });
    };

    return serializeProsemirrorFragmentToHtml(content.doc.content, {
        startPos: 1,
        decorations,

        // IMPORTANT: If you have a custom renderer in `nodeRenderers` here you should
        // also have a matching custom view in `nodeViews` in `<ContentEditor>`.
        nodeRenderers: {
            orderedListItem: (node, pos) => {
                const {html, contentHtml} = renderProsemirrorDomOutputSpec(
                    node.type.spec.toDOM!(node),
                );
                assert(html instanceof ElementHtmlGenerator);

                let listItemNumber = orderedListItemNumberByNode.get(node);

                // If we do not have the number for this list item, then compute the number for
                // all list items in this node's parent and try checking for the number again.
                // The number must be present.
                if (listItemNumber === undefined) {
                    const $pos = content.doc.resolve(pos);
                    assert($pos.parent === node && $pos.parentOffset === 0);

                    const parentNode = $pos.node($pos.depth - 1);
                    computeChildrenOrderedListItemNumbers(parentNode);

                    listItemNumber = orderedListItemNumberByNode.get(node);
                    assert(listItemNumber !== undefined);
                }

                html.setAttribute("data-list-number", listItemNumber);

                return {html, contentHtml};
            },
            checkListItem: node => {
                const {html} = renderProsemirrorDomOutputSpec(node.type.spec.toDOM!(node));
                assert(html instanceof ElementHtmlGenerator);

                const checkboxContainerHtml = new ElementHtmlGenerator("div");
                html.appendChild(checkboxContainerHtml);
                checkboxContainerHtml.setAttribute(
                    "class",
                    checkListItemCheckboxContainerClassName,
                );

                const checkboxHtml = new ElementHtmlGenerator("div");
                checkboxContainerHtml.appendChild(checkboxHtml);
                checkboxHtml.setAttribute("class", checkListItemCheckboxClassName);
                checkboxHtml.appendChild({generateHtml: () => contentCheckListItemIconSvg});

                const contentHtml = new ElementHtmlGenerator("div");
                html.appendChild(contentHtml);
                contentHtml.setAttribute("class", checkListItemContentClassName);

                return {html, contentHtml};
            },
            mention: node => {
                const mention: ContentMention = node.attrs.mention;
                const isCurrentAccountMention = currentAccount?.id === mention.accountId;

                // We need a container element for highlight styles to be applied to. Our
                // mention element may have a background color when mentioning the
                // current account.
                const containerElement = new ElementHtmlGenerator("span");
                containerElement.setAttribute("data-mention-account", mention.accountId);
                if (mention.isShort) containerElement.setAttribute("data-mention-short", "true");

                const element = new ElementHtmlGenerator("span");
                containerElement.appendChild(element);
                element.setAttribute(
                    "class",
                    classNames(
                        mentionClassName,
                        isCurrentAccountMention && currentAccountMentionClassName,
                    ),
                );

                const atElement = new ElementHtmlGenerator("span");
                element.appendChild(atElement);
                atElement.setAttribute("class", mentionAtClassName);
                atElement.appendChild(new TextHtmlGenerator("@"));

                const textElement = new ElementHtmlGenerator("span");
                element.appendChild(textElement);
                textElement.setAttribute("class", mentionTextClassName);
                textElement.appendChild(
                    new TextHtmlGenerator(getContentMentionText(content.references, mention)),
                );

                return {html: containerElement};
            },

            // Add custom renderers which add the `data-placeholder` attribute when our
            // content is empty.
            title:
                placeholder && isTitleEmpty
                    ? node => {
                          const {html, contentHtml} = renderProsemirrorDomOutputSpec(
                              node.type.spec.toDOM!(node),
                          );
                          assert(html instanceof ElementHtmlGenerator);

                          html.setAttribute("data-placeholder", documentFallbackTitle);
                          // For accessibility, if the title is empty add the fallback title as an
                          // `aria-label`. axe complains when we have an empty `<h1>`.
                          html.setAttribute("aria-label", documentFallbackTitle);

                          return {html, contentHtml};
                      }
                    : undefined,
            paragraph:
                placeholder && isBodyEmpty
                    ? node => {
                          const {html, contentHtml} = renderProsemirrorDomOutputSpec(
                              node.type.spec.toDOM!(node),
                          );
                          assert(html instanceof ElementHtmlGenerator);

                          html.setAttribute("data-placeholder", placeholder);

                          return {html, contentHtml};
                      }
                    : undefined,
        },

        // IMPORTANT: If you have a custom renderer in `markRenderers` here you should
        // also have a matching custom view in `markViews` in `<ContentEditor>`.
        markRenderers: {
            // The link view in `<ContentEditor>` does not change the visual presentation
            // of links. Instead it does two things:
            //
            // 1. Opens the page in the current tab on click if it is a link within the
            //    current space. Otherwise opens in a new tab.
            // 2. Opens a link editor on hover.
            //
            // 1 is implemented by `<ContentView>` and 2 we don't need since you don't need
            // to edit a link when reading.
            link: (mark, inline) => {
                const markSpec = mark.type.spec.toDOM!(mark, inline);
                assert(Array.isArray(markSpec) && markSpec[0] === "a");

                const actualMarkSpec: DOMOutputSpec = isInert
                    ? ["span", omitObject(markSpec[1], ["href", "target", "rel"]), 0]
                    : markSpec;

                const {html, contentHtml} = renderProsemirrorDomOutputSpec(actualMarkSpec);
                assert(html instanceof ElementHtmlGenerator);
                return {html, contentHtml};
            },

            // Only highlight comments in a read-only comment view if
            // `shouldHighlightComment` returns true.
            comment: (mark, inline) => {
                const markSpec = mark.type.spec.toDOM!(mark, inline);

                const actualMarkSpec: DOMOutputSpec = !shouldHighlightComment?.(
                    mark.attrs.commentThreadId,
                )
                    ? ["span", {}, 0]
                    : markSpec;

                const {html, contentHtml} = renderProsemirrorDomOutputSpec(actualMarkSpec);
                assert(html instanceof ElementHtmlGenerator);
                return {html, contentHtml};
            },
        },
    });
}
