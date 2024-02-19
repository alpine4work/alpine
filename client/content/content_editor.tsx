import {Modality, getInteractionModality, setInteractionModality} from "@react-aria/interactions";
import classNames from "classnames";
import {history, redoDepth, undoDepth} from "prosemirror-history";
import {Node, Slice} from "prosemirror-model";
import {
    AllSelection,
    Command,
    EditorState,
    PluginKey,
    Selection,
    TextSelection,
    Transaction,
} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {
    FocusEvent,
    PropsWithoutRef,
    ReactElement,
    Ref,
    RefAttributes,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useInsertionEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import {flushSync} from "react-dom";
import {getAccountClientStoreForClient} from "~/client/accounts/account_client_store_context_provider.js";
import {
    ContentEditorState,
    getContentEditorFloaterState,
    setContentEditorFloaterState,
} from "~/client/content/content_editor_state.js";
import {ContentView} from "~/client/content/content_view.js";
import {createContentEditorCheckListItemNodeView} from "~/client/content/internal/content_editor_check_list_item_node_view.js";
import {createContentEditorCommentMarkViewConstructor} from "~/client/content/internal/content_editor_comment_mark_view.js";
import {ContentEditorDomClipboardSerializer} from "~/client/content/internal/content_editor_dom_clipboard_serializer.js";
import {ContentEditorDomParser} from "~/client/content/internal/content_editor_dom_parser.js";
import {ContentEditorFloater} from "~/client/content/internal/content_editor_floater.js";
import {createContentEditorLinkMarkViewConstructor} from "~/client/content/internal/content_editor_link_mark_view.js";
import {createContentEditorMentionNodeViewConstructor} from "~/client/content/internal/content_editor_mention_node_view.js";
import {createContentEditorOrderedListItemNodeView} from "~/client/content/internal/content_editor_ordered_list_item_node_view.js";
import {ContentEditorPhantomSelectionCursor} from "~/client/content/internal/content_editor_phantom_selection_cursor.js";
import {contentEditorTextClipboardSerializer} from "~/client/content/internal/content_editor_text_clipboard_serializer.js";
import {useContentEditorDebugTools} from "~/client/content/internal/use_content_editor_debug_tools.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {isElementOwnedBy} from "~/client/helpers/elements/is_element_owned_by.js";
import {isVirtualKeyboardEvent} from "~/client/helpers/events/is_virtual_keyboard_event.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {useExpensivelyPreloadAllSpaceAccounts} from "~/client/spaces/use_expensively_load_all_space_accounts.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty.js";
import {ThemeColor} from "~/shared/design/theme_colors.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";
import {
    colorSchemeVars,
    contentEditorStyles,
    contentSchemaStyles,
    emojiFontFamily,
} from "~/shared/styles/styles.js";

const {docClassName, emptyBodyClassName, emptyTitleClassName} = contentSchemaStyles;

const {
    containerClassName,
    inlineElementPaddingToLineHeightClassName,
    shiftKeyOrAltKeyDownClassName,
    inlineMentionInputClassName,
} = contentEditorStyles;

// TODO(calebmer): Implement touch toolbar for mobile.

function wrap<Content extends ContentWithReferences>(
    state: EditorState,
): ContentEditorState<Content> {
    // @ts-expect-error it's ok to wrap/unwrap editor state in this file.
    return new ContentEditorState(state);
}

function unwrap(
    state: ContentEditorState<ContentWithReferences>,
): EditorState & {schema: ContentProsemirrorSchema} {
    // @ts-expect-error it's ok to wrap/unwrap editor state in this file.
    return state._state;
}

const historyPluginKey = new Lazy((): PluginKey => {
    const plugin = history();
    return (plugin as any).key;
});

// TODO(calebmer): Make content editor SSR safe by rendering it as read-only on
// the server and mounting as editable on the client after hydration.

export type ContentEditorRef = {
    isFocused(): boolean;
    focus(options?: FocusOptions): void;
    blur(): void;

    /**
     * Select all content in the editor.
     */
    selectAll(): void;

    /**
     * Get the coordinates of the provided position. Directly calls
     * [`EditorView.coordsAtPos()`][1].
     *
     * [1]: https://prosemirror.net/docs/ref/#view.EditorView.coordsAtPos
     */
    coordsAtPos(pos: number): {left: number; right: number; top: number; bottom: number};

    /**
     * Execute a ProseMirror command against this editor.
     */
    dispatchCommand(command: Command): void;
};

const ContentEditorForwardRef = forwardRef(ContentEditorWrapper) as <
    Content extends ContentWithReferences,
>(
    props: PropsWithoutRef<ContentEditorProps<Content>> & RefAttributes<ContentEditorRef>,
) => ReactElement;
export {ContentEditorForwardRef as ContentEditor};

export type ContentEditorProps<Content extends ContentWithReferences> = {
    /**
     * The current state of our content editor.
     *
     * Mostly the content editor state is a wrapper around ProseMirror's immutable
     * `EditorState` with some type safety and helper functions.
     */
    state: ContentEditorState<Content>;

    /**
     * Fired whenever the content editor's state changes.
     *
     * Every state change will be optimistically synchronously applied to the
     * DOM. If you don't re-render with the new state then that optimistic
     * update will be reverted.
     */
    onChange: (
        state: ContentEditorState<Content>,
        // We send the transaction on change in case the parent wants to respond
        // to some specific action taken in the transaction.
        transaction: Transaction,
    ) => void;

    /**
     * Fired when the user presses enter in a content editor.
     *
     * Providing an `onEnterFromPhysicalKeyboard` callback will prevent the default
     * enter behavior. It will also switch our editor out of multiline mode for
     * assistive technologies.
     *
     * Pressing shift+enter has the same behavior as pressing enter as a
     * workaround. Pressing alt+enter will insert a hard line break and won't
     * trigger this callback. Pasting in content with multiple paragraphs also
     * allows you to add multiple lines. So providing `onEnterFromPhysicalKeyboard`
     * doesn't make our editor fully single lined.
     */
    onEnterFromPhysicalKeyboard?: (event: KeyboardEvent) => void;

    /**
     * Fired when the user press cmd-enter (or ctrl-enter on non MacOS platforms)
     * in a content editor.
     *
     * Providing an `onModEnter` callback will prevent the default enter behavior.
     */
    onModEnter?: (event: KeyboardEvent) => void;

    /**
     * Placeholder text to render in the editor when there is no other content.
     */
    placeholder?: string;

    /**
     * The class name we'll apply to the content editable `<div>`.
     */
    className?: string;

    /**
     * The class name we'll apply to the `<div>` containing the content editable
     * `<div>`. We need a container `<div>` (unfortunately) to have an element to
     * mount ProseMirror editor within given the ProseMirror editor is not a React
     * component.
     */
    containerClassName?: string;

    /**
     * Event fired when the user focuses the content editor.
     */
    onFocus?: (event: FocusEvent<HTMLDivElement>) => void;

    /**
     * Event fired when the user unfocuses the content editor.
     */
    onBlur?: (event: FocusEvent<HTMLDivElement>) => void;

    /**
     * Fired when the user presses the escape key.
     */
    onEscape?: (event: KeyboardEvent) => void;

    /**
     * Fired when the user presses the up arrow key.
     */
    onArrowUp?: (event: KeyboardEvent) => void;

    /**
     * Phantom text selections decorations that render on top of the editor and
     * represent the cursor position of other users.
     */
    phantomSelections?: ReadonlyArray<ContentEditorPhantomSelection>;

    /**
     * Opens a comment thread when clicked. If your schema supports comment marks
     * you must provide this function to open them. `<ContentEditor>` knows almost
     * nothing about how comments are implemented, only how they are styled.
     */
    openCommentThread?: (commentThreadId: DocumentCommentThreadId) => Promise<void>;

    /**
     * When a pointer presses down on a comment thread this function is called.
     * `openCommentThread` is called when a press is considered a click. (So
     * pointer up and the pointer hasn't moved off.) Our parent component is
     * responsible for updating the styles of all marks for this comment thread
     * using `commentActiveDynamicCssTemplate`.
     */
    onCommentThreadPressedChange?: (
        commentThreadId: DocumentCommentThreadId,
        isHovered: boolean,
    ) => void;

    /**
     * Called when an undo stack entry is added. If you're managing undo/redo
     * keyboard shortcuts you'll need to push to our own stack when this is called.
     */
    onUndoStackEntryPushed?: () => void;

    /**
     * Called when an undo stack entry is added during a redo command. This needs
     * to behave a bit differently than `onUndoStackEntryPushed()` since it
     * shouldn't reset the redo stack.
     *
     * If you're managing undo/redo keyboard shortcuts you'll need to push to our
     * own stack when this is called.
     */
    onUndoStackEntryPushedFromRedo?: () => void;

    /**
     * Called when a redo stack entry is added. If you're managing undo/redo
     * keyboard shortcuts you'll need to push to our own stack when this is called.
     */
    onRedoStackEntryPushed?: () => void;
} & (
    | {
          /**
           * A label exposed to assistive technology (through `aria-label`) when
           * there is no visible label for the element.
           */
          "aria-label": string;
          "aria-labelledby"?: undefined;
      }
    | {
          /**
           * A reference to another element (through `aria-labelledby`) with a
           * visible label for this element.
           */
          "aria-labelledby": string;
          "aria-label"?: undefined;
      }
);

export type ContentEditorPhantomSelection = {
    readonly key: string;
    readonly color: ThemeColor;
    readonly anchor: number;
    readonly head: number;
    readonly isTextSelection: boolean;
};

// When server-side rendering (initial app render), we render as a
// `<ContentView>` then once React hydrates on the client we switch out the
// non-editable `<ContentView>` for an editable `<ContentEditor>` component.
function ContentEditorWrapper<Content extends ContentWithReferences>(
    props: ContentEditorProps<Content>,
    ref: Ref<ContentEditorRef>,
) {
    const isInitialAppRender = useIsInitialAppRender();

    // Preload space accounts so when the user tries to mention one they
    // are available.
    //
    // Only preload space accounts outside of Jest unit tests! That way we don't
    // depend on space context in unit tests.
    if (!import.meta.jest) {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useExpensivelyPreloadAllSpaceAccounts();
    }

    if (isInitialAppRender) {
        return <ContentEditorInitialAppRender {...props} editorRef={ref} />;
    } else {
        return <ContentEditor {...props} editorRef={ref} />;
    }
}

function ContentEditorInitialAppRender<Content extends ContentWithReferences>({
    state,
    placeholder,
    className,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    containerClassName: customContainerClassName,
    editorRef,
}: ContentEditorProps<Content> & {editorRef: Ref<ContentEditorRef>}) {
    useImperativeHandle(
        editorRef,
        () => ({
            isFocused: () => false,
            focus: () => {
                throw new UnimplementedError(
                    "Focusing content editor on initial render is not implemented",
                );
            },
            blur: () => {
                // Nothing to blur
            },
            selectAll: () => {
                throw new UnimplementedError(
                    "Selecting all text in content editor on initial render is not implemented",
                );
            },
            coordsAtPos: () => {
                throw new UnimplementedError(
                    "Getting coordinates for position in content editor on initial render is not implemented",
                );
            },
            dispatchCommand: () => {
                throw new UnimplementedError(
                    "Dispatching a command on initial render is not implemented",
                );
            },
        }),
        [],
    );

    return (
        <div className={classNames(containerClassName, customContainerClassName)}>
            <ContentView
                content={state.getContent()}
                placeholder={placeholder}
                className={className}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                // Highlight all comments on initial render of `<ContentEditor>` since we'll
                // highlight them all when we re-render.
                shouldHighlightComment={useCallback(() => true, [])}
            />
        </div>
    );
}

/**
 * A rich text collaborative editor powered by [ProseMirror][1].
 *
 * ProseMirror fits well with the React component model as its state is fully
 * immutable. This means we can fully manage the state in React as we would with
 * any other component.
 *
 * [1]: https://prosemirror.net
 */
function ContentEditor<Content extends ContentWithReferences>(
    props: ContentEditorProps<Content> & {editorRef: Ref<ContentEditorRef>},
) {
    const {
        editorRef,
        state,
        placeholder,
        className,
        containerClassName: customContainerClassName,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        onFocus,
        onBlur,
        phantomSelections,
    } = props;

    const navigate = useNavigate();
    const isMobile = useIsMobile();

    const [canPrimaryInputHover, setCanPrimaryInputHover] = useState(
        () => !window.matchMedia("(hover: none)").matches,
    );

    useEffect(() => {
        const mediaQuery = window.matchMedia("(hover: none)");

        const handleChange = () => {
            setCanPrimaryInputHover(!mediaQuery.matches);
        };

        // In case media query changed since initial render.
        handleChange();

        mediaQuery.addEventListener("change", handleChange);
        return () => {
            mediaQuery.removeEventListener("change", handleChange);
        };
    }, []);

    // We choose our interaction mode based on whether the device's primary input
    // can hover. This is true on a laptop (e.g. MacOS) and false on a phone (e.g.
    // iOS). Haven't tested this with an iPad. Ideally it's true when a hardware
    // trackpad is connected and false when it's not.
    //
    // The difference between `isMobile` and `isDualModality` can be a bit
    // confusing.
    //
    // - On desktop, `isDualModality` is always false. `isMobile` will be true if
    //   the window is small but usually will be false (since we don't recommend
    //   small windows on desktop).
    //
    // - On an iPhone, document content editors are `isMobile = true` and
    //   `isDualModality = true`. However, message inputs are `isMobile = true` and
    //   `isDualModality = false`.
    //
    // - This isn't implemented yet but on an iPad we should have
    //   `isMobile = false` (since it's big enough for our desktop screen size) and
    //   should have `isDualModality = true` if there's no hardware keyboard but
    //   `isDualModality = false` if there is a hardware keyboard. If the user is
    //   primarily using the iPad via touch it should behave more like an iPhone
    //   than a laptop.
    const isDualModality = !canPrimaryInputHover;

    // The props for the current React commit. We are integrating with a stateful
    // component (ProseMirror's `EditorView`) so we need to be able to
    // imperatively access props.
    //
    // Importantly, we set this in a `useInsertionEffect` instead of render! If we
    // set in render and concurrent React cancels/rebases/retries the render then
    // there may be bugs.
    //
    // Please avoid using `propsRef` unless you can thoroughly reason through why
    // it's safe!
    const propsRef = useRef(props);
    const isMobileRef = useRef(isMobile);
    const isDualModalityRef = useRef(isDualModality);
    const navigateRef = useRef(navigate);
    // Don't get the current account when running in a unit test so we don't need
    // to render a space context when testing this component.
    const currentAccount =
        // eslint-disable-next-line react-hooks/rules-of-hooks
        !import.meta.jest ? useSpaceContext().currentAccount : null;
    const currentAccountRef = useRef(currentAccount);
    useInsertionEffect(() => {
        propsRef.current = props;
        isMobileRef.current = isMobile;
        isDualModalityRef.current = isDualModality;
        navigateRef.current = navigate;
        currentAccountRef.current = currentAccount;
    });

    const viewRef = useRef<EditorView | null>(null);

    useImperativeHandle(
        editorRef,
        () => ({
            isFocused: () => {
                const view = assertExists(viewRef.current);
                return document.activeElement === view.dom;
            },
            focus: (options?: FocusOptions) => {
                const view = assertExists(viewRef.current);
                (view.dom as HTMLDivElement).focus(options);
            },
            blur: () => {
                const view = assertExists(viewRef.current);
                (view.dom as HTMLDivElement).blur();
            },
            selectAll: () => {
                const view = assertExists(viewRef.current);
                view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
            },
            coordsAtPos: pos => {
                const view = assertExists(viewRef.current);
                return view.coordsAtPos(pos);
            },
            dispatchCommand: command => {
                const view = assertExists(viewRef.current);
                command(view.state, view.dispatch.bind(view), view);
            },
        }),
        [],
    );

    const [isFocused, setIsFocused] = useState(false);

    const [
        {lastOptimisticTransactionTime, lastSelectionChangeTransactionTime},
        setTransactionTimes,
    ] = useState<{
        lastOptimisticTransactionTime: number | null;
        lastSelectionChangeTransactionTime: number | null;
    }>({
        lastOptimisticTransactionTime: null,
        lastSelectionChangeTransactionTime: null,
    });

    const onStateChange = (
        oldState: EditorState,
        newState: EditorState,
        transaction: Transaction | null,
    ) => {
        // Report any added undo/redo stack entries...
        if (propsRef.current.onUndoStackEntryPushed || propsRef.current.onRedoStackEntryPushed) {
            // Deriving this logic from here:
            // https://github.com/ProseMirror/prosemirror-history/blob/40d274a74d0fc0787aeca03634a64d0c78f18a50/src/history.ts#L270-L276
            const isRedo = transaction?.getMeta(historyPluginKey.get())?.redo;

            const oldUndoDepth = undoDepth(oldState);
            const newUndoDepth = undoDepth(newState);

            const oldRedoDepth = redoDepth(oldState);
            const newRedoDepth = redoDepth(newState);

            if (oldUndoDepth < newUndoDepth) {
                for (let i = oldUndoDepth; i < newUndoDepth; i++) {
                    if (isRedo) {
                        propsRef.current.onUndoStackEntryPushedFromRedo?.();
                    } else {
                        propsRef.current.onUndoStackEntryPushed?.();
                    }
                }
            }

            if (oldRedoDepth < newRedoDepth) {
                for (let i = oldRedoDepth; i < newRedoDepth; i++) {
                    propsRef.current.onRedoStackEntryPushed?.();
                }
            }
        }
    };

    // Huh? `useInsertionEffect()`? That's a React hook? Ok, [it is][1] but the
    // docs say only CSS-in-JS libraries should use it.
    //
    // Wait what?? A `rootElement` parameter??? That's not documented? What the what?
    //
    // Read the documentation comment on `<TaskRowTitleInput>`. This is how we
    // render the non-React ProseMirror `EditorView`. It's essential for
    // performance on `<TaskRowTitleInput>`, it's not essential for performance
    // here. But we use this pattern everywhere we render an `EditorView` for
    // consistency and since we believe this is the proper way to manually mutate
    // the DOM in React.
    useInsertionEffect((rootElement?: HTMLDivElement) => {
        assert(rootElement);

        const accountStore = getAccountClientStoreForClient();

        const initialState = unwrap(propsRef.current.state);
        const schema = initialState.doc.type.schema;

        const initialIsDualModality = isDualModalityRef.current;

        const view = new EditorView(rootElement, {
            state: initialState,

            // On mobile devices we implement dual interaction modality. Before any
            // interaction the content is read-only. Tapping on links follows the link
            // instead of editing the content. Tapping on text switches to an editing
            // modality where tapping on a link instead edits the text.
            editable: () => !initialIsDualModality,

            attributes: {
                // Native spellcheck is often more distracting then it's worth. It puts a red
                // squiggly under names, nouns, industry terms, and oddly sometimes
                // contractions (like "they're", maybe has to do with curly quotes?).
                //
                // It's also inconsistent with `<input>`s which don't have spellcheck on by
                // default.
                //
                // NOTE(calebmer, 2022-12-29): Someday in the future we should build our own
                // spellchecker.
                //
                // NOTE(calebmer, 2023-02-19): Re-enabling this is now even harder now that we
                // have custom right-click menus. On desktop you right click to see the correct
                // spellings. But if we have our own right-click menu we can't show the correct
                // spellings there so we only show a permanent red squiggle which is bad. I
                // think the best answer here is to build our own spellchecker eventually.
                spellcheck: "false",
            },

            domParser: ContentEditorDomParser.fromSchema(schema),
            clipboardSerializer:
                ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
                    schema,
                    accountStore,
                    () => propsRef.current.state.getContent().references,
                ),
            clipboardTextSerializer: slice =>
                contentEditorTextClipboardSerializer(
                    slice,
                    accountStore,
                    () => propsRef.current.state.getContent().references,
                ),

            // IMPORTANT: If you have a custom view in `nodeViews` here you should also
            // have a matching custom renderer in `nodeRenderers` in
            // `renderContentToHtml()`.
            nodeViews: {
                orderedListItem: createContentEditorOrderedListItemNodeView,
                checkListItem: createContentEditorCheckListItemNodeView,
                mention: createContentEditorMentionNodeViewConstructor({
                    accountStore,
                    getCurrentAccountIfExists: () => currentAccountRef.current,
                }),
            },

            // IMPORTANT: If you have a custom view in `markViews` here you should also
            // have a matching custom renderer in `markRenderers` in
            // `renderContentToHtml()`.
            markViews: {
                link: createContentEditorLinkMarkViewConstructor({
                    onPointerEnterAfterDelay: ({mark, range}) => {
                        // We don't want to open floaters on mobile.
                        if (isMobileRef.current) return;

                        const floaterState = getContentEditorFloaterState(view.state);

                        // Don't open pointer link preview if the current floater is a comment
                        // input floater.
                        if (floaterState.type !== "CommentInput") {
                            view.dispatch(
                                setContentEditorFloaterState(view.state.tr, {
                                    type: "PointerLink",
                                    key: generateId(),
                                    mark,
                                    range,
                                    hasPointerLeftMark: false,
                                }),
                            );
                        }
                    },
                    onPointerEnter: mark => {
                        const floaterState = getContentEditorFloaterState(view.state);

                        if (floaterState.type === "PointerLink" && floaterState.mark.eq(mark)) {
                            view.dispatch(
                                setContentEditorFloaterState(view.state.tr, {
                                    ...floaterState,
                                    hasPointerLeftMark: false,
                                }),
                            );
                        }
                    },
                    onPointerLeave: mark => {
                        const floaterState = getContentEditorFloaterState(view.state);

                        if (floaterState.type === "PointerLink" && floaterState.mark.eq(mark)) {
                            view.dispatch(
                                setContentEditorFloaterState(view.state.tr, {
                                    ...floaterState,
                                    hasPointerLeftMark: true,
                                }),
                            );
                        }
                    },
                    onNavigate: to => navigateRef.current(to),
                }),

                // We don't have a `<ContentView>` implementation of this yet. Unclear how we
                // should support comments in `<ContentView>` at this moment.
                comment: createContentEditorCommentMarkViewConstructor({
                    openCommentThread: async commentThreadId => {
                        await propsRef.current.openCommentThread?.(commentThreadId);
                    },
                    onCommentThreadPressedChange: (commentThreadId, isHovered) => {
                        propsRef.current.onCommentThreadPressedChange?.(commentThreadId, isHovered);
                    },
                }),
            },

            handlePaste,

            handleKeyDown(_view, event) {
                const {isAppleDevice} = getClientInfoWithoutListening();

                // Implement keyboard shortcuts when the mention floater is open:
                const floaterState = getContentEditorFloaterState(view.state);
                if (floaterState.type === "Mention") {
                    floaterState.handleKeyDownRef.current?.(event);
                    if (event.defaultPrevented) return true;
                }

                if (
                    typeof propsRef.current.onModEnter === "function" &&
                    event.key === "Enter" &&
                    !event.altKey &&
                    !event.shiftKey &&
                    // Cmd+Enter triggers this on MacOS and Ctrl-Enter triggers this elsewhere
                    (isAppleDevice ? event.metaKey : event.ctrlKey)
                ) {
                    propsRef.current.onModEnter(event);
                    if (event.defaultPrevented) return true;
                }

                if (
                    typeof propsRef.current.onEnterFromPhysicalKeyboard === "function" &&
                    event.key === "Enter" &&
                    !event.altKey &&
                    !event.shiftKey &&
                    // Ctrl+Enter on non-MacOS platforms should trigger the callback
                    (!isAppleDevice || !event.ctrlKey) &&
                    // Cmd+Enter on MacOS platforms should trigger the callback
                    (isAppleDevice || !event.metaKey) &&
                    // On a physical keyboard where the user has access to Shift+Enter we sometimes
                    // want enter to send the message or otherwise save what's being edited. On a
                    // virtual, mobile, keyboard (like the iOS touchscreen keyboard) we want enter
                    // to insert a newline and have the user submit their message with a
                    // button press.
                    !isVirtualKeyboardEvent(event)
                ) {
                    propsRef.current.onEnterFromPhysicalKeyboard(event);
                    if (event.defaultPrevented) return true;
                }

                if (typeof propsRef.current.onEscape === "function" && event.key === "Escape") {
                    propsRef.current.onEscape(event);
                    if (event.defaultPrevented) return true;
                }

                if (typeof propsRef.current.onArrowUp === "function" && event.key === "ArrowUp") {
                    propsRef.current.onArrowUp(event);
                    if (event.defaultPrevented) return true;
                }

                return false;
            },

            // We add this property to `EditorView` with a patch. By default, on
            // triple-click ProseMirror selects the node being clicked and calls
            // `event.preventDefault()`. Calling `event.preventDefault()` stops the
            // selection from moving when the user drags their mouse in Chrome. The native
            // triple-click selection behavior in Chrome works well. Since we want the
            // selection to keep moving as the user drags, turn off the default
            // ProseMirror behavior.
            //
            // For some node types we may need the ProseMirror behavior in the future.
            shouldDefaultTripleClickNotPreventDefault: () => true,

            dispatchTransaction(transaction) {
                const oldState = view.state;

                // By default, applying a transaction will clear the editor's stored
                // marks. We don't want that behavior! Instead we want to preserve stored marks
                // until a user either explicitly toggles them off or moves their selection
                // somewhere else in the document.
                const shouldResetStoredMarks = !transaction.docChanged && transaction.selectionSet;
                if (
                    !shouldResetStoredMarks &&
                    oldState.storedMarks &&
                    !transaction.storedMarksSet
                ) {
                    transaction.setStoredMarks(oldState.storedMarks);
                }

                const newState = oldState.apply(transaction);

                const shouldRunWithImmediatePriority =
                    // Run the update immediately if the content is going into an empty state so we
                    // can render the placeholders in the same frame.
                    isContentTitleEmpty(newState.doc) || isContentBodyEmpty(newState.doc);

                // Always call the change handler through a ref. By using a ref we can avoid
                // destroying and recreating an editor when the function changes.
                if (!shouldRunWithImmediatePriority) {
                    propsRef.current.onChange(wrap(newState), transaction);
                } else {
                    runWithImmediatePriority(() => {
                        propsRef.current.onChange(wrap(newState), transaction);
                    });
                }

                // Optimistically apply the next transaction to our editor view.
                // ProseMirror preserves local DOM state when we call `updateState()`
                // synchronously.
                //
                // See the "Efficient updating" section in the [editor view guide][1].
                // If we don't synchronously apply the transaction it is considered
                // cancelled. A quote from the guide:
                //
                // > When such a transaction is canceled or modified somehow, the view
                // > will undo the DOM change...
                //
                // We update the `lastOptimisticTransactionTime` state to re-run an effect
                // below which reconciles the editor view state with the state we get from
                // props. That way if our optimistic update is wrong we'll fix it when
                // React commits.
                //
                // [1]: https://prosemirror.net/docs/guide/#view
                view.updateState(newState);
                updateEditorEmptyClass(newState);
                onStateChange(oldState, newState, transaction);

                setTransactionTimes(transactionTimes => ({
                    lastOptimisticTransactionTime: transaction.time,
                    lastSelectionChangeTransactionTime: !oldState.selection.eq(newState.selection)
                        ? transaction.time
                        : transactionTimes.lastSelectionChangeTransactionTime,
                }));
            },
        });

        if (isMobileWebKit) {
            // NOTE(calebmer): This is a fix for what I consider to be a Safari bug. In iOS
            // the selection highlight and caret color is controlled by the `caret-color`
            // CSS property. On desktop the caret color defaults to the current text color.
            // On iOS the caret color defaults to `WKWebView`'s `tintColor` property. On
            // desktop, we want the caret color to be `grey-text` even while in a link so
            // the cursor color doesn't change as the user moves it across different
            // styles. So we set `caret-color` to `grey-text` in `content_schema.css.ts`.
            // However on iOS we want the caret/selection color to be `WKWebView`'s
            // `tintColor`. The problem is:
            //
            // 1. Setting [`caret-color: initial` in WebKit also sets the stored caret
            //    color (which initially is null) to the current text color][1]
            // 2. If the `WKWebView`'s `tintColor` is specifically `UIColor.systemBlue`
            //    (the default `tintColor`) [WebKit uses the stored caret color][2] if it's
            //    not null instead of `tintColor`
            //
            // 1 seems like the correct behavior on MacOS Safari but on iOS Safari when we
            // set `caret-color: initial` we want `WKWebView`'s `tintColor` even if it's
            // `UIColor.systemBlue`. Not the text color which is black. This seems like a
            // bug in iOS Safari but it's easy to workaround by manually setting caret
            // color back to `UIColor.systemBlue`.
            //
            // This will override `WKWebView`'s custom `tintColor` if `tintColor` not
            // system blue so we have to be a little careful. In our native mobile app we
            // set a non-system blue `tintColor` so we need to set `caret-color: initial`
            // when running in our native mobile app shell.
            //
            // [1]: https://github.com/WebKit/WebKit/blob/ccd45357bd2ad7e46bbf93b899234eeb1c62cca2/Source/WebCore/rendering/style/RenderStyleSetters.h#L171
            // [2]: https://github.com/WebKit/WebKit/blob/1a78cf12c8f5ff2e296f7eb25ff4bcbc86cfbfe8/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm#L4341-L4345
            view.dom.style.caretColor = NativeMobileBridge ? "initial" : "-apple-system-blue";
        }

        let touchTapState: {
            finish: (event: TouchEvent) => void;
            cancel: () => void;
        } | null = null;

        // TODO(calebmer): Probably also need to support focusing in dual modality mode
        // with mouse events. For example, an iPad user with a hardware trackpad.
        // Does the browser give us touch events or mouse events?
        view.dom.addEventListener("touchstart", event => {
            touchTapState?.cancel();
            touchTapState = null;

            // If we're not on mobile the document is always editable.
            if (!isDualModalityRef.current) return;

            // Only support a single touch.
            if (event.touches.length !== 1) return;
            const touch = event.touches[0]!;

            // If there's a focused element this tap dismisses the focus. It doesn't make
            // the editor editable.
            if (document.activeElement && document.activeElement !== document.body) return;

            // If there's a selection this tap dismisses the selection. It doesn't make the
            // editor editable.
            const selection = window.getSelection();
            const hasSelection =
                selection &&
                (selection.anchorNode !== selection.focusNode ||
                    selection.anchorOffset !== selection.focusOffset);
            if (hasSelection) return;

            // Long press touch selects text instead of starts editing. 0.5 seconds is the
            // default press duration used by iOS's long press gesture recognizer.
            // https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer/1616423-minimumpressduration
            const longPressTimeout = createTimeout(() => {
                touchTapState?.cancel();
                touchTapState = null;
            }, 500);

            touchTapState = {
                finish: event => {
                    longPressTimeout.clear();

                    const posResult = view.posAtCoords({left: touch.clientX, top: touch.clientY});
                    if (!posResult) return;

                    // By default, iOS will move the selection to the end of the word you touched.
                    // We instead want focus moved to the selection specified in our
                    // `setSelection()` call.
                    event.preventDefault();

                    // This may seem strange. Shouldn't `setIsFocused(true)` be set from an event
                    // handler after `focus()` is called? Well in this case our editor is not
                    // editable if we are in dual modality state and `isFocused` is false. When our
                    // editor is not editable it's also not focusable. So we need to set `isFocused`
                    // to true to be able to focus!
                    //
                    // We must call `focus()` during the `touchend` event since iOS won't open the
                    // software keyboard unless focus happens in a user-initiated event. So we call
                    // `flushSync()` to make sure `isFocused` is updated synchronously so we can
                    // call `focus()` synchronously.
                    flushSync(() => setIsFocused(true));
                    view.focus();

                    view.dispatch(
                        view.state.tr.setSelection(
                            new TextSelection(view.state.doc.resolve(posResult.pos)),
                        ),
                    );
                },
                cancel: () => {
                    longPressTimeout.clear();
                },
            };
        });

        view.dom.addEventListener("touchmove", () => {
            // Touch move turns into a scroll or drag gesture.
            touchTapState?.cancel();
            touchTapState = null;
        });

        view.dom.addEventListener("touchend", event => {
            // If our tap state hasn't been cancelled we actually successfully received
            // a tap!
            touchTapState?.finish(event);
            touchTapState = null;
        });

        view.dom.addEventListener("touchcancel", () => {
            touchTapState?.cancel();
            touchTapState = null;
        });

        const handleSelectionChange = () => {
            // After a long press, iOS selects text. If we see the selection change during
            // a tap we no longer have a tap gesture and instead we have a long press
            // gesture.
            touchTapState?.cancel();
            touchTapState = null;
        };

        document.addEventListener("selectionchange", handleSelectionChange);

        // Stash the editor view instance on the DOM node for debugging and tests.
        (rootElement as any)[internalEditorViewKey] = view;

        viewRef.current = view;

        return () => {
            document.removeEventListener("selectionchange", handleSelectionChange);
            view.destroy();
        };

        // IMPORTANT: If the view ref ever changes I suspect things will start
        // breaking. (Though I'm not entirely sure.) Child components may be written
        // assuming a constant view. Make sure this is always an empty
        // dependency array.
    }, []);

    // Effect which reconciles our editor state prop with the imperative editor
    // view state.
    //
    // Layout effect because the visual layout depends on the editor state prop
    // which we need to set imperatively.
    useLayoutEffect(() => {
        // We don't do anything with `lastOptimisticTransactionTime` in this effect,
        // but we want the effect to re-run whenever it changes. We optimistically
        // update our `EditorView` state as an optimization. When React finishes
        // committing we reconcile the prop state with the `EditorView` state in
        // this effect.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        lastOptimisticTransactionTime;

        const newState = unwrap(state);

        const view = assertExists(viewRef.current);
        const oldState = view.state;
        if (oldState !== newState) {
            view.updateState(newState);
            onStateChange(oldState, newState, null);
        }

        updateEditorEmptyClass(newState);
    }, [lastOptimisticTransactionTime, state]);

    const [decorationCallbacks, setDecorationCallbacks] = useState<
        ReadonlySet<(decorationSet: DecorationSet, state: EditorState) => DecorationSet>
    >(() => new Set());

    useLayoutEffect(() => {
        const view = assertExists(viewRef.current);

        view.setProps({
            editable: () => !isDualModality || isFocused,

            decorations: state => {
                let decorationSet = DecorationSet.empty;

                decorationSet = addEmojiDecorations(decorationSet, state.doc);

                for (const decorationCallback of decorationCallbacks) {
                    decorationSet = decorationCallback(decorationSet, state);
                }

                return decorationSet;
            },
        });
    }, [decorationCallbacks, isDualModality, isFocused]);

    // Apply `className`s from our `className` prop. Take care to make sure class
    // names added by ProseMirror or other effects continue to be applied.
    useLayoutEffect(() => {
        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        const classList = classNames(docClassName, className).split(" ");
        viewElement.classList.add(...classList);

        return () => {
            viewElement.classList.remove(...classList);
        };
    }, [className]);

    // Adds the `emptyTitleClassName` class if the editor document is empty and
    // removes the class when the editor document is not empty.
    function updateEditorEmptyClass(state: EditorState) {
        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        const addEmptyTitleClassName = isContentTitleEmpty(state.doc);
        if (addEmptyTitleClassName && !viewElement.classList.contains(emptyTitleClassName)) {
            viewElement.classList.add(emptyTitleClassName);
        }
        if (!addEmptyTitleClassName && viewElement.classList.contains(emptyTitleClassName)) {
            viewElement.classList.remove(emptyTitleClassName);
        }

        const addEmptyBodyClassName = isContentBodyEmpty(state.doc);
        if (addEmptyBodyClassName && !viewElement.classList.contains(emptyBodyClassName)) {
            viewElement.classList.add(emptyBodyClassName);
        }
        if (!addEmptyBodyClassName && viewElement.classList.contains(emptyBodyClassName)) {
            viewElement.classList.remove(emptyBodyClassName);
        }
    }

    // Apply a class to the view element depending on whether the shift key is
    // down or not.
    useEffect(() => {
        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        let isShiftKeyOrAltKeyDown = false;

        const handleKeyDownOrUp = (event: KeyboardEvent) => {
            if (event.shiftKey || event.altKey) {
                if (!isShiftKeyOrAltKeyDown) {
                    isShiftKeyOrAltKeyDown = true;
                    viewElement.classList.add(shiftKeyOrAltKeyDownClassName);
                }
            } else {
                if (isShiftKeyOrAltKeyDown) {
                    isShiftKeyOrAltKeyDown = false;
                    viewElement.classList.remove(shiftKeyOrAltKeyDownClassName);
                }
            }
        };

        document.addEventListener("keydown", handleKeyDownOrUp, true);
        document.addEventListener("keyup", handleKeyDownOrUp, true);

        return () => {
            document.removeEventListener("keydown", handleKeyDownOrUp, true);
            document.removeEventListener("keyup", handleKeyDownOrUp, true);
        };
    }, []);

    // Keep various attributes on the editor element up to date.
    useLayoutEffect(() => {
        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        // Set the role for assistive technologies. For documentation see:
        // https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/textbox_role
        viewElement.setAttribute("role", "textbox");
        viewElement.setAttribute("aria-multiline", "true");

        if (ariaLabel) {
            viewElement.setAttribute("aria-label", ariaLabel);
        } else {
            viewElement.removeAttribute("aria-label");
        }

        if (ariaLabelledBy) {
            viewElement.setAttribute("aria-labelledby", ariaLabelledBy);
        } else {
            viewElement.removeAttribute("aria-labelledby");
        }
    }, [ariaLabel, ariaLabelledBy]);

    const isTitleEmpty = isContentTitleEmpty(state.getDoc());
    const isBodyEmpty = isContentBodyEmpty(state.getDoc());

    // Set `aria-placeholder` on the editor for accessibility and then
    // `data-placeholder` on nodes which need to render placeholders.
    useLayoutEffect(() => {
        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        if (!placeholder) {
            viewElement.removeAttribute("aria-placeholder");
        } else {
            viewElement.setAttribute("aria-placeholder", placeholder);

            const placeholderDecorationCallbacks: Array<
                (decorationSet: DecorationSet, state: EditorState) => DecorationSet
            > = [];

            if (isTitleEmpty) {
                placeholderDecorationCallbacks.push((decorationSet, state) => {
                    return decorationSet.add(state.doc, [
                        Decoration.node(0, 2, {
                            "data-placeholder": documentFallbackTitle,
                            // For accessibility, if the title is empty add the fallback title as an
                            // `aria-label`. axe complains when we have an empty `<h1>`.
                            "aria-label": documentFallbackTitle,
                        }),
                    ]);
                });
            }

            if (isBodyEmpty) {
                placeholderDecorationCallbacks.push((decorationSet, state) => {
                    let from;
                    if (!state.doc.type.schema.nodes.title) {
                        from = 0;
                    } else {
                        from = state.doc.child(0).nodeSize;
                    }

                    return decorationSet.add(state.doc, [
                        Decoration.node(from, from + 2, {
                            "data-placeholder": placeholder,
                        }),
                    ]);
                });
            }

            if (placeholderDecorationCallbacks.length > 0) {
                setDecorationCallbacks(decorationCallbacks => {
                    const newDecorationCallbacks = new Set(decorationCallbacks);
                    for (const decorationCallback of placeholderDecorationCallbacks)
                        newDecorationCallbacks.add(decorationCallback);
                    return newDecorationCallbacks;
                });
            }

            return () => {
                if (placeholderDecorationCallbacks.length > 0) {
                    setDecorationCallbacks(decorationCallbacks => {
                        const newDecorationCallbacks = new Set(decorationCallbacks);
                        for (const decorationCallback of placeholderDecorationCallbacks)
                            newDecorationCallbacks.delete(decorationCallback);
                        return newDecorationCallbacks;
                    });
                }
            };
        }
    }, [isBodyEmpty, isTitleEmpty, placeholder]);

    // When the content editor is unfocused give the editor's text selection a
    // light grey background. That way the user can see what will be selected when
    // they focus the editor back.
    //
    // This is important for the link and highlight floater which gives the user's
    // keyboard focus to another element that's still targeting the content editor.
    // So the user needs to see what content their link/highlight will apply to.
    useLayoutEffect(() => {
        assert(viewRef.current);
        const view = viewRef.current;
        const viewElement = view.dom;

        const blurDecorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            const floaterState = getContentEditorFloaterState(state);

            switch (floaterState.type) {
                // While the comment input is open, optimistically add the highlight style so
                // the user doesn't lose track of the text they selected.
                case "CommentInput": {
                    return decorationSet.add(state.doc, [
                        Decoration.inline(state.selection.from, state.selection.to, {
                            class: contentSchemaStyles.commentClassName,
                        }),
                    ]);
                }
                // While the link input is open, optimistically add the link style so the user
                // doesn't lose track of the text they selected.
                case "KeyboardLink":
                case "PointerLink": {
                    return decorationSet.add(state.doc, [
                        Decoration.inline(state.selection.from, state.selection.to, {
                            class: contentSchemaStyles.linkClassName,
                        }),
                    ]);
                }
                default:
                    return decorationSet;
            }
        };

        const handleFocus = () => {
            setIsFocused(true);

            setDecorationCallbacks(decorationCallbacks => {
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(blurDecorationCallback);
                return newDecorationCallbacks;
            });
        };

        const handleBlur = () => {
            setIsFocused(false);

            setDecorationCallbacks(decorationCallbacks => {
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.add(blurDecorationCallback);
                return newDecorationCallbacks;
            });
        };

        if (document.activeElement === viewElement) {
            handleFocus();
        } else {
            handleBlur();
        }

        viewElement.addEventListener("focus", handleFocus);
        viewElement.addEventListener("blur", handleBlur);
        return () => {
            viewElement.addEventListener("focus", handleFocus);
            viewElement.addEventListener("blur", handleBlur);

            setDecorationCallbacks(decorationCallbacks => {
                if (!decorationCallbacks.has(blurDecorationCallback)) return decorationCallbacks;
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(blurDecorationCallback);
                return newDecorationCallbacks;
            });
        };
    }, []);

    const [selectedNodeElement, setSelectedNodeElement] = useState<HTMLElement | null>(null);

    useEffect(() => {
        // Rerun this effect whenever anything in the content editor changes. We depend
        // on `state` since that represents the latest official state and we depend on
        // `lastOptimisticTransactionTime` since that represents when content changes
        // optimistically.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        state;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        lastOptimisticTransactionTime;

        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        // Keep track of the element ProseMirror marks as selected with the
        // `ProseMirror-selectednode` CSS class so that we can render our own custom
        // ring around it.
        const selectedNodeElement = viewElement.getElementsByClassName(
            "ProseMirror-selectednode",
        )[0];
        if (selectedNodeElement instanceof HTMLElement) {
            setSelectedNodeElement(selectedNodeElement);
        } else {
            setSelectedNodeElement(null);
        }
    }, [lastOptimisticTransactionTime, state]);

    // Highlights the selection of all our phantom text selections using the
    // ProseMirror decoration feature. We render `phantomSelections` in two
    // parts:
    //
    // 1. The phantom text selection (only if the selection is not empty)
    // 2. The text selection cursor head
    //
    // 1 is rendered using the PromiseMirror decoration feature. 2 is rendered as
    // standard React components since inserting an element into the DOM between
    // some characters breaks kerning. Which causes some jitter when user quickly
    // moves their phantom cursor around.
    useLayoutEffect(() => {
        if (!phantomSelections || phantomSelections.length === 0) return;

        const decorations: Array<(state: EditorState) => Array<Decoration>> = [];

        for (const phantomSelection of phantomSelections) {
            if (phantomSelection.anchor !== phantomSelection.head) {
                decorations.push(state => {
                    const from = Math.min(
                        Math.min(phantomSelection.anchor, phantomSelection.head),
                        state.doc.nodeSize - 2,
                    );
                    const to = Math.min(
                        Math.max(phantomSelection.anchor, phantomSelection.head),
                        state.doc.nodeSize - 2,
                    );

                    return createSelectionDecorations(
                        state.doc,
                        TextSelection.between(state.doc.resolve(from), state.doc.resolve(to)),
                        colorSchemeVars[`${phantomSelection.color}-selection`],
                    );
                });
            }
        }

        if (decorations.length === 0) return;

        const decorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            return decorationSet.add(
                state.doc,
                // We need to copy the array since it looks like `DecorationSet.add()`
                // mutates it?
                decorations.flatMap(decoration => decoration(state)),
            );
        };

        setDecorationCallbacks(decorationCallbacks => {
            const newDecorationCallbacks = new Set(decorationCallbacks);
            newDecorationCallbacks.add(decorationCallback);
            return newDecorationCallbacks;
        });

        return () => {
            setDecorationCallbacks(decorationCallbacks => {
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(decorationCallback);
                return newDecorationCallbacks;
            });
        };
    }, [phantomSelections]);

    const floaterState = state.getFloaterState();

    // If we have a mention floater, we also want to decorate the text the user is
    // typing in so they know the boundaries of the mention.
    useLayoutEffect(() => {
        if (floaterState.type !== "Mention") return;

        const decorationCallback = (decorationSet: DecorationSet, state: EditorState) => {
            return decorationSet.add(state.doc, [
                Decoration.inline(floaterState.range.from, floaterState.range.to, {
                    class: inlineMentionInputClassName,
                }),
            ]);
        };

        setDecorationCallbacks(decorationCallbacks => {
            const newDecorationCallbacks = new Set(decorationCallbacks);
            newDecorationCallbacks.add(decorationCallback);
            return newDecorationCallbacks;
        });

        return () => {
            setDecorationCallbacks(decorationCallbacks => {
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(decorationCallback);
                return newDecorationCallbacks;
            });
        };
    }, [floaterState]);

    useContentEditorDebugTools(viewRef);

    const maintainInteractionModalityRef = useRef<Modality | null>(null);

    return (
        <div
            className={classNames(containerClassName, customContainerClassName)}
            onFocus={onFocus}
            onFocusCapture={event => {
                // When the user hits cmd-k to open a link input in `<MessageView>`, types a
                // link, then hits enter, we should not render a `<FocusRing>` if the
                // `<ContentEditor>` didn't previously have a `<FocusRing>`. To do this we reset
                // the interaction modality when focusing the `<ContentEditor>` to the
                // interaction modality when it initially received focus as long as focus
                // doesn't leave the `<ContentEditor>`.
                //
                // We intentionally don't check `event.target === viewRef.current.dom` because
                // we also want to reset interaction modality when focusing children. Like the
                // comment input in documents.
                if (maintainInteractionModalityRef.current !== null) {
                    setInteractionModality(maintainInteractionModalityRef.current);
                } else {
                    maintainInteractionModalityRef.current = getInteractionModality();
                }
            }}
            onBlur={event => {
                if (
                    !(event.relatedTarget instanceof Element) ||
                    !isElementOwnedBy(event.currentTarget, event.relatedTarget)
                ) {
                    maintainInteractionModalityRef.current = null;
                }

                onBlur?.(event);
            }}
        >
            <ContentEditorFloater
                isMobile={isMobile}
                state={unwrap(state)}
                viewRef={viewRef}
                floaterState={floaterState}
                setFloaterState={floaterState => {
                    const view = assertExists(viewRef.current);
                    view.dispatch(setContentEditorFloaterState(view.state.tr, floaterState));
                }}
                isFocused={isFocused}
                lastSelectionChangeTransactionTime={lastSelectionChangeTransactionTime}
            />
            {selectedNodeElement && (
                // TODO(calebmer): If you type "foo" in the title, then "bar" in the body, then
                // put your cursor at the beginning of "bar" and hit backspace it selects the
                // title node and it looks weird. (Make sure there are no paragraphs
                // after "bar".)
                <FocusRing isVisible={true} targetElement={selectedNodeElement} />
            )}
            {phantomSelections?.map(phantomSelection => (
                <ContentEditorPhantomSelectionCursor
                    key={phantomSelection.key}
                    state={unwrap(state)}
                    viewRef={viewRef}
                    phantomSelection={phantomSelection}
                />
            ))}
        </div>
    );
}

