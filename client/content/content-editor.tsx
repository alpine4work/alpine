// ProseMirror includes some lightweight styling that's required for it to
// work correctly.
import "prosemirror-view/style/prosemirror.css";

import classNames from "classnames";
import {collab, getVersion, receiveTransaction, sendableSteps} from "prosemirror-collab";
import {history} from "prosemirror-history";
import {Node, Slice} from "prosemirror-model";
import {EditorState, Plugin, PluginKey, Transaction} from "prosemirror-state";
import {Step} from "prosemirror-transform";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {
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
    containerClassName,
    emptyBodyClassName,
    emptyTitleClassName,
    hideSelectionWhileUnfocusedClassName,
    unfocusedSelectionClassName,
} from "~/client/content/content-editor.css";
import {createContentEditorCheckListItemNodeView} from "~/client/content/internal/content-editor-check-list-item-node-view";
import {ContentEditorDomClipboardSerializer} from "~/client/content/internal/content-editor-dom-clipboard-serializer";
import {ContentEditorDomParser} from "~/client/content/internal/content-editor-dom-parser";
import {
    ContentEditorFloater,
    initialContentEditorFloaterState,
} from "~/client/content/internal/content-editor-floater";
import {createContentEditorMarkNodeViewConstructor} from "~/client/content/internal/content-editor-link-node-view";
import {createContentEditorOrderedListItemNodeView} from "~/client/content/internal/content-editor-ordered-list-item-node-view";
import {buildInputRulesPlugin} from "~/client/content/internal/content-editor-plugin-input-rules";
import {
    buildKeymapPlugin,
    openKeyboardHighlightFloaterMetaKey,
    openKeyboardLinkFloaterMetaKey,
} from "~/client/content/internal/content-editor-plugin-keymap";
import {trimSpacesFromRange} from "~/client/content/internal/content-editor-prosemirror-helpers";
import {FocusRingPortal} from "~/client/design/focus-ring";
import {isMac} from "~/client/helpers/platform/is-mac";
import {
    ContentProsemirrorSchema,
    doesUrlStartWithAllowedProtocol,
} from "~/shared/content/content-schema";
import {docClassName} from "~/shared/content/content-schema.css";
import {documentFallbackTitle} from "~/shared/documents/document-model";
import {assert} from "~/shared/helpers/control/assert";
import {Id, generateId, isId} from "~/shared/id/id";

// TODO(calebmer): Implement touch toolbar for mobile.

declare module "prosemirror-model" {
    // Augment `NodeType` with the undocumented `groups` array.
    interface NodeType {
        readonly groups: ReadonlyArray<string>;
    }
}

function buildPlugins(schema: ContentProsemirrorSchema) {
    return [history(), buildInputRulesPlugin(schema), buildKeymapPlugin(schema)];
}

/**
 * Represents the entire state of our `<ContentEditor>` component.
 *
 * We have a wrapper to require the user of certain plugins.
 *
 * Wraps around ProseMirror's own `EditorState` and provides a controlled
 * interface to the outside world.
 */
export class ContentEditorState<Content extends Node> {
    /**
     * Creates a new state for our content editor.
     */
    public static create<Content extends Node>(content: Content): ContentEditorState<Content> {
        assert(content.type.schema.topNodeType === content.type);

        const plugins = buildPlugins(content.type.schema);

        return new ContentEditorState(
            EditorState.create({
                doc: content,
                plugins,
            }),
        );
    }

    /**
     * Creates a new collaborative state for our content editor.
     */
    public static createCollab<Content extends Node>({
        version,
        content,
    }: {
        /**
         * The content version for collaborative editing.
         */
        version: number;

        /**
         * The initial content in the editor. If no content is provided then we
         * start with empty content.
         */
        content: Content;
    }): ContentEditorState<Content> {
        assert(content.type.schema.topNodeType === content.type);

        const plugins = [
            ...buildPlugins(content.type.schema),
            collab({
                clientID: generateId(),
                version,
            }),
        ];

        const state = new ContentEditorState<Content>(
            EditorState.create({
                doc: content,
                plugins,
            }),
        );

        assert(state.isCollab());
        return state;
    }

    private readonly _state: EditorState;

    private constructor(state: EditorState) {
        this._state = state;
    }

    /**
     * The current content rendered in the editor.
     *
     * Our state contains more information than just the content. For instance,
     * the cursor position.
     */
    public getContent(): Content {
        return this._state.doc as Content;
    }

    /**
     * Is this content editor state collaborative?
     */
    public isCollab() {
        return isCollabPlugin(this._state.plugins[this._state.plugins.length - 1]!);
    }

