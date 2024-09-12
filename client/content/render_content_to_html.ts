import classNames from "classnames";
import {DOMOutputSpec, Node} from "prosemirror-model";
import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {createContentMentionTextStore} from "~/client/accounts/create_content_mention_text_store.js";
import {checkIconSvg} from "~/client/icons/check_icon_svg.js";
import {clipboardTextIconSvg} from "~/client/icons/clipboard_text_icon_svg.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import {computeContentOrderedListItemNumbers} from "~/shared/content/compute_content_ordered_list_item_numbers.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {
    ProsemirrorHtmlSerializationDecoration,
    RecursiveReadonlyArray,
    renderProsemirrorDomOutputSpec,
    serializeProsemirrorFragmentToHtml,
} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";

/**
 * Renders content from `content_schema.tsx` into HTML. Contains all the same
 * custom node renderers as `<ContentEditor>` so you get the same HTML as you
 * saw in the editor.
 */
export function renderContentToHtmlStore(
    content: ContentWithReferences,
    options: {
        accountStore: AccountClientStore;
        currentAccount: AccountModel | null;
        placeholder?: string;
    },
): Store<string> {
    return renderContentFragmentToHtmlStore(content, options).map(fragmentHtml => {
        return `<div class="${contentStyles.docClassName}">${fragmentHtml}</div>`;
    });
}

/**
 * Renders content from `content_schema.tsx` into HTML. Contains all the same
 * custom node renderers as `<ContentEditor>` so you get the same HTML as you
 * saw in the editor.
 *
 * Does not render the wrapping `<div>` for the entire doc. Only the inner
 * content. Generally you want `renderContentToHtmlStore()`. This is useful if
 * you want to add other attributes to the wrapping `<div>`.
 *
 * If `isInert` is set to true then elements which were interactive, like
 * links, are made non clickable or focusable. But visually the stay the same.
 */
