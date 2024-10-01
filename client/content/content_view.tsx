import classNames from "classnames";
import {Node} from "prosemirror-model";
import {Memo, useCallback, useEffect, useId, useMemo, useRef, useState} from "react";
import {flushSync} from "react-dom";
import {useAccountClientStore} from "~/client/accounts/account_client_store_context_provider.js";
import {addUnfocusableButtonBehaviorToElement} from "~/client/content/internal/content_editor_code_block_node_view.js";
import {handleContentLinkClick} from "~/client/content/internal/handle_content_link_click.js";
import {
    ContentFilePreviewExpirationTimers,
    addContentFilePreviewBehavior,
} from "~/client/content/internal/render_content_file_preview.js";
import {renderContentFragmentToHtmlStore} from "~/client/content/render_content_to_html.js";
import {writeContentToClipboard} from "~/client/content/write_content_to_clipboard.js";
import {useAppContextIfExists} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {PrettyAbsoluteDateTooltipContent} from "~/client/design/pretty_absolute_date.js";
import {useReporter} from "~/client/design/reporter.js";
import {Tooltip, TooltipRef} from "~/client/design/tooltip.js";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/initial_app_render.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/helpers/use_store.js";
import {getClientInfo, useClientInfo} from "~/client/remix/client_info_context.js";
import {useCanPrimaryInputHover, useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContextIfExists} from "~/client/spaces/space_context.js";
import {contentStyles, contentViewStyles, sprinkles} from "~/client/styles/styles.js";
import {ContentCodeBlockIncrementalParser} from "~/shared/content/code/content_code_block_incremental_parser.js";
import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import {
    ContentCodeBlockHtmlSerializationDecoration,
    createContentCodeBlockHtmlSerializationDecorationsStore,
} from "~/shared/content/code/create_content_code_block_html_serialization_decorations_store.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {
    ContentReferences,
    ContentWithReferences,
    mergeContentReferencesFileById,
} from "~/shared/content/content_references.js";
import {fileClassName, linkClassName, paragraphClassName} from "~/shared/content/content_styles.js";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty.js";
import {isTextEndedWithPunctuation} from "~/shared/content/print_content_single_line_text_snippet.js";
import {defaultThemeColor} from "~/shared/design/theme_colors.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {emptySet} from "~/shared/helpers/array/empty_set.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {Id, generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, FileId} from "~/shared/id/types/id_types.js";
import {ProsemirrorHtmlSerializationDecoration} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema.js";
import {Store} from "~/shared/store/store.js";

const ContentViewCodeBlockDecorationsSchema = Schema.array(
    Schema.object({
        from: Schema.integer,
        to: Schema.integer,
        class: Schema.string,
    }).transform<ContentCodeBlockHtmlSerializationDecoration>({
        serialize: decoration => ({
            from: decoration.from,
            to: decoration.to,
            class: decoration.attrs.class ?? "",
        }),
        deserialize: decoration => ({
            type: "Inline",
            from: decoration.from,
            to: decoration.to,
            attrs: {
                nodeName: "span",
                class: decoration.class,
            },
        }),
    }),
);

declare global {
    // eslint-disable-next-line no-var
    var __contentViewCodeBlockDecorationsById: {[key: string]: SchemaSerializedValue} | undefined;
}

/**
 * A read-only view of content. Used as a complement to `<ContentEditor>` when
 * you want to disable editing of content and only allow reading the content.
 */
