import classNames from "classnames";
import {Node, Slice} from "prosemirror-model";
import {
    AllSelection,
    Command,
    EditorState,
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
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import {
    ContentEditorState,
    getContentEditorFloaterState,
    setContentEditorFloaterState,
} from "~/client/content/content_editor_state";
import {ContentView} from "~/client/content/content_view";
import {createContentEditorCheckListItemNodeView} from "~/client/content/internal/content_editor_check_list_item_node_view";
import {createContentEditorCommentMarkViewConstructor} from "~/client/content/internal/content_editor_comment_mark_view";
import {ContentEditorDomClipboardSerializer} from "~/client/content/internal/content_editor_dom_clipboard_serializer";
import {ContentEditorDomParser} from "~/client/content/internal/content_editor_dom_parser";
import {ContentEditorFloater} from "~/client/content/internal/content_editor_floater";
import {createContentEditorLinkMarkViewConstructor} from "~/client/content/internal/content_editor_link_mark_view";
import {createContentEditorMentionNodeViewConstructor} from "~/client/content/internal/content_editor_mention_node_view";
import {createContentEditorOrderedListItemNodeView} from "~/client/content/internal/content_editor_ordered_list_item_node_view";
import {ContentEditorPhantomSelectionCursor} from "~/client/content/internal/content_editor_phantom_selection_cursor";
import {contentEditorTextClipboardSerializer} from "~/client/content/internal/content_editor_text_clipboard_serializer";
import {useContentEditorDebugTools} from "~/client/content/internal/use_content_editor_debug_tools";
import {FocusRing} from "~/client/design/focus_ring";
import {isMac} from "~/client/helpers/browser/is_mac";
import {isVirtualKeyboardEvent} from "~/client/helpers/events/is_virtual_keyboard_event";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority";
import {useNavigate} from "~/client/remix/use_navigate";
import {useSpaceContext} from "~/client/spaces/space_context";
import {useExpensivelyPreloadAllSpaceAccounts} from "~/client/spaces/use_expensively_load_all_space_accounts";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema";
import {documentFallbackTitle} from "~/shared/content/document_fallback_title";
import {isContentBodyEmpty, isContentTitleEmpty} from "~/shared/content/is_content_empty";
import {ThemeColor} from "~/shared/design/theme_colors";
import {UnimplementedError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis";
import {startsWithSafeUrlProtocol} from "~/shared/helpers/string/starts_with_safe_url_protocol";
import {generateId} from "~/shared/id/id";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {ContentWithReferences} from "~/shared/models/content_references";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range";
import {
    colorSchemeVars,
    contentEditorStyles,
    contentSchemaStyles,
    emojiFontFamily,
} from "~/shared/styles/styles";

const {docClassName, emptyBodyClassName, emptyTitleClassName} = contentSchemaStyles;

const {
    containerClassName,
    hideSelectionWhileUnfocusedClassName,
    inlineElementPaddingToLineHeightClassName,
    shiftKeyOrAltKeyDownClassName,
    inlineMentionInputClassName,
} = contentEditorStyles;

// TODO(calebmer): Implement touch toolbar for mobile.

declare module "prosemirror-model" {
    // Augment `NodeType` with the undocumented `groups` array.
    interface NodeType {
        readonly groups: ReadonlyArray<string>;
    }
}

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

// TODO(calebmer): Make content editor SSR safe by rendering it as read-only on
// the server and mounting as editable on the client after hydration.

export type ContentEditorRef = {
    isFocused(): boolean;
    focus(): void;
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
     * Command for adding a comment to some range of text. If your schema supports
     * comment marks, you must provide this command to add them. `<ContentEditor>`
     * knows almost nothing about how comments are implemented, only how they
     * are styled.
     *
     * This does leak `EditorState` which normally we try to avoid but we find
     * it acceptable in this advanced case.
     */
    addCommentCommand?: Command;

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
    containerClassName,
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
        }),
        [],
    );

    return (
        <div className={classNames(containerClassName, containerClassName)}>
            <ContentView
                content={state.getContent()}
                placeholder={placeholder}
                className={className}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
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
        addCommentCommand,
    } = props;

    // Preload space accounts so when the user tries to mention one they
    // are available.
    //
    // Only preload space accounts outside of Jest unit tests! That way we don't
    // depend on space context in unit tests.
    if (typeof jest === "undefined") {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useExpensivelyPreloadAllSpaceAccounts();
    }

    // The props for the current React commit. We are integrating with a stateful
    // component (ProseMirror's `EditorView`) so we need to be able to
    // imperatively access props.
    //
    // Importantly, we set this in a `useLayoutEffect` instead of render! If we
    // set in render and concurrent React cancels/rebases/retries the render then
    // there may be bugs.
    //
    // Please avoid using `propsRef` unless you can thoroughly reason through why
    // it's safe!
    const propsRef = useRef(props);
    const navigate = useNavigate();
    const navigateRef = useRef(navigate);
    // Don't get the current account when running in a unit test so we don't need
    // to render a space context when testing this component.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const currentAccount = typeof jest === "undefined" ? useSpaceContext().currentAccount : null;
    const currentAccountRef = useRef(currentAccount);
    useLayoutEffect(() => {
        propsRef.current = props;
        navigateRef.current = navigate;
        currentAccountRef.current = currentAccount;
    });

    const elementRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    useImperativeHandle(
        editorRef,
        () => ({
            isFocused: () => {
                const view = assertExists(viewRef.current);
                return document.activeElement === view.dom;
            },
            focus: () => {
                const view = assertExists(viewRef.current);
                (view.dom as HTMLDivElement).focus();
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

    // Effect which initializes and destroys a ProseMirror editor view.
    //
    // Layout effect because the visual layout of this component depends on the
    // editor view being initialized.
    useLayoutEffect(() => {
        assert(elementRef.current);

        const initialState = unwrap(propsRef.current.state);
        const schema = initialState.doc.type.schema;

        const view = new EditorView(elementRef.current, {
            state: initialState,

            attributes: {
                // Native spellcheck is often more distracting then it's worth. It puts a red
                // squiggly under names, nouns, industry terms, and oddly sometimes
                // contractions (like "they're", maybe has to do with curly quotes?).
                //
                // NOTE(calebmer, 2022-12-29): Someday in the future we should build our own
                // spellchecker with (maybe) fancy large language model (GPT-3 style)
                // autocomplete.
                spellcheck: "false",
            },

            domParser: ContentEditorDomParser.fromSchema(schema),
            clipboardSerializer:
                ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
                    schema,
                    () => propsRef.current.state.getContent().references,
                ),
            clipboardTextSerializer: slice =>
                contentEditorTextClipboardSerializer(
                    slice,
                    () => propsRef.current.state.getContent().references,
                ),

            // IMPORTANT: If you have a custom view in `nodeViews` here you should also
            // have a matching custom renderer in `nodeRenderers` in
            // `renderContentToHtml()`.
            nodeViews: {
                orderedListItem: createContentEditorOrderedListItemNodeView,
                checkListItem: createContentEditorCheckListItemNodeView,
                mention: createContentEditorMentionNodeViewConstructor({
                    getCurrentAccount: () => currentAccountRef.current,
                }),
            },

            // IMPORTANT: If you have a custom view in `markViews` here you should also
            // have a matching custom renderer in `markRenderers` in
            // `renderContentToHtml()`.
            markViews: {
                link: createContentEditorLinkMarkViewConstructor({
                    onPointerEnterAfterDelay: ({mark, range}) => {
                        view.dispatch(
                            setContentEditorFloaterState(view.state.tr, {
                                type: "PointerLink",
                                key: generateId(),
                                mark,
                                range,
                                hasPointerLeftMark: false,
                            }),
                        );
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
                    (isMac ? event.metaKey : event.ctrlKey)
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
                    (!isMac || !event.ctrlKey) &&
                    // Cmd+Enter on MacOS platforms should trigger the callback
                    (isMac || !event.metaKey) &&
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

                setTransactionTimes(transactionTimes => ({
                    lastOptimisticTransactionTime: transaction.time,
                    lastSelectionChangeTransactionTime: !oldState.selection.eq(newState.selection)
                        ? transaction.time
                        : transactionTimes.lastSelectionChangeTransactionTime,
                }));
            },
        });

        // Stash the editor view instance on the DOM node for debugging and tests.
        (elementRef.current as any)[internalEditorViewKey] = view;

        viewRef.current = view;

        return () => {
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

        const actualState = unwrap(state);

        assert(viewRef.current);
        if (viewRef.current.state !== actualState) {
            viewRef.current.updateState(actualState);
        }

        updateEditorEmptyClass(actualState);
    }, [lastOptimisticTransactionTime, state]);

    const [decorationCallbacks, setDecorationCallbacks] = useState<
        ReadonlySet<(decorationSet: DecorationSet, state: EditorState) => DecorationSet>
    >(() => new Set());

    useLayoutEffect(() => {
        assert(viewRef.current);
        const view = viewRef.current;

        view.setProps({
            decorations: state => {
                let decorationSet = DecorationSet.empty;

                decorationSet = addEmojiDecorations(decorationSet, state.doc);

                for (const decorationCallback of decorationCallbacks) {
                    decorationSet = decorationCallback(decorationSet, state);
                }

                return decorationSet;
            },
        });
    }, [decorationCallbacks]);

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

    /**
     * Adds the `styles.empty` class if the editor document is empty and
     * removes the class when the editor document is not empty.
     */
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

        document.addEventListener("keydown", handleKeyDownOrUp);
        document.addEventListener("keyup", handleKeyDownOrUp);

        return () => {
            document.removeEventListener("keydown", handleKeyDownOrUp);
            document.removeEventListener("keyup", handleKeyDownOrUp);
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
            return decorationSet.add(
                state.doc,
                createSelectionDecorations(
                    state.doc,
                    state.selection,
                    colorSchemeVars["grey-selection"],
                ),
            );
        };

        const handleFocus = () => {
            setIsFocused(true);

            viewElement.classList.remove(hideSelectionWhileUnfocusedClassName);

            setDecorationCallbacks(decorationCallbacks => {
                const newDecorationCallbacks = new Set(decorationCallbacks);
                newDecorationCallbacks.delete(blurDecorationCallback);
                return newDecorationCallbacks;
            });
        };

        const handleBlur = () => {
            setIsFocused(false);

            viewElement.classList.add(hideSelectionWhileUnfocusedClassName);

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

    return (
        <div
            ref={elementRef}
            className={classNames(containerClassName, customContainerClassName)}
            onFocus={onFocus}
            onBlur={onBlur}
        >
            <ContentEditorFloater
                state={unwrap(state)}
                viewRef={viewRef}
                floaterState={floaterState}
                setFloaterState={floaterState => {
                    const view = assertExists(viewRef.current);
                    view.dispatch(setContentEditorFloaterState(view.state.tr, floaterState));
                }}
                isFocused={isFocused}
                lastSelectionChangeTransactionTime={lastSelectionChangeTransactionTime}
                addCommentCommand={addCommentCommand ?? null}
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
    assert(typeof jest !== "undefined");
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