export function renderContentFragmentToHtmlStore(
    content: ContentWithReferences,
    {
        accountStore,
        currentAccount,
        placeholder,
        isInert,
        decorations,
        shouldHighlightComment,
    }: {
        accountStore: AccountClientStore;
        currentAccount: AccountModel | null;
        placeholder?: string;
        isInert?: boolean;
        decorations?: RecursiveReadonlyArray<ProsemirrorHtmlSerializationDecoration>;
        shouldHighlightComment?: (commentThreadId: DocumentCommentThreadId) => boolean;
    },
): Store<string> {
    return computeStore(get => {
        assert(content.doc.type.schema.topNodeType === content.doc.type);

        const isTitleEmpty = isContentTitleEmpty(content.doc);
        const isBodyEmpty = isContentBodyEmpty(content.doc);

        const orderedListItemNumberByNode = new Map<Node, number>();

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
                    assert(html instanceof HtmlElementGenerator);

                    let listItemNumber = orderedListItemNumberByNode.get(node);

                    // If we do not have the number for this list item, then compute the number for
                    // all list items in this node's parent and try checking for the number again.
                    // The number must be present.
                    if (listItemNumber === undefined) {
                        const $pos = content.doc.resolve(pos + 1);
                        assert($pos.parent === node && $pos.parentOffset === 0);

                        const parentNode = $pos.node($pos.depth - 1);
                        computeContentOrderedListItemNumbers(
                            parentNode,
                            orderedListItemNumberByNode,
                        );

                        listItemNumber = orderedListItemNumberByNode.get(node);
                        assert(listItemNumber !== undefined);
                    }

                    html.setAttribute("data-list-number", listItemNumber);

                    return {html, contentHtml};
                },
                checkListItem: node => {
                    const {html} = renderProsemirrorDomOutputSpec(node.type.spec.toDOM!(node));
                    assert(html instanceof HtmlElementGenerator);

                    const checkboxContainerHtml = new HtmlElementGenerator("div");
                    html.appendChild(checkboxContainerHtml);
                    checkboxContainerHtml.setAttribute(
                        "class",
                        contentStyles.checkListItemCheckboxContainerClassName,
                    );

                    const checkboxHtml = new HtmlElementGenerator("div");
                    checkboxContainerHtml.appendChild(checkboxHtml);
                    checkboxHtml.setAttribute(
                        "class",
                        contentStyles.checkListItemCheckboxClassName,
                    );
                    checkboxHtml.appendChild({
                        generateHtml: () =>
                            checkIconSvg({
                                className: contentStyles.checkListItemCheckboxIconClassName,
                            }),
                        generateNode: () => {
                            throw new UnimplementedError(
                                "DOM node generation unimplemented for icon SVG",
                            );
                        },
                    });

                    const contentHtml = new HtmlElementGenerator("div");
                    html.appendChild(contentHtml);
                    contentHtml.setAttribute("class", contentStyles.checkListItemContentClassName);

                    return {html, contentHtml};
                },
                codeBlock: (node, pos) => {
                    // IMPORTANT: Any change you make to this function also likely must be made to
                    // the `codeBlock` node view in `content_editor_code_block_node_view.ts`.

                    const languageId: ContentCodeBlockLanguageId = node.attrs.language ?? "text";
                    const language = contentCodeBlockLanguageById[languageId];

                    const {html, contentHtml} = renderProsemirrorDomOutputSpec(
                        node.type.spec.toDOM!(node),
                    );

                    assert(html instanceof HtmlElementGenerator && html.tagName === "pre");
                    assert(
                        contentHtml instanceof HtmlElementGenerator &&
                            contentHtml.tagName === "code",
                    );
                    assert(html.childElementCount === 1);
                    assert(html.firstElementChild === contentHtml);

                    const toolbarHtml = new HtmlElementGenerator("div");
                    html.insertBefore(toolbarHtml, contentHtml);
                    toolbarHtml.setAttribute("class", contentStyles.codeBlockToolbarClassName);

                    const toolbarFlexHtml = new HtmlElementGenerator("div");
                    toolbarHtml.appendChild(toolbarFlexHtml);
                    toolbarFlexHtml.setAttribute(
                        "class",
                        contentStyles.codeBlockToolbarFlexClassName,
                    );

                    const toolbarOverflowGradientHtml = new HtmlElementGenerator("div");
                    toolbarFlexHtml.appendChild(toolbarOverflowGradientHtml);
                    toolbarOverflowGradientHtml.setAttribute(
                        "class",
                        contentStyles.codeBlockToolbarOverflowGradientClassName,
                    );

                    {
                        const languagePickerHtml = new HtmlElementGenerator("div");
                        toolbarFlexHtml.appendChild(languagePickerHtml);
                        languagePickerHtml.setAttribute(
                            "class",
                            contentStyles.codeBlockLanguagePickerClassName,
                        );

                        const languagePickerTextHtml = new HtmlElementGenerator("div");
                        languagePickerHtml.appendChild(languagePickerTextHtml);
                        languagePickerTextHtml.setAttribute(
                            "class",
                            contentStyles.codeBlockLanguagePickerTextClassName,
                        );

                        languagePickerTextHtml.appendChild(new HtmlTextGenerator(language.name));
                    }

                    {
                        const copyButtonHtml = new HtmlElementGenerator("div");
                        toolbarFlexHtml.appendChild(copyButtonHtml);
                        copyButtonHtml.setAttribute(
                            "class",
                            classNames(
                                contentStyles.codeBlockCopyButtonClassName,
                                // This class will be removed when the copy button is pressed and replaced
                                // with a `grey-100` class. We need to add the class here for server rendering.
                                sprinkles({color: "grey-60"}),
                            ),
                        );
                        copyButtonHtml.appendChild({
                            generateHtml: () =>
                                clipboardTextIconSvg({
                                    className: contentStyles.codeBlockCopyButtonIconClassName,
                                }),
                            generateNode: () => {
                                throw new UnimplementedError(
                                    "DOM node generation unimplemented for icon SVG",
                                );
                            },
                        });

                        // Include the position the code block is rendered at so our press
                        // implementation is able to find the code block node from the HTML.
                        copyButtonHtml.setAttribute("data-pos", pos);
                    }

                    return {html, contentHtml};
                },
                mention: node => {
                    const mention: ContentMention = node.attrs.mention;
                    const isCurrentAccountMention = currentAccount?.id === mention.accountId;

                    // We need a container element for highlight styles to be applied to. Our
                    // mention element may have a background color when mentioning the
                    // current account.
                    const containerElement = new HtmlElementGenerator("span");
                    containerElement.setAttribute("data-mention-account", mention.accountId);
                    if (mention.isShort)
                        containerElement.setAttribute("data-mention-short", "true");

                    const element = new HtmlElementGenerator("span");
                    containerElement.appendChild(element);
                    element.setAttribute(
                        "class",
                        classNames(
                            contentStyles.mentionClassName,
                            isCurrentAccountMention && contentStyles.currentAccountMentionClassName,
                        ),
                    );

                    const atElement = new HtmlElementGenerator("span");
                    element.appendChild(atElement);
                    atElement.setAttribute("class", contentStyles.mentionAtClassName);
                    atElement.appendChild(new HtmlTextGenerator("@"));

                    const textElement = new HtmlElementGenerator("span");
                    element.appendChild(textElement);
                    textElement.setAttribute("class", contentStyles.mentionTextClassName);
                    textElement.appendChild(
                        new HtmlTextGenerator(
                            get(
                                createContentMentionTextStore(
                                    accountStore,
                                    content.references,
                                    mention,
                                ),
                            ),
                        ),
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
                              assert(html instanceof HtmlElementGenerator);

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
                              assert(html instanceof HtmlElementGenerator);

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
                    assert(html instanceof HtmlElementGenerator);
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
                    assert(html instanceof HtmlElementGenerator);
                    return {html, contentHtml};
                },
            },
        });
    });
}