// Inspired by [React internal keys][1].
//
// [1]: https://github.com/facebook/react/blob/80c4dea0d1da0012977c6c4b2ac7a8bd37154d50/packages/react-dom/src/client/ReactDOMComponentTree.js#L34-L41
const internalEditorViewKey = `__prosemirrorEditorView$${Math.random().toString(36).slice(2)}`;

export function getEditorViewForTest(element: unknown): EditorView {
    assert(import.meta.jest);
    assert(typeof element === "object" && element !== null);

    const editorView =
        (element as any)[internalEditorViewKey] ??
        (element as any).parentNode?.[internalEditorViewKey];

    assert(editorView instanceof EditorView);
    return editorView;
}

function handlePaste(view: EditorView, event: ClipboardEvent, slice: Slice): boolean {
    if (handleLinkPaste(view, event)) return true;

    // If we're pasting into an empty paragraph at the top level, then paste the
    // entire slice content instead of the content determined by `Slice.maxOpen()`.
    if (
        view.state.selection.$from.depth === 1 &&
        view.state.selection.$from.node().type.name === "paragraph" &&
        view.state.selection.$from.node().nodeSize === 2 &&
        view.state.selection.$from.pos === view.state.selection.$to.pos
    ) {
        view.dispatch(view.state.tr.replaceSelection(new Slice(slice.content, 0, 0)));
        return true;
    }

    return false;
}

