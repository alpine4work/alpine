import classNames from "classnames";
import {Node} from "prosemirror-model";
import {Memo, useCallback, useEffect, useId, useMemo, useRef, useState} from "react";
import {flushSync} from "react-dom";
import {useAccountClientStore} from "~/client/accounts/account_client_store_context_provider.js";
import {ContentCodeBlockIncrementalParser} from "~/client/content/code/content_code_block_incremental_parser.js";
import {contentCodeBlockLanguageById} from "~/client/content/code/content_code_block_language.js";
import {
    ContentCodeBlockHtmlSerializationDecoration,
    createContentCodeBlockHtmlSerializationDecorationsStore,
} from "~/client/content/code/create_content_code_block_html_serialization_decorations_store.js";
import {addUnfocusableButtonBehaviorToElement} from "~/client/content/internal/content_editor_code_block_node_view.js";
import {handleContentLinkClick} from "~/client/content/internal/handle_content_link_click.js";
import {renderContentFragmentToHtmlStore} from "~/client/content/render_content_to_html.js";
import {writeContentToClipboard} from "~/client/content/write_content_to_clipboard.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {PrettyAbsoluteDateTooltipContent} from "~/client/design/pretty_absolute_date.js";
import {useReporter} from "~/client/design/reporter.js";
import {Tooltip, TooltipRef} from "~/client/design/tooltip.js";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {useCanPrimaryInputHover, useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContextIfExists} from "~/client/spaces/space_context.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty.js";
import {isTextEndedWithPunctuation} from "~/shared/content/print_content_single_line_text_snippet.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {Id, generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {ProsemirrorHtmlSerializationDecoration} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema.js";
import {contentSchemaStyles, contentViewStyles, sprinkles} from "~/shared/styles/styles.js";

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
export function ContentView({
    withMobileLayout,
    content,
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
    shouldHighlightComment,
    withUserSelectNone = false,
    onSeeMoreContent,
    onSeeLessContent,
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
}) {
    const isMobile = useIsMobile();
    const isInitialAppRender = useIsInitialAppRender();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const accountStore = useAccountClientStore();
    const reporter = useReporter();

    // Don't get the current account when running in a unit test so we don't need
    // to render a space context when testing this component.
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
                updatedNoteContainerHtml.setAttribute(
                    "class",
                    contentSchemaStyles.paragraphClassName,
                );

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
                seeButtonContainerHtml.setAttribute(
                    "class",
                    contentSchemaStyles.paragraphClassName,
                );

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
                        class: contentSchemaStyles.emojiClassName,
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
                    accountStore,
                    currentAccount: spaceContext?.currentAccount ?? null,
                    placeholder,
                    isInert,
                    decorations: [decorations, codeBlockDecorations],
                    shouldHighlightComment,
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
                accountStore,
                currentAccount: spaceContext?.currentAccount ?? null,
                placeholder,
                isInert,
                decorations: [decorations, initialCodeBlockDecorations],
                shouldHighlightComment,
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
        accountStore,
        spaceContext?.currentAccount,
        placeholder,
        isInert,
        shouldHighlightComment,
        id,
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
        if (isInert) return;

        // Re-run this effect whenever the HTML changes.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        html;

        const parentElement = assertExists(ref.current);

        const cleanupFunctions: Array<() => void> = [];

        for (const element of parentElement.querySelectorAll(
            `.${contentSchemaStyles.linkClassName}, .${contentViewStyles.seeButtonClassName}, .${contentSchemaStyles.codeBlockCopyButtonClassName}`,
        )) {
            if (!(element instanceof HTMLElement)) continue;

            if (
                element.classList.contains(contentSchemaStyles.linkClassName) &&
                element instanceof HTMLAnchorElement
            ) {
                let isPointerDownAndOver = false;

                const maybeUpdateStyle = () => {
                    if (isPointerDownAndOver) {
                        element.classList.add(contentSchemaStyles.linkPressedClassName);
                    } else {
                        element.classList.remove(contentSchemaStyles.linkPressedClassName);
                    }
                };

                const handleClick = (event: MouseEvent) => {
                    const isOpenLinkInSeparateTabEvent = isOpenLinkInSeparateTabPointerEvent(
                        event,
                        getClientInfoWithoutListening(),
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
                            isOpenLinkInSeparateTabPointerEvent(
                                event,
                                getClientInfoWithoutListening(),
                            ));

                    maybeUpdateStyle();

                    // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
                    // modifier. Unless the click was meant to open the link in a separate tab. We
                    // need to implement that manually here given the text is editable.
                    if (
                        (event.button !== 0 || isModifiedPointerEvent(event)) &&
                        !isOpenLinkInSeparateTabPointerEvent(event, getClientInfoWithoutListening())
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

            if (element.classList.contains(contentSchemaStyles.codeBlockCopyButtonClassName)) {
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
                    focusedElement?.classList.contains(contentSchemaStyles.linkClassName)
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

    return (
        <>
            <div
                ref={ref}
                className={classNames(
                    contentSchemaStyles.docClassName,
                    withMobileLayout ? contentSchemaStyles.withMobileLayoutDocClassName : undefined,
                    isCompact || isExtraCompact
                        ? contentSchemaStyles.compactDocClassName
                        : undefined,
                    isExtraCompact ? contentSchemaStyles.extraCompactDocClassName : undefined,
                    className,
                    isTitleEmpty && contentSchemaStyles.emptyTitleClassName,
                    isBodyEmpty && contentSchemaStyles.emptyBodyClassName,
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