// TODO(calebmer, #files): Copy logic for `<ContentView>` that matches
// `<ContentEditor>`. Also drag logic for `<ContentView>` should match
// `<ContentEditor>`.
export function ContentView({
    withMobileLayout,
    content: contentFromProps,
    contentUpdatedTime,
    placeholder,
    className,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    isInert = false,
    isTruncated = false,
    isCompact = false,
    isExtraCompact = false,
    isEditorInitialAppRender = false,
    isBackgroundColorGrey5 = false,
    fileAttachmentTarget,
    shouldHighlightComment,
    withUserSelectNone = false,
    onSeeMoreContent,
    onSeeLessContent,
    fileLayoutScreenWidth,
}: {
    /**
     * Are we rendering with a mobile layout? True on the mobile platform and true
     * in peeks on the desktop platform.
     */
    withMobileLayout: boolean;

    /**
     * The content to render.
     */
    content: ContentWithReferences;

    /**
     * This prop puts an `(updated)` message at the end of our content with a
     * tooltip with the time the content was updated at.
     */
    contentUpdatedTime?: Date | null;

    /** Placeholder text to render when there is no other content. */
    placeholder?: string;

    /** An extra CSS class to add to the content view. */
    className?: string;

    /** An optional label to expose to assistive technology. */
    "aria-label"?: string;

    /** An optional label to expose to assistive technology. */
    "aria-labelledby"?: string;

    /**
     * Should all interactive elements be made inert? So not clickable and not
     * focusable. Gets its name from the [`inert` attribute][1].
     *
     * Manually implemented instead of relying on the HTML `inert` attribute since
     * it doesn't have great browser support.
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inert
     */
    isInert?: boolean;

    /**
     * Should the content be truncated to a single line with an ellipsis when
     * text overflows?
     */
    isTruncated?: boolean;

    /**
     * Should this content be rendered with our compact rendering? Compact
     * rendering reduces some margins so content can be closer together.
     */
    isCompact?: boolean;

    /**
     * Should this content be rendered with our extra compact render? Extra compact
     * rendering implies `isCompact` and decreases the paragraph font size.
     */
    isExtraCompact?: boolean;

    /**
     * Are we rendering a `<ContentView>` as a placeholder during initial app
     * render for `<ContentEditor>`? Not much changes when this is true but we
     * disable some behaviors we save for `<ContentEditor>`.
     */
    isEditorInitialAppRender?: boolean;

    /**
     * Is this `<ContentView>` rendered on a `grey-5` background? If true certain
     * colors may change. For example, the code block button's hover background
     * color will change from `grey-5` to `grey-10`.
     */
    isBackgroundColorGrey5?: boolean;

    /**
     * If the content editor supports files then you must pass in
     * `FileAttachmentTarget`. This prop is used:
     *
     * 1. Before adding a file to content we need to call either
     *    `attachFileAsUploader()` or `attachFileFromAttachment()` to make sure
     *    everyone who has access to the attachment target has access to the file.
     *    We use the attachment target to create the correct link.
     *
     * 2. When refreshing expired signed preview URLs we need the attachment target
     *    so we can prove the current account has access to the file.
     *
     * An error will be thrown if your content supports files but doesn't provide
     * `fileAttachmentTarget`.
     */
    fileAttachmentTarget?: Memo<FileAttachmentTarget>;

    /**
     * Should we highlight the provided comment thread? By default the content view
     * renders no comment highlights.
     */
    shouldHighlightComment?: Memo<(commentThreadId: DocumentCommentThreadId) => boolean>;

    /**
     * Set the CSS `user-select: none` to disable text selection of this element.
     */
    withUserSelectNone?: boolean;

    /**
     * Adds a "See more" button which when clicked should reveal the whole content.
     * Useful when you want to show snippet of truncated content that expands to
     * more.
     */
    onSeeMoreContent?: () => void;

    /**
     * Adds a "See less" button which when clicked should collapse content to a
     * truncated version which a "See more" button should be able to expand (see
     * `onSeeMoreContent`).
     */
    onSeeLessContent?: () => void;

    /**
     * Override the screen width provided to `layoutContentFileRow()`. By default
     * we use the smaller of `clientInfo.screenWidth` and the max content width but
     * if you're intentionally rendering a narrow `<ContentView>` then you should
     * set this value for better layout results. Measured in pixels.
     */
    fileLayoutScreenWidth?: number;
}) {
    assert(
        !contentFromProps.doc.type.schema.nodes.file || fileAttachmentTarget,
        "ProseMirror schema supports files but `fileAttachmentTarget` prop isn't provided",
    );

    const clientInfo = useClientInfo();
    const isMobile = useIsMobile();
    const isInitialAppRender = useIsInitialAppRender();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const accountStore = useAccountClientStore();
    const reporter = useReporter();

    // Don't get the current account when running in a unit test so we don't need
    // to render a space context when testing this component.
    const context = useAppContextIfExists();
    const spaceContext = useSpaceContextIfExists();

    const id = useId();
    const ref = useRef<HTMLDivElement>(null);
    const codeBlockCopyButtonTooltipRef = useRef<TooltipRef>(null);

    const [focusedLinkElement, setFocusedLinkElement] = useState<HTMLElement | null>(null);

    const [contentUpdatedNoteElement, setContentUpdatedNoteElement] = useState<HTMLElement | null>(
        null,
    );

    const shouldShowSeeMoreContentButton = !!onSeeMoreContent;
    const shouldShowSeeLessContentButton = !!onSeeLessContent;

    const events = useEvents({
        onSeeMoreContent: onSeeMoreContent ?? noop,
        onSeeLessContent: onSeeLessContent ?? noop,
    });

    const [filePreviewExpirationTimers] = useState<ContentFilePreviewExpirationTimers | undefined>(
        () => (fileAttachmentTarget ? new ContentFilePreviewExpirationTimers() : undefined),
    );
    const [updatedContentReferencesFileById, setUpdatedContentReferencesFileById] = useState<
        ContentReferences["fileById"] | null
    >(null);

    const updatedContentReferences = useMemo(() => {
        if (!updatedContentReferencesFileById) return contentFromProps.references;

        const newFileById = mergeContentReferencesFileById(
            contentFromProps.references.fileById,
            updatedContentReferencesFileById,
        );

        if (newFileById === contentFromProps.references.fileById)
            return contentFromProps.references;

        return {...contentFromProps.references, fileById: newFileById};
    }, [contentFromProps.references, updatedContentReferencesFileById]);

    const content = useMemo(
        () => ({doc: contentFromProps.doc, references: updatedContentReferences}),
        [contentFromProps.doc, updatedContentReferences],
    );

    const [initialCodeBlockDecorationsState, setInitialCodeBlockDecorationsState] = useState<{
        readonly doc: Node;
        readonly decorations: ReadonlyArray<ContentCodeBlockHtmlSerializationDecoration>;
    } | null>(() => {
        if (typeof window === "undefined") return null;
        if (!isInitialAppRender) return null;

        const serializedDecorations = window.__contentViewCodeBlockDecorationsById?.[id];
        if (!serializedDecorations) return null;

        delete window.__contentViewCodeBlockDecorationsById![id];
        const decorations =
            ContentViewCodeBlockDecorationsSchema.deserialize(serializedDecorations);

        if (isEditorInitialAppRender && decorations.length > 0) {
            ContentCodeBlockIncrementalParser.getInitialDecorationsByNode().set(
                content.doc,
                decorations,
            );
        }

        return {
            doc: content.doc,
            decorations,
        };
    });
    let initialCodeBlockDecorations = initialCodeBlockDecorationsState?.decorations ?? null;

    // If the document we're rendering changes, remove code block decorations from
    // the server side render.
    if (
        initialCodeBlockDecorationsState !== null &&
        initialCodeBlockDecorationsState.doc !== content.doc
    ) {
        initialCodeBlockDecorations = null;
        setInitialCodeBlockDecorationsState(null);
    }

    const {isTitleEmpty, isBodyEmpty, htmlStore} = useMemo(() => {
        const decorations: Array<ProsemirrorHtmlSerializationDecoration> = [];

        if (contentUpdatedTime) {
            let depthToLastTextblockChild = null;
            let lastTextblockChild = content.doc.lastChild;
            let depth = 1;

            while (lastTextblockChild !== null) {
                if (lastTextblockChild.isTextblock) {
                    depthToLastTextblockChild = depth;
                    break;
                }
                lastTextblockChild = lastTextblockChild.lastChild;
                depth++;
            }

            const depthToLastParagraphChild =
                lastTextblockChild?.type.name === "paragraph" ? depthToLastTextblockChild : null;

            let html: HtmlElementGenerator;
            if (depthToLastParagraphChild !== null) {
                const updatedNoteHtml = new HtmlElementGenerator("span");
                updatedNoteHtml.setAttribute("id", `${id}-edited`);
                updatedNoteHtml.setAttribute("class", contentViewStyles.updatedNoteClassName);
                updatedNoteHtml.appendChild(new HtmlTextGenerator(" (edited)"));

                html = updatedNoteHtml;
            } else {
                const updatedNoteContainerHtml = new HtmlElementGenerator("p");
                updatedNoteContainerHtml.setAttribute("class", paragraphClassName);

                const updatedNoteHtml = new HtmlElementGenerator("span");
                updatedNoteContainerHtml.appendChild(updatedNoteHtml);
                updatedNoteHtml.setAttribute("id", `${id}-edited`);
                updatedNoteHtml.setAttribute("class", contentViewStyles.updatedNoteClassName);
                updatedNoteHtml.appendChild(new HtmlTextGenerator("(edited)"));

                html = updatedNoteContainerHtml;
            }

            decorations.push({
                type: "Widget",
                pos: content.doc.nodeSize - ((depthToLastParagraphChild ?? 0) + 1),
                html,
            });
        }

        if (shouldShowSeeMoreContentButton || shouldShowSeeLessContentButton) {
            let depthToLastTextblockChild = null;
            let lastTextblockChild = content.doc.lastChild;
            let depth = 1;

            while (lastTextblockChild !== null) {
                if (lastTextblockChild.isTextblock) {
                    depthToLastTextblockChild = depth;
                    break;
                }
                lastTextblockChild = lastTextblockChild.lastChild;
                depth++;
            }

            const depthToLastParagraphChild =
                lastTextblockChild?.type.name === "paragraph" ? depthToLastTextblockChild : null;

            const buttonText = shouldShowSeeLessContentButton ? "See less" : "See more";

            let html: HtmlElementGenerator;
            if (
                depthToLastParagraphChild !== null &&
                // Always render "See less" on its own line. Don't put it inline with the last
                // paragraph.
                !shouldShowSeeLessContentButton
            ) {
                const shouldAddEllipsis =
                    lastTextblockChild &&
                    lastTextblockChild.childCount > 0 &&
                    !isTextEndedWithPunctuation(lastTextblockChild.lastChild!.text!);

                const seeButtonContainerHtml = new HtmlElementGenerator("span");

                seeButtonContainerHtml.appendChild(
                    new HtmlTextGenerator(shouldAddEllipsis ? "… " : " "),
                );

                const seeButtonHtml = new HtmlElementGenerator("span");
                seeButtonContainerHtml.appendChild(seeButtonHtml);
                seeButtonHtml.setAttribute("id", `${id}-edited`);
                seeButtonHtml.setAttribute("class", contentViewStyles.seeButtonClassName);
                seeButtonHtml.appendChild(new HtmlTextGenerator(buttonText));

                html = seeButtonContainerHtml;
            } else {
                const seeButtonContainerHtml = new HtmlElementGenerator("p");
                seeButtonContainerHtml.setAttribute("class", paragraphClassName);

                const seeButtonHtml = new HtmlElementGenerator("span");
                seeButtonContainerHtml.appendChild(seeButtonHtml);
                seeButtonHtml.setAttribute("id", `${id}-edited`);
                seeButtonHtml.setAttribute("class", contentViewStyles.seeButtonClassName);
                seeButtonHtml.appendChild(new HtmlTextGenerator(buttonText));

                html = seeButtonContainerHtml;
            }

            decorations.push({
                type: "Widget",
                pos: content.doc.nodeSize - ((depthToLastParagraphChild ?? 0) + 1),
                html,
            });
        }

        content.doc.descendants((node, pos) => {
            if (!node.isText) return;

            for (const {index, emoji} of iterateEmojis(node.text!)) {
                decorations.push({
                    type: "Inline",
                    from: pos + index,
                    to: pos + index + emoji.length,
                    attrs: {
                        nodeName: "span",
                        class: contentStyles.emojiClassName,
                    },
                });
            }
        });

        let htmlStore: Store<{
            html: string;
            codeBlockDecorations: ReadonlyArray<ContentCodeBlockHtmlSerializationDecoration>;
        }>;

        // If we have some initial code block decorations from server-side rendering
        // then use those instead of trying to compute new decorations. Since we
        // may not be able to compute new decorations given no language parsers will be
        // loaded on initial render.
        if (initialCodeBlockDecorations === null) {
            const codeBlockDecorationsStore =
                createContentCodeBlockHtmlSerializationDecorationsStore(content.doc);

            htmlStore = codeBlockDecorationsStore.flatMap(codeBlockDecorations =>
                renderContentFragmentToHtmlStore(content, {
                    spaceId: spaceContext?.space.id ?? null,
                    accountStore,
                    currentAccount: spaceContext?.currentAccount ?? null,
                    screenWidth: fileLayoutScreenWidth ?? clientInfo.screenWidth,
                    isMobile,
                    placeholder,
                    isInert,
                    decorations: [decorations, codeBlockDecorations],
                    shouldHighlightComment,
                    filePreviewExpirationTimers,
                }).map(html => ({
                    html,
                    codeBlockDecorations,
                })),
            );
        } else {
            content.doc.forEach(node => {
                // Currently, code blocks may only be a direct child of `doc`.
                if (node.type.name !== "codeBlock") return;

                const languageId: ContentCodeBlockLanguageId = node.attrs.language ?? "text";
                const language = contentCodeBlockLanguageById[languageId];

                // Preload code block languages while we're using initial code block
                // decorations so we're ready for a re-render.
                language.getParser();
            });

            htmlStore = renderContentFragmentToHtmlStore(content, {
                spaceId: spaceContext?.space.id ?? null,
                accountStore,
                currentAccount: spaceContext?.currentAccount ?? null,
                screenWidth: fileLayoutScreenWidth ?? clientInfo.screenWidth,
                isMobile,
                placeholder,
                isInert,
                decorations: [decorations, initialCodeBlockDecorations],
                shouldHighlightComment,
                filePreviewExpirationTimers,
            }).map(html => ({
                html,
                codeBlockDecorations: initialCodeBlockDecorations!,
            }));
        }

        return {
            isTitleEmpty: isContentTitleEmpty(content.doc),
            isBodyEmpty: isContentBodyEmpty(content.doc),
            htmlStore,
        };
    }, [
        contentUpdatedTime,
        shouldShowSeeMoreContentButton,
        shouldShowSeeLessContentButton,
        content,
        initialCodeBlockDecorations,
        id,
        spaceContext?.space.id,
        spaceContext?.currentAccount,
        accountStore,
        fileLayoutScreenWidth,
        clientInfo.screenWidth,
        isMobile,
        placeholder,
        isInert,
        shouldHighlightComment,
        filePreviewExpirationTimers,
    ]);

    const {html, codeBlockDecorations} = useStore(htmlStore);

    const navigate = useNavigate();

    const [codeBlockCopyButtonTooltipState, setCodeBlockCopyButtonTooltipState] = useState<{
        readonly key: Id;
        readonly targetElement: HTMLElement;
        readonly wasPressed: boolean;
    } | null>(null);

    // Whenever this component renders check that `targetElement` is still in the
    // DOM. If it's not (maybe `attr`s changed or another user removed it) then
    // reset our state to null.
    if (
        codeBlockCopyButtonTooltipState &&
        (isMobile || !document.body.contains(codeBlockCopyButtonTooltipState.targetElement))
    ) {
        setCodeBlockCopyButtonTooltipState(null);
    }

    const handleCodeBlockCopyButtonHoverStart = useCallback((targetElement: HTMLElement) => {
        setCodeBlockCopyButtonTooltipState({
            key: generateId(),
            targetElement,
            wasPressed: false,
        });
    }, []);

    const handleCodeBlockCopyButtonHoverEnd = useCallback((targetElement: HTMLElement) => {
        // We intentionally do not remove our tooltip state when the hover ends. Since
        // we need to wait until the tooltip fades out on its own.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        targetElement;
    }, []);

    const handleCodeBlockCopyButtonPress = useCallback((targetElement: HTMLElement) => {
        codeBlockCopyButtonTooltipRef.current?.skipTooltipHoverDelayAndAnimation();

        setCodeBlockCopyButtonTooltipState(state =>
            state?.targetElement === targetElement && !state?.wasPressed
                ? {...state, wasPressed: true}
                : state,
        );
    }, []);

    useEffect(() => {
        filePreviewExpirationTimers?.play();
        return () => {
            filePreviewExpirationTimers?.pause();
        };
    }, [filePreviewExpirationTimers]);

    useEffect(() => {
        if (isInert) return;

        // Re-run this effect whenever the HTML changes.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        html;

        const parentElement = assertExists(ref.current);

        const cleanupFunctions: Array<() => void> = [];

        for (const element of parentElement.querySelectorAll(
            `.${linkClassName}, .${contentViewStyles.seeButtonClassName}, .${contentStyles.codeBlockCopyButtonClassName}, .${fileClassName}`,
        )) {
            if (!(element instanceof HTMLElement)) continue;

            if (element.classList.contains(linkClassName) && element instanceof HTMLAnchorElement) {
                let isPointerDownAndOver = false;

                const maybeUpdateStyle = () => {
                    if (isPointerDownAndOver) {
                        element.classList.add(contentStyles.linkPressedClassName);
                    } else {
                        element.classList.remove(contentStyles.linkPressedClassName);
                    }
                };

                const handleClick = (event: MouseEvent) => {
                    const isOpenLinkInSeparateTabEvent = isOpenLinkInSeparateTabPointerEvent(
                        event,
                        getClientInfo(),
                    );

                    // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
                    // modifier. Unless the click was meant to open the link in a separate tab. We
                    // need to implement that manually here given the text is editable.
                    if (
                        (event.button !== 0 || isModifiedPointerEvent(event)) &&
                        !isOpenLinkInSeparateTabEvent
                    ) {
                        return;
                    }

                    // Must call prevent default here in addition to `pointerdown` to stop mobile
                    // WebKit from following a link after click.
                    event.preventDefault();
                };

                const handlePointerDown = (event: MouseEvent) => {
                    isPointerDownAndOver =
                        event.button === 0 &&
                        (!isModifiedPointerEvent(event) ||
                            isOpenLinkInSeparateTabPointerEvent(event, getClientInfo()));

                    maybeUpdateStyle();

                    // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
                    // modifier. Unless the click was meant to open the link in a separate tab. We
                    // need to implement that manually here given the text is editable.
                    if (
                        (event.button !== 0 || isModifiedPointerEvent(event)) &&
                        !isOpenLinkInSeparateTabPointerEvent(event, getClientInfo())
                    ) {
                        return;
                    }

                    // This will be a navigation click if the pointer stays over our element. Don't
                    // select the editable text.
                    event.preventDefault();
                };

                const handlePointerUp = (event: MouseEvent) => {
                    const wasPointerDownAndOver = isPointerDownAndOver;
                    isPointerDownAndOver = false;
                    maybeUpdateStyle();

                    // Only process pointer up events that started on our element.
                    if (!wasPointerDownAndOver) {
                        return;
                    }

                    handleContentLinkClick(event, navigate);
                };

                const handlePointerLeave = () => {
                    isPointerDownAndOver = false;
                    maybeUpdateStyle();
                };

                const handleDragStart = () => {
                    isPointerDownAndOver = false;
                    maybeUpdateStyle();
                };

                element.addEventListener("click", handleClick);
                element.addEventListener("pointerdown", handlePointerDown);
                element.addEventListener("pointerup", handlePointerUp);
                element.addEventListener("pointerleave", handlePointerLeave);
                element.addEventListener("dragstart", handleDragStart);
                cleanupFunctions.push(() => {
                    element.removeEventListener("click", handleClick);
                    element.removeEventListener("pointerdown", handlePointerDown);
                    element.removeEventListener("pointerup", handlePointerUp);
                    element.removeEventListener("pointerleave", handlePointerLeave);
                    element.removeEventListener("dragstart", handleDragStart);
                });
            }

            if (element.classList.contains(contentViewStyles.seeButtonClassName)) {
                let isPointerDownAndOver = false;

                const maybeUpdateStyle = () => {
                    if (isPointerDownAndOver) {
                        element.classList.add(contentViewStyles.seeButtonPressedClassName);
                    } else {
                        element.classList.remove(contentViewStyles.seeButtonPressedClassName);
                    }
                };

                const handleClick = (event: MouseEvent) => {
                    // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
                    // modifier. Unless the click was meant to open the link in a separate tab. We
                    // need to implement that manually here given the text is editable.
                    if (event.button !== 0 || isModifiedPointerEvent(event)) {
                        return;
                    }

                    // Must call prevent default here in addition to `pointerdown` to stop mobile
                    // WebKit from following a link after click.
                    event.preventDefault();
                };

                const handlePointerDown = (event: MouseEvent) => {
                    isPointerDownAndOver = event.button === 0 && !isModifiedPointerEvent(event);

                    maybeUpdateStyle();

                    // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
                    // modifier. Unless the click was meant to open the link in a separate tab. We
                    // need to implement that manually here given the text is editable.
                    if (event.button !== 0 || isModifiedPointerEvent(event)) {
                        return;
                    }

                    // This will be a navigation click if the pointer stays over our element. Don't
                    // select the editable text.
                    event.preventDefault();
                };

                const handlePointerUp = () => {
                    const wasPointerDownAndOver = isPointerDownAndOver;
                    isPointerDownAndOver = false;
                    maybeUpdateStyle();

                    // Only process pointer up events that started on our element.
                    if (!wasPointerDownAndOver) {
                        return;
                    }

                    if (shouldShowSeeLessContentButton) {
                        events.onSeeLessContent();
                    } else if (shouldShowSeeMoreContentButton) {
                        events.onSeeMoreContent();
                    }
                };

                const handlePointerLeave = () => {
                    isPointerDownAndOver = false;
                    maybeUpdateStyle();
                };

                const handleDragStart = () => {
                    isPointerDownAndOver = false;
                    maybeUpdateStyle();
                };

                element.addEventListener("click", handleClick);
                element.addEventListener("pointerdown", handlePointerDown);
                element.addEventListener("pointerup", handlePointerUp);
                element.addEventListener("pointerleave", handlePointerLeave);
                element.addEventListener("dragstart", handleDragStart);
                cleanupFunctions.push(() => {
                    element.removeEventListener("click", handleClick);
                    element.removeEventListener("pointerdown", handlePointerDown);
                    element.removeEventListener("pointerup", handlePointerUp);
                    element.removeEventListener("pointerleave", handlePointerLeave);
                    element.removeEventListener("dragstart", handleDragStart);
                });
            }

            if (element.classList.contains(contentStyles.codeBlockCopyButtonClassName)) {
                let isCodeBlockCopyButtonHovered = false;

                // We don't need to cleanup event listeners on DOM nodes created for this
                // node view.
                const cleanup = addUnfocusableButtonBehaviorToElement(element, {
                    defaultClassName: sprinkles({
                        color: "grey-60",
                    }),
                    hoverClassName: sprinkles({
                        color: "grey-60",
                        backgroundColor: "grey-5",
                    }),
                    pressClassName: sprinkles({
                        color: "grey-100",
                        backgroundColor: "grey-10",
                    }),
                    onHoverStart: () => {
                        const wasCodeBlockCopyButtonHovered = isCodeBlockCopyButtonHovered;
                        isCodeBlockCopyButtonHovered = true;
                        if (!wasCodeBlockCopyButtonHovered)
                            handleCodeBlockCopyButtonHoverStart(element);
                    },
                    onHoverEnd: () => {
                        const wasCodeBlockCopyButtonHovered = isCodeBlockCopyButtonHovered;
                        isCodeBlockCopyButtonHovered = false;
                        if (wasCodeBlockCopyButtonHovered)
                            handleCodeBlockCopyButtonHoverEnd(element);
                    },
                    onPress: () => {
                        const posString = element.dataset.pos;
                        assert(posString);
                        const pos = parseInt(posString, 10);
                        assert(!isNaN(pos));

                        const $pos = content.doc.resolve(pos);
                        const node = assertExists($pos.nodeAfter);
                        assert(node.type.name === "codeBlock");

                        writeContentToClipboard(
                            assertExists(spaceContext).space.id,
                            content,
                            content.doc.slice(pos, pos + node.nodeSize),
                        ).catch(error => {
                            reporter.displayError("Couldn’t copy code", error);
                        });

                        handleCodeBlockCopyButtonPress(element);
                    },
                });

                cleanupFunctions.push(() => {
                    cleanup();

                    if (isCodeBlockCopyButtonHovered) {
                        isCodeBlockCopyButtonHovered = false;
                        handleCodeBlockCopyButtonHoverEnd(element);
                    }
                });
            }

            if (element.classList.contains(fileClassName)) {
                const posString = element.dataset.pos;
                assert(posString);
                const pos = parseInt(posString, 10);
                assert(!isNaN(pos));

                const $pos = content.doc.resolve(pos);
                assert($pos.nodeAfter?.type.name === "file");
                const node = $pos.nodeAfter;

                const fileId: FileId | null = node.attrs.fileId;
                const fileReference = fileId ? content.references.fileById.get(fileId) : undefined;

                const cleanup = addContentFilePreviewBehavior(
                    () => assertExists(context),
                    element,
                    {
                        spaceId: assertExists(spaceContext).space.id,
                        node,
                        reference: fileReference,
                        attachmentTarget: assertExists(fileAttachmentTarget),
                        expirationTimers: assertExists(filePreviewExpirationTimers),
                        isOurEditorUploading: false,
                        onUpdate: (file, previewUrlSearch) => {
                            setUpdatedContentReferencesFileById(fileById => {
                                return mergeContentReferencesFileById(
                                    fileById ?? new Map(),
                                    new Map([[file.id, {previewUrlSearch, file}]]),
                                );
                            });
                        },
                        onPreviewUrlSearchRefresh: (fileId, previewUrlSearch) => {
                            setUpdatedContentReferencesFileById(fileById => {
                                const oldFile = content.references.fileById.get(fileId);
                                if (!oldFile) return fileById;

                                return mergeContentReferencesFileById(
                                    fileById ?? new Map(),
                                    new Map([[fileId, {previewUrlSearch, file: oldFile.file}]]),
                                );
                            });
                        },
                    },
                );

                cleanupFunctions.push(cleanup);
            }
        }

        return () => {
            for (const cleanup of cleanupFunctions) {
                cleanup();
            }
        };
    }, [
        events,
        html,
        isInert,
        navigate,
        handleCodeBlockCopyButtonHoverEnd,
        handleCodeBlockCopyButtonHoverStart,
        shouldShowSeeLessContentButton,
        shouldShowSeeMoreContentButton,
        content,
        spaceContext,
        handleCodeBlockCopyButtonPress,
        reporter,
        isBackgroundColorGrey5,
        context,
        fileAttachmentTarget,
        filePreviewExpirationTimers,
    ]);

    useEffect(() => {
        const element = assertExists(ref.current);

        const handleFocusChange = (event: FocusEvent) => {
            const focusedElement =
                event.type === "focusout"
                    ? (event.relatedTarget as Element | null)
                    : document.activeElement;

            // Focus rings need to be rendered immediately.
            flushSync(() => {
                if (
                    focusedElement instanceof HTMLAnchorElement &&
                    focusedElement?.classList.contains(linkClassName)
                ) {
                    setFocusedLinkElement(focusedElement);
                } else {
                    setFocusedLinkElement(null);
                }
            });
        };

        // `focusin` and `focusout` bubble whereas `focus` and `blur` don't.
        element.addEventListener("focusin", handleFocusChange, true);
        element.addEventListener("focusout", handleFocusChange, true);
        return () => {
            element.removeEventListener("focusin", handleFocusChange, true);
            element.removeEventListener("focusout", handleFocusChange, true);
        };
    }, []);

    useEffect(() => {
        setContentUpdatedNoteElement(
            contentUpdatedTime ? document.getElementById(`${id}-edited`) : null,
        );
    }, [id, contentUpdatedTime]);

    // Apply a class to the content editor/view while the user is dragging from a text
    // element. This way we can change cursor styles like a file's cursor. Normally
    // files have a pointer cursor but while dragging to select text we want files
    // elements in the editor/view to inherit the text cursor. Otherwise a user may be
    // confused as to why while they're dragging the file appears to be clickable.
    //
    // IMPORTANT: The same effect (more or less) exists in `<ContentEditor>`. If you
    // make an update here you'll need to make an update there as well.
    useLayoutEffectWithoutServerSideWarning(() => {
        const element = assertExists(ref.current);

        let isPointerDownFromSelectableElement = false;
        let isPointerDownFromSelectableElementAndMoved = false;

        const handlePointerDown = (event: PointerEvent) => {
            const wasPointerDownFromSelectableElementAndMoved =
                isPointerDownFromSelectableElementAndMoved;

            isPointerDownFromSelectableElement =
                event.target instanceof Element &&
                getComputedStyle(event.target).userSelect !== "none";
            isPointerDownFromSelectableElementAndMoved = false;

            if (
                wasPointerDownFromSelectableElementAndMoved !==
                isPointerDownFromSelectableElementAndMoved
            ) {
                if (isPointerDownFromSelectableElementAndMoved) {
                    element.classList.add(contentStyles.selectionChangeDraggingClassName);
                } else {
                    element.classList.remove(contentStyles.selectionChangeDraggingClassName);
                }
            }
        };

        const handlePointerMove = () => {
            const wasPointerDownFromSelectableElementAndMoved =
                isPointerDownFromSelectableElementAndMoved;

            isPointerDownFromSelectableElementAndMoved = isPointerDownFromSelectableElement;

            if (
                wasPointerDownFromSelectableElementAndMoved !==
                isPointerDownFromSelectableElementAndMoved
            ) {
                if (isPointerDownFromSelectableElementAndMoved) {
                    element.classList.add(contentStyles.selectionChangeDraggingClassName);
                } else {
                    element.classList.remove(contentStyles.selectionChangeDraggingClassName);
                }
            }
        };

        const handleResetState = () => {
            const wasPointerDownFromSelectableElementAndMoved =
                isPointerDownFromSelectableElementAndMoved;

            isPointerDownFromSelectableElement = false;
            isPointerDownFromSelectableElementAndMoved = false;

            if (
                wasPointerDownFromSelectableElementAndMoved !==
                isPointerDownFromSelectableElementAndMoved
            ) {
                if (isPointerDownFromSelectableElementAndMoved) {
                    element.classList.add(contentStyles.selectionChangeDraggingClassName);
                } else {
                    element.classList.remove(contentStyles.selectionChangeDraggingClassName);
                }
            }
        };

        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("pointermove", handlePointerMove, true);
        document.addEventListener("pointerup", handleResetState, true);
        document.addEventListener("pointercancel", handleResetState, true);
        document.addEventListener("dragstart", handleResetState, true);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("pointermove", handlePointerMove, true);
            document.removeEventListener("pointerup", handleResetState, true);
            document.removeEventListener("pointercancel", handleResetState, true);
            document.removeEventListener("dragstart", handleResetState, true);
        };
    }, []);

    // If the user selects some text on the page then we want to highlight any
    // files within that selection. We have similar code in `<ContentEditor>`
    // that's based on decorations and ProseMirror's `EditorState`.
    useEffect(() => {
        // Recompute selected elements if the content changes. Since we may be
        // rendering a different set of files within the text selection.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        content.doc;

        const element = assertExists(ref.current);

        // TODO(calebmer): When theme is configurable we should use the configured
        // theme here instead of `defaultThemeColor`.
        const selectionFileClassName =
            contentStyles.selectionFileClassNameByColor[defaultThemeColor];

        let previousFileElements: ReadonlySet<Element> = emptySet;

        const handleSelectionChange = () => {
            const nextFileElements = getElementsWithClassNameInParentInSelection(
                element,
                fileClassName,
            );

            for (const nextFileElement of nextFileElements) {
                if (previousFileElements.has(nextFileElement)) continue;
                nextFileElement.classList.add(selectionFileClassName);
            }

            for (const previousFileElement of previousFileElements) {
                if (nextFileElements.has(previousFileElement)) continue;
                previousFileElement.classList.remove(selectionFileClassName);
            }

            previousFileElements = nextFileElements;
        };

        handleSelectionChange();

        document.addEventListener("selectionchange", handleSelectionChange);
        return () => {
            document.removeEventListener("selectionchange", handleSelectionChange);

            for (const previousFileElement of previousFileElements) {
                previousFileElement.classList.remove(selectionFileClassName);
            }

            previousFileElements = emptySet;
        };
    }, [content.doc]);

    return (
        <>
            <div
                ref={ref}
                className={classNames(
                    contentStyles.docClassName,
                    withMobileLayout ? contentStyles.withMobileLayoutDocClassName : undefined,
                    isCompact || isExtraCompact ? contentStyles.compactDocClassName : undefined,
                    isExtraCompact ? contentStyles.extraCompactDocClassName : undefined,
                    className,
                    isTitleEmpty && contentStyles.emptyTitleClassName,
                    isBodyEmpty && contentStyles.emptyBodyClassName,
                    isTruncated && contentViewStyles.truncatedClassName,
                )}
                style={
                    withUserSelectNone ? {userSelect: "none", WebkitUserSelect: "none"} : undefined
                }
                dangerouslySetInnerHTML={{__html: html}}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
            />
            {focusedLinkElement && <FocusRing targetElement={focusedLinkElement} />}
            {canPrimaryInputHover && contentUpdatedTime && contentUpdatedNoteElement && (
                <Tooltip
                    placement="bottom"
                    content={<PrettyAbsoluteDateTooltipContent date={contentUpdatedTime} />}
                    targetElement={contentUpdatedNoteElement}
                />
            )}
            {codeBlockCopyButtonTooltipState && (
                <Tooltip
                    key={codeBlockCopyButtonTooltipState.key}
                    ref={codeBlockCopyButtonTooltipRef}
                    placement="bottom"
                    isInitiallyHovered={true}
                    isVisibleAfterPress={true}
                    targetElement={codeBlockCopyButtonTooltipState.targetElement}
                    content={
                        !codeBlockCopyButtonTooltipState.wasPressed ? (
                            "Copy"
                        ) : (
                            <Box display="inline" color="grey-60">
                                Copied
                            </Box>
                        )
                    }
                    onStateChange={state => {
                        // Once the tooltip completely disappears (after fade out completes) then we
                        // can remove our tooltip state.
                        if (
                            !state.isHovered &&
                            !state.isFocused &&
                            !state.isFadingIn &&
                            !state.isFadingOut
                        ) {
                            setCodeBlockCopyButtonTooltipState(null);
                        }
                    }}
                />
            )}
            {isInitialAppRender && (
                <script
                    // We only compute this script on the server. On the client we don't bother
                    // rendering the script which allows us to avoid an extra `JSON.stringify()`
                    // call on a potentially large object.
                    suppressHydrationWarning
                    dangerouslySetInnerHTML={{
                        __html:
                            typeof window === "undefined"
                                ? `(window.__contentViewCodeBlockDecorationsById || (window.__contentViewCodeBlockDecorationsById = {}))["${id}"] = ${JSON.stringify(
                                      ContentViewCodeBlockDecorationsSchema.serialize(
                                          codeBlockDecorations,
                                      ),
                                  )};`
                                : "",
                    }}
                />
            )}
        </>
    );
}