/**
 * If the user has selected some text and they paste a link then we want to
 * convert the selected text to a link instead of replacing the text.
 */
function handleLinkPaste(view: EditorView, event: ClipboardEvent): boolean {
    // 1. Only perform a link paste if we've selected some text.
    const {state} = view;
    if (state.selection.from === state.selection.to) {
        return false;
    }

    // 2. Make sure the URL starts with an allowed protocol.
    const url = event.clipboardData?.getData("text/plain");
    if (url && !startsWithSafeUrlProtocol(url)) {
        return false;
    }

    // 3. Instead of replacing the selected text with the replaced text we instead
    // add a link mark to the selection.
    const range = trimSpacesFromProsemirrorRange(state.doc, state.selection);
    view.dispatch(state.tr.addMark(range.from, range.to, state.schema.mark("link", {url})));
    return true;
}

/**
 * Create decorations that carefully recreate browser text selection styles. So
 * far we've only tested this on Chrome for MacOS. May need tweaks to match
 * Windows styles.
 *
 * Some things to consider when creating selection styles in Chrome for MacOS:
 *
 * - The height of the selection should match the text's line height. Not
 *   content height. We can't find a CSS property to let us target an inline
 *   element's line height with a background color so we carefully add some
 *   padding.
 *
 * - Selection adds some extra space at the end of selected paragraphs to show
 *   that you are selecting a newline.
 */
