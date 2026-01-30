import classNames from "classnames";
import Color from "color";
import {animate} from "motion";
import {Node} from "prosemirror-model";
import {Selection} from "prosemirror-state";
import {
    DirectEditorProps,
    EditorView,
    __serializeForClipboard as serializeForClipboard,
} from "prosemirror-view";
import {
    CSSProperties,
    Memo,
    useCallback,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {flushSync} from "react-dom";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {addContentViewLinkBehavior} from "~/client/web/content/add_content_view_link_behavior.js";
import {useContentBlockWidth} from "~/client/web/content/content_block_width.js";
import {ContentFileEntityRenderersContext} from "~/client/web/content/content_file_entity_renderers_context.js";
import {useFileRegistry} from "~/client/web/content/file_registry_context.js";
import {getContentViewLastParagraphChild} from "~/client/web/content/get_content_view_depth_to_last_paragraph_child.js";
import {getContentViewPosFromDom} from "~/client/web/content/get_content_view_pos_from_dom.js";
import {registerClipboardSerializer} from "~/client/web/content/handle_copy_event_if_not_text_input_element.js";
import {ContentEditorDomClipboardSerializer} from "~/client/web/content/internal/content_editor_dom_clipboard_serializer.js";
import {ContentEditorDomParser} from "~/client/web/content/internal/content_editor_dom_parser.js";
import {contentEditorTextClipboardSerializer} from "~/client/web/content/internal/content_editor_text_clipboard_serializer.js";
import {addContentFileEntityPreviewBehavior} from "~/client/web/content/internal/content_file_entity_preview.js";
import {addContentFilePreviewBehavior} from "~/client/web/content/internal/content_file_preview.js";
import {disableMessagingViewPointerToolbarAnimationOutUntilAfterNextAnimationFrame} from "~/client/web/content/messaging/disable_messaging_view_pointer_toolbar_animation_out_until_after_next_animation_frame.js";
import {renderContentFragmentToHtmlGeneratorStore} from "~/client/web/content/render_content_to_html.js";
import {addUnfocusableButtonBehaviorToElement} from "~/client/web/content/state/add_unfocusable_button_behavior_to_element.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {
    addParentScrollWhenPointerDownAndOverListener,
    dispatchParentScrollWhenPointerDownAndOverEvent,
    parentScrollWhenPointerDownAndOverClassNames,
    removeParentScrollWhenPointerDownAndOverListener,
} from "~/client/web/content/state/parent_scroll_when_pointer_down_and_over_event.js";
import {writeContentToClipboard} from "~/client/web/content/write_content_to_clipboard.js";
import {useAppContextIfExists} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {PrettyAbsoluteDateTooltipContent} from "~/client/web/design/pretty_absolute_date.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Tooltip, TooltipRef} from "~/client/web/design/tooltip.js";
import {getColorSchemeWithoutListeningIfBrowser} from "~/client/web/helpers/color_scheme.js";
import {isModifiedPointerEvent} from "~/client/web/helpers/events/is_modified_pointer_event.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useCanPrimaryInputHover, usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useNavigate, useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {useSpaceContextIfExists} from "~/client/web/spaces/space_context.js";
import {contentStyles, contentViewStyles, sprinkles} from "~/client/web/styles/styles.js";
import {ContentCodeBlockIncrementalParser} from "~/shared/content/code/content_code_block_incremental_parser.js";
import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import {
    ContentCodeBlockHtmlSerializationDecoration,
    createContentCodeBlockHtmlSerializationDecorationsStore,
} from "~/shared/content/code/create_content_code_block_html_serialization_decorations_store.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty.js";
import {
    codeBlockWrapperClassName,
    fileClassName,
    linkClassName,
    paragraphClassName,
} from "~/shared/design/core/constant_class_names.js";
import {easeOutCubic} from "~/shared/design/core/easing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {
    HtmlElementGenerator,
    HtmlGenerator,
    HtmlTextGenerator,
} from "~/shared/helpers/html/html_generator.js";
import {doesStringEndWithPunctuation} from "~/shared/helpers/string/does_string_end_with_punctuation.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {Id, generateId, isId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, FileId} from "~/shared/id/types/id_types.js";
import {areProsemirrorNodesEqualExceptText} from "~/shared/prosemirror/are_prosemirror_nodes_equal_except_text.js";
import {ProsemirrorHtmlSerializationDecoration} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {ConstStore, undefinedStore} from "~/shared/store/const_store.js";