    /**
     * Get the current version of our content for collaborative editing.
     *
     * May only call this method if the content editor state is collaborative.
     * (Can check with `isCollab()`.)
     */
    public getVersion(): number {
        assert(this.isCollab());
        return getVersion(this._state);
    }

    /**
     * Provides the unconfirmed steps for this content that we need to send to
     * a central authority.
     *
     * May only call this method if the content editor state is collaborative.
     * (Can check with `isCollab()`.)
     */
    public sendableSteps(): {
        version: number;
        steps: ReadonlyArray<Step>;
        origins: ReadonlyArray<Transaction>;
        clientId: Id;
    } | null {
        assert(this.isCollab());

        const result = sendableSteps(this._state);
        if (!result) return null;

        assert(typeof result.clientID === "string" && isId(result.clientID));

        return {
            version: result.version,
            steps: result.steps,
            origins: result.origins,
            clientId: result.clientID,
        };
    }

    /**
     * Receive steps that originated from a `sendableSteps()` call.
     *
     * May only call this method if the content editor state is collaborative.
     * (Can check with `isCollab()`.)
     */
    public receiveSteps(steps: Iterable<{step: Step; clientId: Id}>): ContentEditorState<Content> {
        assert(this.isCollab());

        const stepsWithoutClientId = [];
        const clientIds = [];

        for (const {step, clientId} of steps) {
            stepsWithoutClientId.push(step);
            clientIds.push(clientId);
        }

        const transaction = receiveTransaction(this._state, stepsWithoutClientId, clientIds, {
            // Users usually prefer this, but it isn't done by default for reasons
            // of backwards compatibility.
            mapSelectionBackward: true,
        });

        return wrap(this._state.apply(transaction));
    }
}

function wrap<Content extends Node>(state: EditorState): ContentEditorState<Content> {
    // @ts-expect-error it's ok to wrap/unwrap editor state in this file.
    return new ContentEditorState(state);
}

function unwrap(state: ContentEditorState<Node>): EditorState {
    // @ts-expect-error it's ok to wrap/unwrap editor state in this file.
    return state._state;
}

// TODO(calebmer): Make content editor SSR safe by rendering it as read-only on
// the server and mounting as editable on the client after hydration.

export type ContentEditorRef = {
    focus(): void;
    blur(): void;
};

const ContentEditorForwardRef = forwardRef(ContentEditor) as <Content extends Node>(
    props: PropsWithoutRef<ContentEditorProps<Content>> & RefAttributes<ContentEditorRef>,
) => ReactElement;
export {ContentEditorForwardRef as ContentEditor};