function createSelectionDecorations(doc: Node, selection: Selection, color: string) {
    // Convert non-text selections into text selections. So the `from` and `to`
    // point to positions in text.
    if (!(selection instanceof TextSelection)) {
        selection = TextSelection.between(selection.$from, selection.$to);
    }

    const decorations = [
        Decoration.inline(selection.from, selection.to, {
            class: inlineElementPaddingToLineHeightClassName,
            style: `background-color:${color}`,
        }),
    ];

    // Add newline indicators to the end of selected paragraphs and headers like
    // browser selection styles.
    //
    // Particularly important to show we've selected an empty paragraph or header.
    doc.nodesBetween(selection.from, selection.to, (node, pos) => {
        if (!node.inlineContent) return;

        const newlineIndicatorPos = pos + node.content.size + 1;
        if (newlineIndicatorPos >= selection.to) return;

        decorations.push(
            Decoration.widget(newlineIndicatorPos, () => {
                const newlineIndicatorElement = document.createElement("span");
                newlineIndicatorElement.textContent = " ";
                newlineIndicatorElement.className = inlineElementPaddingToLineHeightClassName;
                newlineIndicatorElement.style.backgroundColor = color;
                newlineIndicatorElement.style.userSelect = "none";
                newlineIndicatorElement.ariaHidden = "true";
                return newlineIndicatorElement;
            }),
        );
    });

    return decorations;
}

/**
 * Add a decoration for every emoji in the editor that wraps the emoji in a
 * `<span>` and changes the font to `emojiFontFamily`. Otherwise we end up
 * using characters from our default font (Inter). For example, Inter has a
 * heart glyph but we don't want to use that glyph.
 *
 * Since traversing the entire doc can be expensive for large docs we have a
 * caching layer that takes advantage of structural sharing in the immutable
 * doc representation.
 */
const addEmojiDecorations = createProsemirrorIncrementalReducer<DecorationSet>(node => {
    if (!node.isText) return null;

    const text = node.text!;
    const emojis = Array.from(iterateEmojis(text));

    if (emojis.length === 0) return null;

    return (decorations, doc, offset) => {
        return decorations.add(
            doc,
            emojis.map(({index, emoji}) =>
                Decoration.inline(offset + index, offset + index + emoji.length, {
                    nodeName: "span",
                    style: `font-family:${emojiFontFamily}`,
                }),
            ),
        );
    };
});