export const jumpAnimationDurationMs = 3000;
const jumpAnimationFadeInDurationMs = 70;
const jumpAnimationFadeOutDurationMs = 500;
const jumpAnimationSolidDurationMs =
    jumpAnimationDurationMs - jumpAnimationFadeInDurationMs - jumpAnimationFadeOutDurationMs;

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

export type ContentViewProps<Content extends ContentWithReferences> = {
    /**
     * The content to render.
     */
    content: Content;

    /**
     * This prop puts an `(updated)` message at the end of our content with a
     * tooltip with the time the content was updated at.
     */
    contentUpdatedTime?: Date | null;

    /** Placeholder text to render when there is no other content. */
    placeholder?: string;

    /** An extra CSS class to add to the content view. */
    className?: string;

    /** Extra CSS inline styles we'll add to the content view. */
    style?: CSSProperties;

    /** An optional label to expose to assistive technology. */
    "aria-label"?: string;

    /** An optional label to expose to assistive technology. */
    "aria-labelledby"?: string;

    /**
     * Used specifically by `<MessageView>` to record the message room key in the
     * DOM. Since `<MessagingViewPointerToolbar>`'s state is based on looking at
     * the DOM to figure out what's selected.
     */
    "data-room"?: string;

    /**
     * Used specifically by `<MessageView>` to record the message index in the DOM.
     * Since `<MessagingViewPointerToolbar>`'s state is based on looking at the DOM
     * to figure out what's selected.
     */
    "data-index"?: number;

    /**
     * Offset for all `data-pos` attributes in the message. Use this if you're
     * rendering a larger piece of content by dividing it up into smaller
     * `<ContentView>` parts (for example `<MessageStreamView>`).
     */
    posAttributeOffset?: number;

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
    onSeeMoreContent?: (targetElement: HTMLDivElement) => void;

    /**
     * Adds a "See less" button which when clicked should collapse content to a
     * truncated version which a "See more" button should be able to expand (see
     * `onSeeMoreContent`).
     */
    onSeeLessContent?: (targetElement: HTMLDivElement) => void;

    /**
     * Disable the block maximum width. Letting content flow all the way to the
     * edges of the container. Used in document presentation mode for rendering
     * slides. Defaults to false.
     */
    withoutBlockMaxWidth?: boolean;

    /**
     * CSS scale transform applied to this `<ContentView>`. Scales up images when
     * provided so we load images of the appropriate pixel size.
     */
    transformScale?: number;

    /**
     * Optionally provide author information for the content we serialize to the
     * user's clipboard. When copying content from multiple different authors,
     * we'll prepend the author's name as a prefix to distinguish who wrote what.
     * If all copied content is from the same author, no prefix is added.
     */
    getClipboardSerializerAuthorPrefix?: Memo<() => AccountModel | null>;

    /**
     * Custom `isBodyEmpty` prop. We'll consider the body empty if
     * `isContentBodyEmpty()` is true or this function is true.
     */
    isBodyEmpty?: boolean;

    /**
     * Runs a jump animation on the content between these two positions.
     *
     * To support interruptible animations you should provide a `startTime`. So if
     * the `<ContentView>` is mounted/unmounted (maybe because of list
     * virtualization) the animation state is preserved.
     */
    jumpAnimation?: Memo<{from: number | null; to: number | null; startTime: Date}> | null;
};

/**
 * A read-only view of content. Used as a complement to `<ContentEditor>` when
 * you want to disable editing of content and only allow reading the content.
 */
