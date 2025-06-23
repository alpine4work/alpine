import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {DOMOutputSpec, Node} from "prosemirror-model";
import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {createContentMentionTextStore} from "~/client/accounts/create_content_mention_text_store.js";
import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {FileClientStore} from "~/client/content/file_client_store.js";
import {renderContentFileEntityPreview} from "~/client/content/internal/content_file_entity_preview.js";
import {renderContentFilePreview} from "~/client/content/internal/content_file_preview.js";
import {
    layoutContentFile,
    layoutContentFileParent,
} from "~/client/content/state/content_file_layout.js";
import {getContentBlockWidth} from "~/client/content/state/get_content_block_width.js";
import {resolveContentTableColumnWidthPx} from "~/client/content/state/table/helpers/resolve_content_table_column_width_px.js";
import {AppContext} from "~/client/context/app_context.js";
import {checkIconSvg} from "~/client/icons/check_icon_svg.js";
import {clipboardTextIconSvg} from "~/client/icons/clipboard_text_icon_svg.js";
import {createSvgHtmlGenerator} from "~/client/icons/create_svg_html_generator.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import {computeContentOrderedListItemNumbers} from "~/shared/content/compute_content_ordered_list_item_numbers.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {
    tableWrapper2ClassName,
    tableWrapper3ClassName,
    tableWrapperClassName,
} from "~/shared/content/content_styles.js";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    HtmlElementGenerator,
    HtmlFragmentGenerator,
    HtmlTextGenerator,
} from "~/shared/helpers/html/html_generator.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {isId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    ProsemirrorHtmlSerializationDecoration,
    RecursiveReadonlyArray,
    renderProsemirrorDomOutputSpec,
    serializeProsemirrorFragmentToHtmlGenerator,
} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
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
    {
        getContext,
        clientInfo,
        spaceId,
        accountStore,
        fileStore,
        currentAccount,
        spacingScale,
        platform,
        routeLayout,
        isInitialAppRender,
        currentDate,
        fileEntityRenderers,
        withPosAttribute,
        placeholder,
    }: {
        getContext: () => AppContext;
        clientInfo: ClientInfo;
        spaceId: SpaceId | null;
        accountStore: AccountClientStore;
        fileStore: FileClientStore;
        currentAccount: AccountModel | null;
        spacingScale: SpacingScale;
        platform: Platform;
        routeLayout: RouteLayout;
        isInitialAppRender: boolean;
        currentDate: CalendarDate;
        fileEntityRenderers: ContentFileEntityRenderers | null;
        withPosAttribute?: boolean;
        placeholder?: string;
    },
): Store<string> {
    return renderContentFragmentToHtmlGeneratorStore(content, {
        getContext,
        clientInfo,
        spaceId,
        accountStore,
        fileStore,
        currentAccount,
        blockWidth: getContentBlockWidth({
            spacingScale,
            platform,
            routeLayout,
            clientInfo,
        }),
        transformScale: 1,
        platform,
        spacingScale,
        isInitialAppRender,
        currentDate,
        fileEntityRenderers,
        withPosAttribute,
        placeholder,
    }).map(fragmentHtmlGenerator => {
        /* eslint-disable string-quotes */

        return `<div class="${classNames(
            contentStyles.docClassName,
            routeLayout === "narrow" ? contentStyles.narrowRouteLayoutDocClassName : undefined,
        )}">${fragmentHtmlGenerator.generateHtml()}</div>`;

        /* eslint-enable string-quotes */
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
export function renderContentFragmentToHtmlGeneratorStore(
    content: ContentWithReferences,
    options: Parameters<typeof actuallyRenderContentFragmentToHtmlGeneratorStore>[2],
): Store<HtmlFragmentGenerator> {
    return computeStore(get => {
        return actuallyRenderContentFragmentToHtmlGeneratorStore(get, content, options);
    });
}

export function actuallyRenderContentFragmentToHtmlGeneratorStore(
    get: <Value>(store: Store<Value>) => Value,
    content: ContentWithReferences,
    {
        getContext,
        clientInfo,
        spaceId,
        accountStore,
        fileStore,
        currentAccount,
        blockWidth,
        transformScale,
        platform,
        spacingScale,
        isInitialAppRender,
        currentDate,
        fileEntityRenderers,
        withPosAttribute,
        isInert,
        placeholder,
        decorations,
        shouldHighlightComment,
    }: {
        getContext: () => AppContext;
        clientInfo: ClientInfo;
        spaceId: SpaceId | null;
        accountStore: AccountClientStore;
        fileStore: FileClientStore;
        currentAccount: AccountModel | null;
        blockWidth: number;
        transformScale: number;
        platform: Platform;
        spacingScale: SpacingScale;
        isInitialAppRender: boolean;
        currentDate: CalendarDate;
        fileEntityRenderers: ContentFileEntityRenderers | null;
        withPosAttribute?: boolean;
        isInert?: boolean;
        placeholder?: string;
        decorations?: RecursiveReadonlyArray<ProsemirrorHtmlSerializationDecoration>;
        shouldHighlightComment?: (commentThreadId: DocumentCommentThreadId) => boolean;
    },
): HtmlFragmentGenerator {
    assert(content.doc.type.schema.topNodeType === content.doc.type);

    const isTitleEmpty = isContentTitleEmpty(content.doc);
    const isBodyEmpty = isContentBodyEmpty(content.doc);

    const orderedListItemNumberByNode = new Map<Node, number>();

    const fileRowLikeNodeRenderer = (node: Node, pos: number) => {
        const $pos = content.doc.resolve(pos);

        const {html, contentHtml} = renderProsemirrorDomOutputSpec(node.type.spec.toDOM!(node));

        assert(html instanceof HtmlElementGenerator);

        let currentBlockWidth = blockWidth;

        if ($pos.depth > 0) {
            const parentBlockNode = $pos.node(1);

            // If our file is inside a table then `blockWidth` should be equal to the
            // column width.
            if (parentBlockNode.type.name === "table") {
                const tableMap = ContentTableMap.get(parentBlockNode);

                // Should be the `tableCell` node index in `tableRow`.
                const columnIndex = $pos.index(2);

                const columnWidths = resolveContentTableColumnWidthPx(
                    spacingScale,
                    currentBlockWidth,
                    tableMap,
                );

                const columnWidth = assertExists(columnWidths[columnIndex]);

                currentBlockWidth =
                    columnWidth -
                    convertRemLengthToPx(contentStyles.tableCellPaddingX, spacingScale) * 2;
            }
        }

        const layouts = layoutContentFileParent(node, {
            blockWidth: currentBlockWidth,
            platform,
            spacingScale,
            getFile: fileId => {
                const fileReference = content.references.fileById?.get(fileId);
                if (!fileReference) return null;

                return get(fileStore.getFileStore(fileReference));
            },
        });

        html.setAttribute(
            "style",
            [
                `height: ${Math.max(...layouts.map(({height}) => height))}px`,
                `grid-template-columns: ${layouts.map(({widthFr}) => `${widthFr}fr`).join(" ")}`,
            ].join("; "),
        );

        return {
            html,
            contentHtml,
        };
    };

    return serializeProsemirrorFragmentToHtmlGenerator(content.doc.content, {
        withPosAttribute,
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
                    computeContentOrderedListItemNumbers(parentNode, orderedListItemNumberByNode);

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
                checkboxHtml.setAttribute("class", contentStyles.checkListItemCheckboxClassName);
                checkboxHtml.appendChild(
                    createSvgHtmlGenerator(
                        checkIconSvg({
                            weight: "bold",
                            className: contentStyles.checkListItemCheckboxIconClassName,
                        }),
                    ),
                );

                const contentHtml = new HtmlElementGenerator("div");
                html.appendChild(contentHtml);
                contentHtml.setAttribute("class", contentStyles.checkListItemContentClassName);

                return {html, contentHtml};
            },
            codeBlock: node => {
                // IMPORTANT: Any change you make to this function also likely must be made to
                // the `codeBlock` node view in `content_editor_code_block_node_view.ts`.

                const languageId: ContentCodeBlockLanguageId = node.attrs.language ?? "text";
                const language = contentCodeBlockLanguageById[languageId];

                const {html, contentHtml} = renderProsemirrorDomOutputSpec(
                    node.type.spec.toDOM!(node),
                );

                assert(html instanceof HtmlElementGenerator && html.tagName === "pre");
                assert(
                    contentHtml instanceof HtmlElementGenerator && contentHtml.tagName === "code",
                );
                assert(html.childElementCount === 1);
                assert(html.firstElementChild === contentHtml);

                const toolbarHtml = new HtmlElementGenerator("div");
                html.insertBefore(toolbarHtml, contentHtml);
                toolbarHtml.setAttribute("class", contentStyles.codeBlockToolbarClassName);

                const toolbarFlexHtml = new HtmlElementGenerator("div");
                toolbarHtml.appendChild(toolbarFlexHtml);
                toolbarFlexHtml.setAttribute("class", contentStyles.codeBlockToolbarFlexClassName);

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
                    copyButtonHtml.appendChild(
                        createSvgHtmlGenerator(
                            clipboardTextIconSvg({
                                className: contentStyles.codeBlockCopyButtonIconClassName,
                            }),
                        ),
                    );
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
            fileRow: fileRowLikeNodeRenderer,
            fileRowTable: fileRowLikeNodeRenderer,
            fileFloat: node => {
                const {html, contentHtml} = renderProsemirrorDomOutputSpec(
                    node.type.spec.toDOM!(node),
                );

                assert(html instanceof HtmlElementGenerator);

                const childNode = node.content.content[0]!;
                assert(childNode.type.name === "file");

                const layouts = layoutContentFileParent(node, {
                    blockWidth,
                    platform,
                    spacingScale,
                    getFile: fileId => {
                        const fileReference = content.references.fileById?.get(fileId);
                        if (!fileReference) return null;

                        return get(fileStore.getFileStore(fileReference));
                    },
                });

                html.setAttribute(
                    "style",
                    [`width: ${layouts[0]!.width}px`, `height: ${layouts[0]!.height}px`].join("; "),
                );

                return {
                    html,
                    contentHtml,
                };
            },
            file: (node, pos) => {
                const $pos = content.doc.resolve(pos);

                let currentBlockWidth = blockWidth;

                if ($pos.depth > 0) {
                    const parentBlockNode = $pos.node(1);

                    // If our file is inside a table then `blockWidth` should be equal to the
                    // column width.
                    if (parentBlockNode.type.name === "table") {
                        const tableMap = ContentTableMap.get(parentBlockNode);

                        // Should be the `tableCell` node index in `tableRow`.
                        const columnIndex = $pos.index(2);

                        const columnWidths = resolveContentTableColumnWidthPx(
                            spacingScale,
                            currentBlockWidth,
                            tableMap,
                        );

                        const columnWidth = assertExists(columnWidths[columnIndex]);

                        currentBlockWidth =
                            columnWidth -
                            convertRemLengthToPx(contentStyles.tableCellPaddingX, spacingScale) * 2;
                    }
                }

                const fileId: FileId | FileEntityId | null = node.attrs.fileId;
                const isFileEntity = fileId && !isId<FileId>(fileId);

                const fileReference =
                    fileId && !isFileEntity ? content.references.fileById?.get(fileId) : undefined;

                const fileEntityResult = isFileEntity
                    ? content.references.fileEntityById?.get(fileId)
                    : undefined;

                const file = fileReference ? get(fileStore.getFileStore(fileReference)) : undefined;

                const layout = layoutContentFile(content.doc, pos, node, {
                    blockWidth: currentBlockWidth,
                    platform,
                    spacingScale,
                    getFile: otherFileId => {
                        if (otherFileId === fileId) return file ?? null;

                        const otherFileReference = content.references.fileById?.get(otherFileId);
                        if (!otherFileReference) return null;

                        return get(fileStore.getFileStore(otherFileReference));
                    },
                });

                if (isFileEntity) {
                    const html = renderContentFileEntityPreview(get, {
                        node,
                        fileEntityId: fileId,
                        fileEntityResult,
                        fileEntityRenderers,
                        layout,
                        getContext,
                        clientInfo,
                        spaceId: assertExists(spaceId),
                        accountStore,
                        fileStore,
                        currentAccount,
                        blockWidth: currentBlockWidth,
                        transformScale,
                        platform,
                        spacingScale,
                        isInitialAppRender,
                        currentDate,
                    });

                    return {html};
                } else {
                    const html = renderContentFilePreview({
                        spaceId: assertExists(spaceId),
                        node,
                        file,
                        layout,
                        blockWidth: currentBlockWidth,
                        transformScale,
                        platform,
                        spacingScale,
                        isInitialAppRender,
                    });

                    return {html};
                }
            },
            table: node => {
                const tableWrapperElement = new HtmlElementGenerator("div");
                tableWrapperElement.setAttribute("class", tableWrapperClassName);

                const tableWrapper2Element = new HtmlElementGenerator("div");
                tableWrapperElement.appendChild(tableWrapper2Element);
                tableWrapper2Element.setAttribute("class", tableWrapper2ClassName);
                tableWrapper2Element.setAttribute("data-scrollbar", "false");

                const tableWrapper3Element = new HtmlElementGenerator("div");
                tableWrapper2Element.appendChild(tableWrapper3Element);
                tableWrapper3Element.setAttribute("class", tableWrapper3ClassName);

                const tableElement = new HtmlElementGenerator("table");
                tableWrapper3Element.appendChild(tableElement);

                const tableClasses = classNames({
                    [contentStyles.tableWithHeaderRowClassName]: node.attrs.hasHeaderRow,
                    [contentStyles.tableWithHeaderColumnClassName]: node.attrs.hasHeaderColumn,
                });

                if (tableClasses) {
                    tableElement.setAttribute("class", tableClasses);
                }

                const tableMap = ContentTableMap.get(node);
                const tableWidth = tableMap.tableWidth;
                const columnWidths = tableMap.columnWidths;
                const totalColumnWidth = tableMap.totalColumnWidth;

                const tableOverflowGradientWidthPx = convertRemLengthToPx(
                    contentStyles.tableOverflowGradientWidth,
                    spacingScale,
                );

                const resolvedColumnWidthPxs = resolveContentTableColumnWidthPx(
                    spacingScale,
                    blockWidth,
                    {
                        columnWidths,
                        tableWidth,
                        totalColumnWidth,
                    },
                );

                const totalColumnWidthPx = resolvedColumnWidthPxs.reduce(
                    (totalWidthPx, columnWidthPx) => totalWidthPx + columnWidthPx,
                    0,
                );

                tableWrapper3Element.setAttribute(
                    "style",
                    `width: ${
                        totalColumnWidthPx + tableOverflowGradientWidthPx * 2
                    }px; max-width: none`,
                );

                tableElement.setAttribute(
                    "style",
                    `grid-template-columns: ${resolvedColumnWidthPxs
                        .map(columnWidthPx => `${columnWidthPx}px`)
                        .join(" ")}`,
                );

                const tableBodyElement = new HtmlElementGenerator("tbody");
                tableElement.appendChild(tableBodyElement);

                return {html: tableWrapperElement, contentHtml: tableBodyElement};
            },

            // Add custom renderers which add the `data-placeholder` attribute when our
            // content is empty.
            //
            // The `title` node always renders a placeholder even if the `placeholder` prop
            // isn't set. This behavior is used by document presentation mode. Which
            // doesn't set a `placeholder` prop but does render "Untitled" when there's no
            // title.
            title: isTitleEmpty
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
}