// NOTE(calebmer, #interview): Implementing this function could make for a good
// algorithmic interview question.
function getElementsWithClassNameInParentInSelection(
    parentElement: Element,
    className: string,
): ReadonlySet<Element> {
    const selection = document.getSelection();
    if (!selection || !selection.anchorNode || !selection.focusNode || selection.isCollapsed)
        return emptySet;

    // Protect against detached elements. This also guarantees the common parent
    // of the anchor node and focus node is at least `document`.
    if (!document.contains(selection.anchorNode)) return emptySet;
    if (!document.contains(selection.focusNode)) return emptySet;

    const anchorParentNodes: Array<globalThis.Node> = [];
    const focusParentNodes: Array<globalThis.Node> = [];

    {
        let anchorParentNode: globalThis.Node | null = selection.anchorNode;
        while (anchorParentNode) {
            anchorParentNodes.push(anchorParentNode);
            anchorParentNode = anchorParentNode.parentNode;
        }
    }

    {
        let focusParentNode: globalThis.Node | null = selection.focusNode;
        while (focusParentNode) {
            focusParentNodes.push(focusParentNode);
            focusParentNode = focusParentNode.parentNode;
        }
    }

    let commonParentReverseIndex = 1;
    const minParentNodesLength = Math.min(anchorParentNodes.length, focusParentNodes.length);

    for (let reverseIndex = 1; reverseIndex <= minParentNodesLength; reverseIndex++) {
        if (
            anchorParentNodes[anchorParentNodes.length - reverseIndex] !==
            focusParentNodes[focusParentNodes.length - reverseIndex]
        ) {
            break;
        }

        commonParentReverseIndex = reverseIndex;
    }

    const commonParentNode =
        anchorParentNodes[anchorParentNodes.length - commonParentReverseIndex]!;

    // In this case, one of the following is true:
    //
    // 1. Anchor node and focus node are the same
    // 2. Anchor node contains focus node
    // 3. Focus node contains anchor node
    //
    // If anchor node and focus node are text nodes then cases 2 and 3 are
    // impossible because text nodes can't have children. And for case 1 since
    // text nodes can't have children the result of this function is an empty
    // array.
    //
    // If anchor node or focus node aren't text nodes then cases 2 and 3 are
    // ambiguous as to which direction the selection is in. Let's say in case
    // 2, are we selecting from the beginning of anchor node to focus node? Or
    // are we selecting from focus node to the end of anchor node?
    //
    // Going to assume anchor node and focus node are always text nodes for now and
    // ignore cases 2 and 3.
    if (commonParentReverseIndex === minParentNodesLength) {
        return emptySet;
    }

    const anchorCommonParentChildNode =
        anchorParentNodes[anchorParentNodes.length - (commonParentReverseIndex + 1)]!;

    const focusCommonParentChildNode =
        focusParentNodes[focusParentNodes.length - (commonParentReverseIndex + 1)]!;

    let start: "Anchor" | "Focus" | null = null;

    for (const commonParentChildNode of commonParentNode.childNodes) {
        if (commonParentChildNode === anchorCommonParentChildNode) {
            start = "Anchor";
            break;
        }

        if (commonParentChildNode === focusCommonParentChildNode) {
            start = "Focus";
            break;
        }
    }

    let startNode = start === "Anchor" ? selection.anchorNode : selection.focusNode;
    let endNode = start === "Anchor" ? selection.focusNode : selection.anchorNode;

    if (parentElement.contains(startNode)) {
        if (parentElement.contains(endNode)) {
            // Selection is entirely within parent element.
        } else {
            // Selection starts inside the parent element but ends outside of it.
            endNode = parentElement;
        }
    } else {
        if (parentElement.contains(endNode)) {
            // Selection starts outside the parent element but ends inside of it.
            startNode = parentElement;
        } else {
            const startCommonParentChildNode =
                start === "Anchor" ? anchorCommonParentChildNode : focusCommonParentChildNode;
            const endCommonParentChildNode =
                start === "Anchor" ? focusCommonParentChildNode : anchorCommonParentChildNode;

            let containsParentElement = false;
            let commonParentChildNode: globalThis.Node | null = startCommonParentChildNode;
            while (commonParentChildNode) {
                if (commonParentChildNode.contains(parentElement)) {
                    containsParentElement = true;
                }
                if (commonParentChildNode === endCommonParentChildNode) {
                    break;
                }
                commonParentChildNode = commonParentChildNode.nextSibling;
            }

            // If neither start or end node are in the parent element then either:
            //
            // 1. The selection is outside the parent element
            // 2. The selection fully encompasses the parent element and more
            //
            // In case 2 we need to return all elements matching the provided class name.
            if (!containsParentElement) {
                return emptySet;
            } else {
                return new Set(parentElement.getElementsByClassName(className));
            }
        }
    }

    const elements = new Set<Element>();

    const enter = (node: globalThis.Node): boolean => {
        if (node instanceof Element && node.classList.contains(className)) {
            elements.add(node);
        }

        for (const childNode of node.childNodes) {
            if (enter(childNode)) {
                return true;
            }
        }

        return node === endNode;
    };

    const exit = (node: globalThis.Node): boolean => {
        if (node === endNode) {
            return true;
        } else if (node.nextSibling) {
            return enterAndExit(node.nextSibling);
        } else if (node.parentNode) {
            return exit(node.parentNode);
        } else {
            return false;
        }
    };

    const enterAndExit = (node: globalThis.Node): boolean => {
        if (enter(node)) {
            return true;
        }

        return exit(node);
    };

    enterAndExit(startNode);

    return elements;
}