export function ContentView<Content extends ContentWithReferences>({
    content,
    contentUpdatedTime,
    placeholder,
    className,
    style,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "data-room": dataRoom,
    "data-index": dataIndex,
    posAttributeOffset = 0,
    isInert = false,
    fileAttachmentTarget,
    shouldHighlightComment,
    withUserSelectNone = false,
    onSeeMoreContent,
    onSeeLessContent,
    withoutBlockMaxWidth = false,
    transformScale = 1,
    getClipboardSerializerAuthorPrefix,
    isBodyEmpty: isBodyEmptyFromProps = false,
    jumpAnimation = null,
}: ContentViewProps<Content>) {
    assert(
        !content.doc.type.schema.nodes.file || fileAttachmentTarget,
        "ProseMirror schema supports files but `fileAttachmentTarget` prop isn\u2019t provided",
    );

    const rootNavigate = useRootNavigate();
    const navigate = useNavigate();
    const clientInfo = useClientInfo();
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const isInitialAppRender = useIsInitialAppRender();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const accountRegistry = useAccountRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();
    const fileRegistry = useFileRegistry();
    const reporter = useReporter();
    const fileEntityRenderers = useContext(ContentFileEntityRenderersContext);
    const currentDate = useCurrentDate();

    // Don't get the current account when running in a unit test so we don't need
    // to render a space context when testing this component.
    const context = useAppContextIfExists();
    const spaceContext = useSpaceContextIfExists();
    const spaceId = spaceContext?.space.id ?? null;

    const blockWidth = useContentBlockWidth(
        withoutBlockMaxWidth || transformScale !== 1
            ? {withoutMaxWidth: withoutBlockMaxWidth, transformScale}
            : undefined,
    );

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
        getContent: () => content,
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

        // If this is the initial render of a `<ContentEditor>` then store the initial
        // decorations so when we swap with `<ContentEditor>` we have the decorations
        // ready to go.
        if (isInitialAppRender && decorations.length > 0) {
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

    const {isTitleEmpty, isBodyEmpty, htmlGeneratorStore} = useMemo(() => {
        const decorations: Array<ProsemirrorHtmlSerializationDecoration> = [];

        if (contentUpdatedTime) {
            const result = getContentViewLastParagraphChild(content.doc);

            let html: HtmlElementGenerator;
            if (result !== null) {
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
                pos: content.doc.nodeSize - ((result?.depth ?? 0) + 1),
                html,
            });
        }

        if (shouldShowSeeMoreContentButton || shouldShowSeeLessContentButton) {
            const result = shouldShowSeeLessContentButton
                ? // Always render "See less" on its own line. Don't put it inline with the last
                  // paragraph.
                  null
                : getContentViewLastParagraphChild(content.doc);

            const buttonText = shouldShowSeeLessContentButton ? "See less" : "See more";

            let html: HtmlElementGenerator;
            if (result !== null) {
                const shouldAddEllipsis =
                    result.node.childCount > 0 &&
                    !doesStringEndWithPunctuation(result.node.lastChild!.text!);

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
                pos: content.doc.nodeSize - ((result?.depth ?? 0) + 1),
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

        if (jumpAnimation !== null) {
            decorations.push({
                type: "Inline",
                from: jumpAnimation.from ?? 0,
                to: jumpAnimation.to ?? content.doc.content.size,
                attrs: {
                    nodeName: "mark",
                    class: contentStyles.jumpAnimationClassName,
                },
            });
        }

        // If we have some initial code block decorations from server-side rendering
        // then use those instead of trying to compute new decorations. Since we
        // may not be able to compute new decorations given no language parsers will be
        // loaded on initial render.
        const codeBlockDecorationsStore =
            initialCodeBlockDecorations === null
                ? createContentCodeBlockHtmlSerializationDecorationsStore(content.doc)
                : new ConstStore(initialCodeBlockDecorations);

        if (initialCodeBlockDecorations !== null) {
            content.doc.forEach(node => {
                // Currently, code blocks may only be a direct child of `doc`.
                if (node.type.name !== "codeBlock") return;

                const languageId: ContentCodeBlockLanguageId = node.attrs.language ?? "text";
                const language = contentCodeBlockLanguageById[languageId];

                // Preload code block languages while we're using initial code block
                // decorations so we're ready for a re-render.
                language.getParser();
            });
        }

        const htmlGeneratorStore = computeStore(get => {
            let suppressHydrationWarning = false;

            const codeBlockDecorations = get(codeBlockDecorationsStore);

            const htmlGenerator = renderContentFragmentToHtmlGeneratorStore(get, content, {
                getContext: () => assertExists(context),
                clientInfo,
                spaceId,
                accountRegistry,
                searchEntityRegistry,
                fileRegistry,
                currentAccount: spaceContext?.currentAccount ?? null,
                blockWidth,
                transformScale,
                platform,
                spacingScale,
                routeLayout,
                isInitialAppRender,
                currentDate,
                fileEntityRenderers,
                isInert,
                withPosAttribute: true,
                posAttributeOffset,
                placeholder,
                decorations: [decorations, codeBlockDecorations],
                shouldHighlightComment,
                suppressHydrationWarning: () => {
                    suppressHydrationWarning = true;
                },
            });

            return {
                htmlGenerator,
                codeBlockDecorations: codeBlockDecorations,
                suppressHydrationWarning,
            };
        });

        return {
            isTitleEmpty: isContentTitleEmpty(content.doc),
            isBodyEmpty: isContentBodyEmpty(content.doc) || isBodyEmptyFromProps,
            htmlGeneratorStore,
        };
    }, [
        contentUpdatedTime,
        shouldShowSeeMoreContentButton,
        shouldShowSeeLessContentButton,
        content,
        jumpAnimation,
        initialCodeBlockDecorations,
        isBodyEmptyFromProps,
        id,
        clientInfo,
        spaceId,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
        spaceContext?.currentAccount,
        blockWidth,
        transformScale,
        platform,
        spacingScale,
        routeLayout,
        isInitialAppRender,
        currentDate,
        fileEntityRenderers,
        isInert,
        posAttributeOffset,
        placeholder,
        shouldHighlightComment,
        context,
    ]);

    const {htmlGenerator, codeBlockDecorations, suppressHydrationWarning} =
        useStore(htmlGeneratorStore);

    const previousContentDocRef = useRef<Node>(content.doc);
    const previousHtmlGeneratorRef = useRef<HtmlGenerator | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        const element = assertExists(ref.current);

        const previousContentDoc = previousContentDocRef.current;
        previousContentDocRef.current = content.doc;
        const previousHtmlGenerator = previousHtmlGeneratorRef.current;
        previousHtmlGeneratorRef.current = htmlGenerator;

        if (previousHtmlGenerator === htmlGenerator) return;

        const selection = window.getSelection();

        const oldAnchorPos =
            selection?.anchorNode && element.contains(selection.anchorNode)
                ? getContentViewPosFromDom(element, selection.anchorNode, selection.anchorOffset)
                : null;

        const oldFocusPos =
            selection?.focusNode && element.contains(selection.focusNode)
                ? getContentViewPosFromDom(element, selection.focusNode, selection.focusOffset)
                : null;

        if (
            !previousHtmlGenerator ||
            // Force the content HTML to be re-created if the structure of `content.doc`
            // changes between renders. If content changes dramatically then `patchNode()`
            // has some limitations (e.g. doesn't handle children insertion, removal, and
            // re-ordering well). For all other changes try patching our HTML.
            //
            // Ideally we'd always use `patchNode()` to update the DOM so we don't destroy
            // and re-create DOM nodes if we don't have to but we can't trust our
            // implementation of `patchNode()` at the moment.
            !areProsemirrorNodesEqualExceptText(previousContentDoc, content.doc)
        ) {
            // This case happens during a hot reload. We need to remove the children
            // currently in the DOM.
            while (element.hasChildNodes()) {
                element.firstChild!.remove();
            }

            element.appendChild(htmlGenerator.generateNode());
        } else {
            assert(htmlGenerator.patchNode(previousHtmlGenerator, element));
        }

        const newAnchorPos =
            selection?.anchorNode && element.contains(selection.anchorNode)
                ? getContentViewPosFromDom(element, selection.anchorNode, selection.anchorOffset)
                : null;

        const newFocusPos =
            selection?.focusNode && element.contains(selection.focusNode)
                ? getContentViewPosFromDom(element, selection.focusNode, selection.focusOffset)
                : null;

        // HACK: If re-rendering our `<ContentView>` changes the selection then clear
        // the selection. Ideally instead we'd find the correct position for the
        // selection in the new DOM and set the selection to the new position. However,
        // we don't have a utility to turn a ProseMirror `pos` into a DOM position
        // right now. We currently have `getContentViewPosFromDom()` but we'd also need
        // `getDomFromContentViewPos()`.
        //
        // If you're fixing this hack, please also consider
        // `<ContentViewWithReactionParties>`. Since the story gets a little more
        // complicated there. When adding a reaction one `<ContentView>` may be split
        // into two `<ContentView>`s! So we need to move `newAnchorPos` into a
        // different component entirely.
        //
        // Examples where this happens:
        //
        // - A `jumpAnimation` is running and you have a selection in the highlighted
        //   text (or in text in an adjacent node to the highlighted text).
        //
        // - You have a selection in a paragraph and another user adds a reaction to
        //   the message in the paragraph above in realtime causing
        //   `<ContentViewWithReactionParties>` to render and your `<ContentView>`s to
        //   split apart.
        if (oldAnchorPos !== newAnchorPos || oldFocusPos !== newFocusPos) {
            disableMessagingViewPointerToolbarAnimationOutUntilAfterNextAnimationFrame();
            window.getSelection()?.removeAllRanges();
        }
    }, [content.doc, htmlGenerator, isInitialAppRender]);

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
        (platform === "mobile" ||
            !document.body.contains(codeBlockCopyButtonTooltipState.targetElement))
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

    // Some behaviors in this function depend on this effect being a layout effect.
    // For example, on initial render when `<ContentEditor>` transitions from
    // `<ContentView>` to ProseMirror's `EditorView` we must run
    // `addContentFilePreviewBehavior()` `<ContentView>` cleanups before the
    // `EditorView` is initialized. This only happens if
    // `addContentFilePreviewBehavior()` is in a layout effect.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        // Re-run this effect whenever the content changes.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        content.doc;

        const parentElement = assertExists(ref.current);

        const cleanupFunctions: Array<() => void> = [];

        const classNames = [
            linkClassName,
            contentViewStyles.seeButtonClassName,
            contentStyles.codeBlockCopyButtonClassName,
            fileClassName,
            contentStyles.mentionContainerClassName,
        ];

        if (jumpAnimation !== null) {
            classNames.push(contentStyles.jumpAnimationClassName);
        }

        for (const element of parentElement.querySelectorAll(
            classNames
                // Find all elements with the provided class names and exclude elements that
                // are children of a file node. File entities may recursively render content
                // (e.g. document file entities). The content within file entities is inert
                // so shouldn't get any interactive behaviors.
                .map(className => `.${className}:not(.${fileClassName} .${className})`)
                .join(", "),
        )) {
            if (!(element instanceof HTMLElement)) continue;

            if (
                !isInert &&
                (element.classList.contains(linkClassName) ||
                    element.classList.contains(contentStyles.mentionContainerClassName)) &&
                element instanceof HTMLAnchorElement
            ) {
                cleanupFunctions.push(addContentViewLinkBehavior(element, navigate));
            }

            if (!isInert && element.classList.contains(contentViewStyles.seeButtonClassName)) {
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
                        events.onSeeLessContent(assertExists(ref.current));
                    } else if (shouldShowSeeMoreContentButton) {
                        events.onSeeMoreContent(assertExists(ref.current));
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

                const handleParentScrollWhenPointerDownAndOver = () => {
                    isPointerDownAndOver = false;
                    maybeUpdateStyle();
                };

                element.addEventListener("click", handleClick);
                element.addEventListener("pointerdown", handlePointerDown);
                element.addEventListener("pointerup", handlePointerUp);
                element.addEventListener("pointerleave", handlePointerLeave);
                element.addEventListener("dragstart", handleDragStart);
                addParentScrollWhenPointerDownAndOverListener(
                    element,
                    handleParentScrollWhenPointerDownAndOver,
                );

                cleanupFunctions.push(() => {
                    element.removeEventListener("click", handleClick);
                    element.removeEventListener("pointerdown", handlePointerDown);
                    element.removeEventListener("pointerup", handlePointerUp);
                    element.removeEventListener("pointerleave", handlePointerLeave);
                    element.removeEventListener("dragstart", handleDragStart);
                });
                removeParentScrollWhenPointerDownAndOverListener(
                    element,
                    handleParentScrollWhenPointerDownAndOver,
                );
            }

            if (
                !isInert &&
                element.classList.contains(contentStyles.codeBlockCopyButtonClassName)
            ) {
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
                        const posString = element.closest<HTMLElement>(
                            `.${codeBlockWrapperClassName}`,
                        )?.dataset.pos;
                        assert(posString);
                        const pos = parseInt(posString, 10) - posAttributeOffset;
                        assert(!isNaN(pos));

                        const $pos = content.doc.resolve(pos);
                        const node = assertExists($pos.nodeAfter);
                        assert(node.type.name === "codeBlock");

                        writeContentToClipboard(
                            assertExists(spaceContext).space.id,
                            content,
                            fileAttachmentTarget ?? null,
                            content.doc.slice(pos, pos + node.nodeSize),
                        ).catch(error => {
                            reporter.displayError("Couldn\u2019t copy code", error);
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
                const pos = parseInt(posString, 10) - posAttributeOffset;
                assert(!isNaN(pos));

                const $pos = content.doc.resolve(pos);
                assert($pos.nodeAfter?.type.name === "file");
                const node = $pos.nodeAfter;

                const fileId: FileId | FileEntityId | null = node.attrs.fileId;
                const isFileEntity = fileId && !isId<FileId>(fileId);

                const fileReference =
                    fileId && !isFileEntity ? content.references.fileById?.get(fileId) : undefined;

                const fileEntityResult = isFileEntity
                    ? content.references.fileEntityById?.get(fileId)
                    : undefined;

                if (isFileEntity) {
                    const cleanupBehavior = addContentFileEntityPreviewBehavior(
                        () => assertExists(context),
                        element,
                        {
                            spaceId: assertExists(spaceContext).space.id,
                            fileEntityId: fileId,
                            fileEntityResult,
                            fileEntityRenderers,
                            navigate,
                            getReporter: () => reporter,
                            isInert,
                        },
                    );

                    cleanupFunctions.push(cleanupBehavior);
                } else {
                    const actualFileStore = fileReference
                        ? fileRegistry.getFileStore(fileReference)
                        : undefinedStore;

                    let cleanupBehavior: (() => void) | null = null;

                    const update = () => {
                        cleanupBehavior?.();
                        cleanupBehavior = null;

                        cleanupBehavior = addContentFilePreviewBehavior(
                            () => assertExists(context),
                            element,
                            {
                                spaceId: assertExists(spaceContext).space.id,
                                file: actualFileStore.getSnapshot(),
                                attachmentTarget: assertExists(fileAttachmentTarget),
                                isInert,
                                rootNavigate,
                                getReporter: () => reporter,
                            },
                        );
                    };

                    const unsubscribeFromStore = actualFileStore.subscribe(update);
                    update();

                    cleanupFunctions.push(() => {
                        unsubscribeFromStore();
                        cleanupBehavior?.();
                        cleanupBehavior = null;
                    });
                }
            }

            if (
                jumpAnimation !== null &&
                element.classList.contains(contentStyles.jumpAnimationClassName)
            ) {
                const colorScheme = assertExists(getColorSchemeWithoutListeningIfBrowser());

                const backgroundColor = contentStyles.jumpAnimationBackgroundColor[colorScheme];

                const transparentBackgroundColor = Color(backgroundColor).alpha(0).hexa();

                const animation = animate([
                    [element, {backgroundColor: transparentBackgroundColor}, {duration: 0}],
                    [
                        element,
                        {backgroundColor},
                        {duration: jumpAnimationFadeInDurationMs / 1000, ease: "linear"},
                    ],
                    [element, {backgroundColor}, {duration: jumpAnimationSolidDurationMs / 1000}],
                    [
                        element,
                        {backgroundColor: transparentBackgroundColor},
                        {
                            duration: jumpAnimationFadeOutDurationMs / 1000,
                            ease: easeOutCubic,
                        },
                    ],
                ]);

                // Synchronize all animations based on the provided `startTime`.
                animation.time = (Date.now() - jumpAnimation.startTime.getTime()) / 1000;
            }
        }

        return () => {
            for (const cleanup of cleanupFunctions) {
                cleanup();
            }
        };
    }, [
        events,
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
        context,
        fileAttachmentTarget,
        rootNavigate,
        isInitialAppRender,
        fileRegistry,
        fileEntityRenderers,
        jumpAnimation,
        posAttributeOffset,
    ]);

    // Watch all parent elements of our content view for scroll events. When a
    // scroll event occurs we want to call
    // `dispatchParentScrollWhenPointerDownAndOverEvent()` on any pressable
    // elements.
    //
    // This replicates the behavior in `@react-aria/interactions` where a press is
    // cancelled when a parent element scrolls. This behavior is important for
    // mobile since the user must press somewhere on the screen to scroll. Normally
    // `pointercancel` should be dispatched when the user scrolls while pressing on
    // some element but when the CSS `touch-action: manipulation` is set the press
    // is not cancelled.
    //
    // We can't add listeners to parent scroll elements in our link/mark view code
    // because ProseMirror does not offer us a cleanup hook for mark views! So we
    // add listeners at this level and call
    // `dispatchParentScrollWhenPointerDownAndOverEvent()`.
    //
    // IMPORTANT: This is based off of code in `<ContentEditor>`. While this is
    // necessary for `<ContentEditor>` because custom mark views don't get a
    // cleanup handler it's not necessary here since we add behavior for our mark
    // views in an effect which has a cleanup function. Though since we have
    // reusable behavior code across custom mark/node views in `<ContentEditor>`
    // and here (e.g. `addContentFilePreviewBehavior()`) it's useful to standardize
    // this behavior across `<ContentEditor>` and `<ContentView>`.
    useLayoutEffectWithoutServerSideWarning(() => {
        const element = assertExists(ref.current);

        let isPointerDownAndOverParentScrollReceiver = false;

        const handlePointerDown = (event: PointerEvent) => {
            let hasPointerDownAndOverParentScrollReceiverParent = false;

            {
                let parentElement: HTMLElement | null = event.target as HTMLElement;
                while (parentElement) {
                    if (
                        parentScrollWhenPointerDownAndOverClassNames.some(className =>
                            parentElement!.classList.contains(className),
                        )
                    ) {
                        hasPointerDownAndOverParentScrollReceiverParent = true;
                        break;
                    }

                    parentElement =
                        parentElement.parentElement !== element
                            ? parentElement.parentElement
                            : null;
                }
            }

            isPointerDownAndOverParentScrollReceiver =
                hasPointerDownAndOverParentScrollReceiverParent;
        };

        const handlePointerUp = () => {
            isPointerDownAndOverParentScrollReceiver = false;
        };

        const handlePointerLeave = () => {
            isPointerDownAndOverParentScrollReceiver = false;
        };

        const handlePointerCancel = () => {
            isPointerDownAndOverParentScrollReceiver = false;
        };

        const handleDragStart = () => {
            isPointerDownAndOverParentScrollReceiver = false;
        };

        element.addEventListener("pointerdown", handlePointerDown);
        element.addEventListener("pointerup", handlePointerUp);
        element.addEventListener("pointerleave", handlePointerLeave);
        element.addEventListener("pointercancel", handlePointerCancel);
        element.addEventListener("dragstart", handleDragStart);

        const handleScroll = () => {
            if (!isPointerDownAndOverParentScrollReceiver) return;
            isPointerDownAndOverParentScrollReceiver = false;

            for (const childElement of element.querySelectorAll(
                parentScrollWhenPointerDownAndOverClassNames
                    // Find all elements with the provided class names and exclude elements that
                    // are children of a file node. File entities may recursively render content
                    // (e.g. document file entities). The content within file entities is inert
                    // so shouldn't get any interactive behaviors.
                    .map(className => `.${className}:not(.${fileClassName} .${className})`)
                    .join(", "),
            )) {
                dispatchParentScrollWhenPointerDownAndOverEvent(childElement);
            }
        };

        const scrollEventTargets: Array<EventTarget> = [window];

        {
            let parentElement = element.parentElement;
            while (parentElement) {
                const {overflowX, overflowY} = getComputedStyle(parentElement);

                if (
                    overflowX === "auto" ||
                    overflowX === "scroll" ||
                    overflowY === "auto" ||
                    overflowY === "scroll"
                ) {
                    scrollEventTargets.push(parentElement);
                }

                parentElement =
                    parentElement.parentElement !== document.body
                        ? parentElement.parentElement
                        : null;
            }
        }

        for (const scrollEventTarget of scrollEventTargets) {
            scrollEventTarget.addEventListener("scroll", handleScroll, true);
        }

        return () => {
            element.removeEventListener("pointerdown", handlePointerDown);
            element.removeEventListener("pointerup", handlePointerUp);
            element.removeEventListener("pointerleave", handlePointerLeave);
            element.removeEventListener("pointercancel", handlePointerCancel);
            element.removeEventListener("dragstart", handleDragStart);

            for (const scrollEventTarget of scrollEventTargets) {
                scrollEventTarget.removeEventListener("scroll", handleScroll, true);
            }
        };
    }, []);

    useLayoutEffectWithoutServerSideWarning(() => {
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
                (getComputedStyle(event.target).userSelect ||
                    // In Safari `user-select` is behind a vendor prefix.
                    getComputedStyle(event.target).webkitUserSelect) !== "none";
            isPointerDownFromSelectableElementAndMoved = false;

            if (
                wasPointerDownFromSelectableElementAndMoved !==
                isPointerDownFromSelectableElementAndMoved
            ) {
                if (isPointerDownFromSelectableElementAndMoved) {
                    element.classList.add(contentStyles.isDraggingSelectionDocClassName);
                } else {
                    element.classList.remove(contentStyles.isDraggingSelectionDocClassName);
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
                    element.classList.add(contentStyles.isDraggingSelectionDocClassName);
                } else {
                    element.classList.remove(contentStyles.isDraggingSelectionDocClassName);
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
                    element.classList.add(contentStyles.isDraggingSelectionDocClassName);
                } else {
                    element.classList.remove(contentStyles.isDraggingSelectionDocClassName);
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

    useLayoutEffectWithoutServerSideWarning(() => {
        const element = assertExists(ref.current);

        return registerClipboardSerializer(
            element,
            ({startNode, startOffset, endNode, endOffset}) => {
                const content = events.getContent();

                const startPos = !element.contains(startNode)
                    ? 0
                    : Math.max(
                          0,
                          assertExists(
                              getContentViewPosFromDom(element, startNode, startOffset, {
                                  posAttributeOffset,
                              })?.[0],
                          ),
                      );

                const endPos = !element.contains(endNode)
                    ? content.doc.nodeSize - 2
                    : Math.min(
                          content.doc.nodeSize - 2,
                          assertExists(
                              getContentViewPosFromDom(element, endNode, endOffset, {
                                  posAttributeOffset,
                              })?.[1],
                          ),
                      );

                const slice = content.doc.slice(startPos, endPos, true);

                const state = ContentEditorState.create(content)._getInternalState();
                const {schema} = state.doc.type;

                const viewProps: DirectEditorProps = {
                    state,
                    domParser: ContentEditorDomParser.fromSchema(schema),
                    clipboardSerializer:
                        ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
                            schema,
                            () => assertExists(spaceId),
                            () => content.references,
                            () => assertExists(fileAttachmentTarget),
                        ),
                    clipboardTextSerializer: slice =>
                        contentEditorTextClipboardSerializer(
                            slice,
                            () => assertExists(spaceId),
                            () => content.references,
                        ),

                    // NOTE(imjoshin): Don't cause rerendered when doc attributes change
                    ignoreDocAttrsForUpdate: true,
                };

                const view = new EditorView(null, viewProps);

                const {dom, text} = serializeForClipboard(view, slice);

                let html: globalThis.Node = dom;

                // If the clipboard content was wrapped in a `<div>` with no identifying
                // characteristics then let's unwrap the wrapper `<div>` so it won't be
                // included in the copied output.
                if (
                    html instanceof Element &&
                    html.tagName === "DIV" &&
                    !html.hasAttribute("class") &&
                    !html.hasAttribute("style")
                ) {
                    const htmlFragment = document.createDocumentFragment();
                    while (dom.firstChild) {
                        htmlFragment.appendChild(dom.firstChild);
                    }
                    html = htmlFragment;
                }

                // Get the author for this content. Only include author if we're copying
                // from the start of the content (so the author info applies to the
                // entire copied content, not just a partial selection).
                const authorPrefixAccount =
                    getClipboardSerializerAuthorPrefix &&
                    startPos <= Selection.atStart(content.doc).from
                        ? getClipboardSerializerAuthorPrefix()
                        : null;

                return {
                    requiredLineBreakAroundCount: 2,
                    text,
                    html,
                    authorPrefix:
                        spaceId && authorPrefixAccount
                            ? {spaceId, account: authorPrefixAccount}
                            : undefined,
                };
            },
        );
    }, [
        events,
        fileAttachmentTarget,
        getClipboardSerializerAuthorPrefix,
        posAttributeOffset,
        spaceId,
    ]);

    return (
        <>
            <div
                ref={ref}
                className={classNames(
                    contentStyles.docClassName,
                    routeLayout === "narrow"
                        ? contentStyles.narrowRouteLayoutDocClassName
                        : undefined,
                    withoutBlockMaxWidth && contentStyles.withoutBlockMaxWidthDocClassName,
                    withUserSelectNone && contentStyles.withUserSelectNoneDocClassName,
                    className,
                    isTitleEmpty && contentStyles.emptyTitleClassName,
                    isBodyEmpty && contentStyles.emptyBodyClassName,
                )}
                style={style}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                // Optimization: These are only needed by `<MessagingViewPointerToolbar>` on
                // desktop clients after server-side render. So reduce the server response size
                // by not including these properties on initial render.
                data-room={platform !== "mobile" && !isInitialAppRender ? dataRoom : undefined}
                data-index={platform !== "mobile" && !isInitialAppRender ? dataIndex : undefined}
                dangerouslySetInnerHTML={
                    isInitialAppRender ? {__html: htmlGenerator.generateHtml()} : undefined
                }
                // If our content HTML renderer called `suppressHydrationWarning` then pass the
                // prop into React to suppress hydration warnings (e.g. blobs need to suppress
                // hydration warnings because there's a `<script>` which adds a `style` prop to
                // blobs).
                //
                // Don't suppress hydration warnings all the time, they're useful for detecting
                // errors!
                suppressHydrationWarning={suppressHydrationWarning}
            />
            {focusedLinkElement && <FocusRing targetElement={focusedLinkElement} />}
            {canPrimaryInputHover && contentUpdatedTime && contentUpdatedNoteElement && (
                <Tooltip
                    placement="bottom"
                    content={
                        <>
                            Edited{" "}
                            <PrettyAbsoluteDateTooltipContent
                                date={contentUpdatedTime}
                                withoutWeekday={true}
                            />
                        </>
                    }
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
            {isInitialAppRender && codeBlockDecorations.length > 0 && (
                <script
                    // We only compute this script on the server. On the client we don't bother
                    // rendering the script which allows us to avoid an extra `JSON.stringify()`
                    // call on a potentially large object.
                    suppressHydrationWarning
                    dangerouslySetInnerHTML={{
                        __html:
                            typeof window === "undefined"
                                ? // eslint-disable-next-line string-quotes
                                  `(window.__contentViewCodeBlockDecorationsById || (window.__contentViewCodeBlockDecorationsById = {}))["${id}"] = ${JSON.stringify(
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