export type ContentEditorProps<Content extends Node> = {
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
     * Providing an `onEnter` callback will prevent the default enter behavior.
     * It will also switch our editor out of multiline mode for assistive
     * technologies.
     *
     * Pressing Shift+Enter will insert a hard line break and won't trigger this
     * callback. Pasting in content with multiple paragraphs also allows you to
     * add multiple lines. So providing `onEnter` doesn't make our editor fully
     * single lined.
     */
    onEnter?: () => void;

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
    onFocus?: () => void;

    /**
     * Event fired when the user unfocuses the content editor.
     */
    onBlur?: () => void;

    /**
     * Fired when the user presses the escape key.
     */
    onEscape?: () => void;
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

/**
 * A rich text collaborative editor powered by [ProseMirror][1].
 *
 * ProseMirror fits well with the React component model as its state is fully
 * immutable. This means we can fully manage the state in React as we would with
 * any other component.
 *
 * [1]: https://prosemirror.net
 */
function ContentEditor<Content extends Node>(
    props: ContentEditorProps<Content>,
    ref: Ref<ContentEditorRef>,
) {
    const {
        state,
        placeholder,
        className,
        containerClassName: customContainerClassName,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        onFocus,
        onBlur,
    } = props;
    const hasEnterCallback = typeof props.onEnter === "function";

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
    useLayoutEffect(() => {
        propsRef.current = props;
    });

    const elementRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    useImperativeHandle(
        ref,
        () => ({
            focus: () => {
                (viewRef.current?.dom as HTMLDivElement).focus();
            },
            blur: () => {
                (viewRef.current?.dom as HTMLDivElement).blur();
            },
        }),
        [],
    );

    const [isFocused, setIsFocused] = useState(false);

    const [{lastTransactionTime, lastSelectionChangeTransactionTime}, setTransactionTimes] =
        useState<{
            lastTransactionTime: number | null;
            lastSelectionChangeTransactionTime: number | null;
        }>({
            lastTransactionTime: null,
            lastSelectionChangeTransactionTime: null,
        });

    const [floaterState, setFloaterState] = useState(initialContentEditorFloaterState);

    // Effect which initializes and destroys a ProseMirror editor view.
    //
    // Layout effect because the visual layout of this component depends on the
    // editor view being initialized.
    useLayoutEffect(() => {
        assert(elementRef.current);

        const state = unwrap(propsRef.current.state);
        const schema = state.doc.type.schema;

        const view = new EditorView(elementRef.current, {
            state,

            domParser: ContentEditorDomParser.fromSchema(schema),
            clipboardSerializer: ContentEditorDomClipboardSerializer.fromSchema(schema),

            nodeViews: {
                orderedListItem: createContentEditorOrderedListItemNodeView,
                checkListItem: createContentEditorCheckListItemNodeView,
            },

            markViews: {
                link: createContentEditorMarkNodeViewConstructor({
                    onPointerEnterAfterDelay: ({mark, range}) =>
                        setFloaterState({
                            type: "PointerLink",
                            mark,
                            range,
                            hasPointerLeftMark: false,
                        }),
                    onPointerEnter: mark =>
                        setFloaterState(floaterState =>
                            floaterState.type === "PointerLink" && floaterState.mark.eq(mark)
                                ? {...floaterState, hasPointerLeftMark: false}
                                : floaterState,
                        ),
                    onPointerLeave: mark =>
                        setFloaterState(floaterState =>
                            floaterState.type === "PointerLink" && floaterState.mark.eq(mark)
                                ? {...floaterState, hasPointerLeftMark: true}
                                : floaterState,
                        ),
                }),
            },

            handlePaste,

            // If we have an `onEnter` callback then we want to run that instead of
            // letting ProseMirror handle an enter key press.
            handleKeyDown(_view, event) {
                if (
                    typeof propsRef.current.onEnter === "function" &&
                    event.key === "Enter" &&
                    !event.altKey &&
                    !event.shiftKey &&
                    // Ctrl+Enter on non-MacOS platforms should trigger the callback
                    (!isMac || !event.ctrlKey) &&
                    // Cmd+Enter on MacOS platforms should trigger the callback
                    (isMac || !event.metaKey)
                ) {
                    event.preventDefault();
                    propsRef.current.onEnter();
                    return true;
                }

                if (typeof propsRef.current.onEscape === "function" && event.key === "Escape") {
                    event.preventDefault();
                    propsRef.current.onEscape();
                    return true;
                }

                return false;
            },

            dispatchTransaction(transaction) {
                const oldState = view.state;

                // By default, applying a transaction will clear the editor's stored
                // marks. We don't want that behavior! Instead we want to preserve marks
                // until a user explicitly toggles them off.
                if (oldState.storedMarks && !transaction.storedMarksSet) {
                    transaction.setStoredMarks(oldState.storedMarks);
                }

                const newState = oldState.apply(transaction);

                // Always calls the handler from the last React commit. By using a ref
                // we can avoid destroying and recreating an editor.
                propsRef.current.onChange(wrap(newState), transaction);

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
                // We update the `lastTransactionTime` state to re-run an effect below
                // which reconciles the editor view state with the state we get from
                // props. That way if our optimistic update is wrong we'll fix it when
                // React commits.
                //
                // [1]: https://prosemirror.net/docs/guide/#view
                view.updateState(newState);
                updateEditorEmptyClass(newState);

                setTransactionTimes(transactionTimes => ({
                    lastTransactionTime: transaction.time,
                    lastSelectionChangeTransactionTime: !oldState.selection.eq(newState.selection)
                        ? transaction.time
                        : transactionTimes.lastSelectionChangeTransactionTime,
                }));

                // Open our special toolbars regardless of whether our parent
                // component acknowledges the new state from this transaction.
                if (transaction.getMeta(openKeyboardHighlightFloaterMetaKey)) {
                    setFloaterState({type: "KeyboardHighlight"});
                }
                if (transaction.getMeta(openKeyboardLinkFloaterMetaKey)) {
                    setFloaterState({type: "KeyboardLink"});
                }
            },
        });

        // Stash the editor view instance on the DOM node for debugging and tests.
        (elementRef.current as any)[internalEditorViewKey] = view;

        viewRef.current = view;

        return () => {
            view.destroy();
        };
    }, []);

    // Effect which reconciles our editor state prop with the imperative editor
    // view state.
    //
    // Layout effect because the visual layout depends on the editor state prop
    // which we need to set imperatively.
    useLayoutEffect(() => {
        // We don't do anything with `lastTransactionTime` in this effect, but we
        // want the effect to re-run whenever it changes. We optimistically update
        // our `EditorView` state as an optimization. When React finishes committing
        // we reconcile the prop state with the `EditorView` state in this effect.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        lastTransactionTime;

        const actualState = unwrap(state);

        assert(viewRef.current);
        if (viewRef.current.state !== actualState) {
            viewRef.current.updateState(actualState);
        }

        updateEditorEmptyClass(actualState);
    }, [lastTransactionTime, state]);

    const [decorationCallbacks, setDecorationCallbacks] = useState<
        ReadonlySet<(decorationSet: DecorationSet, state: EditorState) => DecorationSet>
    >(() => new Set());

    useLayoutEffect(() => {
        assert(viewRef.current);
        const view = viewRef.current;

        view.setProps({
            decorations: state => {
                let decorationSet = DecorationSet.empty;

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

    // Keep various attributes on the editor element up to date.
    useLayoutEffect(() => {
        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        // Set the role for assistive technologies. For documentation see:
        // https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/textbox_role
        viewElement.setAttribute("role", "textbox");
        viewElement.setAttribute("aria-multiline", hasEnterCallback ? "false" : "true");

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
    }, [ariaLabel, ariaLabelledBy, hasEnterCallback]);

    const isTitleEmpty = isContentTitleEmpty(state.getContent());
    const isBodyEmpty = isContentBodyEmpty(state.getContent());

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
            return decorationSet.add(state.doc, [
                Decoration.inline(state.selection.from, state.selection.to, {
                    class: unfocusedSelectionClassName,
                }),
            ]);
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
        // We don't do anything with `lastTransactionTime` in this effect, but we
        // want the effect to re-run whenever it changes. We optimistically update
        // our `EditorView` state as an optimization. When React finishes committing
        // we reconcile the prop state with the `EditorView` state in this effect.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        lastTransactionTime;

        assert(viewRef.current);
        const viewElement = viewRef.current.dom;

        // Keep track of the element ProseMirror marks as selected with the
        // `ProseMirror-selectednode` CSS class so that we can render our own custom
        // ring around it.
        //
        // TODO(calebmer): Test that the selected element ring moves when
        // collaboratively editing.
        const selectedNodeElement = viewElement.getElementsByClassName(
            "ProseMirror-selectednode",
        )[0];
        if (selectedNodeElement instanceof HTMLElement) {
            setSelectedNodeElement(selectedNodeElement);
        } else {
            setSelectedNodeElement(null);
        }
    }, [lastTransactionTime]);

    return (
        <>
            <div
                ref={elementRef}
                className={classNames(containerClassName, customContainerClassName)}
                onFocus={onFocus}
                onBlur={onBlur}
            />
            <ContentEditorFloater
                state={unwrap(state)}
                viewRef={viewRef}
                floaterState={floaterState}
                setFloaterState={setFloaterState}
                isFocused={isFocused}
                lastSelectionChangeTransactionTime={lastSelectionChangeTransactionTime}
            />
            {selectedNodeElement && (
                // TODO(calebmer): If you type "foo" in the title, then "bar" in the body, then
                // put your cursor at the beginning of "bar" and hit backspace it selects the
                // title node and it looks weird. (Make sure there are no paragraphs
                // after "bar".)
                <FocusRingPortal element={selectedNodeElement} />
            )}
        </>
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
    if (url && !doesUrlStartWithAllowedProtocol(url)) {
        return false;
    }

    // 3. Instead of replacing the selected text with the replaced text we instead
    // add a link mark to the selection.
    const range = trimSpacesFromRange(state.doc, state.selection);
    view.dispatch(state.tr.addMark(range.from, range.to, state.schema.mark("link", {url})));
    return true;
}

let collabPluginKey: PluginKey;

/**
 * Is the provided plugin a `prosemirror-collab` plugin?
 */
function isCollabPlugin(plugin: Plugin) {
    if (collabPluginKey === undefined) {
        const {key} = collab().spec;
        assert(key);
        collabPluginKey = key;
    }
    return plugin.spec.key === collabPluginKey;
}

function isContentTitleEmpty(node: Node): boolean {
    assert(node.type.name === "doc");
    if (!node.type.schema.nodes.title) return true;
    const firstChildNode = node.child(0);
    return firstChildNode.type.name === "title" && firstChildNode.content.size === 0;
}

function isContentBodyEmpty(node: Node): boolean {
    assert(node.type.name === "doc");

    let bodyChildNode;
    if (!node.type.schema.nodes.title) {
        if (node.childCount !== 1) return false;
        bodyChildNode = node.child(0);
    } else {
        if (node.childCount !== 2) return false;
        bodyChildNode = node.child(1);
    }

    return bodyChildNode.type.name === "paragraph" && bodyChildNode.content.size === 0;
}
