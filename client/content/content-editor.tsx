// ProseMirror includes some lightweight styling that's required for it to
// work correctly.
import "prosemirror-view/style/prosemirror.css";

import classNames from "classnames";
import {collab, getVersion, receiveTransaction, sendableSteps} from "prosemirror-collab";
import {history} from "prosemirror-history";
import {Node, Slice} from "prosemirror-model";
import {EditorState, Plugin, PluginKey, Transaction} from "prosemirror-state";
import {Step} from "prosemirror-transform";
import {EditorView} from "prosemirror-view";
import {Ref, forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState} from "react";
import {createContentEditorCheckListItemNodeView} from "~/client/content/content-editor-check-list-item-node-view";
import {ContentEditorDomClipboardSerializer} from "~/client/content/content-editor-dom-clipboard-serializer";
import {ContentEditorDomParser} from "~/client/content/content-editor-dom-parser";
import {
    ContentEditorFloater,
    initialContentEditorFloaterState,
} from "~/client/content/content-editor-floater";
import {createContentEditorLinkNodeViewConstructor} from "~/client/content/content-editor-link-node-view";
import {createContentEditorOrderedListItemNodeView} from "~/client/content/content-editor-ordered-list-item-node-view";
import {buildInputRulesPlugin} from "~/client/content/content-editor-plugin-input-rules";
import {
    buildKeymapPlugin,
    openKeyboardHighlightFloaterMetaKey,
    openKeyboardLinkFloaterMetaKey,
} from "~/client/content/content-editor-plugin-keymap";
import {emptyContentEditorClassName} from "~/client/content/content-editor.css";
import {isMac} from "~/client/helpers/platform/is-mac";
import {
    ContentSchema,
    emptyContent,
    startsWithAllowedProtocol,
} from "~/shared/content/content-schema";
import {docClassName} from "~/shared/content/content-schema.css";
import {assert} from "~/shared/helpers/control/assert";
import {Id, generateId} from "~/shared/id/id";

declare module "prosemirror-model" {
    // Augment `NodeType` with the undocumented `groups` array.
    interface NodeType {
        readonly groups: ReadonlyArray<string>;
    }
}

let cachedPlugins: Array<Plugin>;

function buildPlugins() {
    if (cachedPlugins === undefined) {
        cachedPlugins = [history(), buildInputRulesPlugin(), buildKeymapPlugin()];
    }
    return cachedPlugins;
}

/**
 * Represents the entire state of our `<ContentEditor>` component.
 *
 * We have a wrapper to require the user of certain plugins.
 *
 * Wraps around ProseMirror's own `EditorState` and provides a controlled
 * interface to the outside world.
 */
export class ContentEditorState {
    /**
     * Creates a new state for our content editor.
     */
    public static create(content: Node = emptyContent) {
        const plugins = buildPlugins();

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
    public static createCollab({
        version = 0,
        content = emptyContent,
    }: {
        /**
         * The content version for collaborative editing.
         */
        version?: number;

        /**
         * The initial content in the editor. If no content is provided then we
         * start with empty content.
         */
        content?: Node;
    } = {}) {
        const plugins = [
            ...buildPlugins(),
            collab({
                clientID: generateId(),
                version,
            }),
        ];

        const state = new ContentEditorState(
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
     * The current document rendered in the editor.
     *
     * Our state contains more information than just the document. For instance,
     * the cursor position.
     */
    public get doc(): Node {
        return this._state.doc;
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
    } | null {
        assert(this.isCollab());

        const result = sendableSteps(this._state);
        if (!result) return null;

        return {
            version: result.version,
            steps: result.steps,
            origins: result.origins,
        };
    }

    /**
     * Receive steps that originated from a `sendableSteps()` call.
     *
     * May only call this method if the content editor state is collaborative.
     * (Can check with `isCollab()`.)
     */
    public receiveSteps(clientId: Id, steps: Array<Step>): ContentEditorState {
        assert(this.isCollab());

        const transaction = receiveTransaction(
            this._state,
            steps,
            steps.map(() => clientId),
            {
                // Users usually prefer this, but it isn't done by default for reasons
                // of backwards compatibility.
                mapSelectionBackward: true,
            },
        );

        return wrap(this._state.apply(transaction));
    }
}

function wrap(state: EditorState): ContentEditorState {
    // @ts-expect-error it's ok to wrap/unwrap editor state in this file.
    return new ContentEditorState(state);
}

function unwrap(state: ContentEditorState): EditorState {
    // @ts-expect-error it's ok to wrap/unwrap editor state in this file.
    return state._state;
}

// TODO(calebmer): Style for node selection? You can enter into this by double
// clicking on a list item.

// TODO(calebmer): Make content editor SSR safe by rendering it as read-only on
// the server and mounting as editable on the client after hydration.

export type ContentEditorRef = {
    focus(): void;
    blur(): void;
};

const ContentEditorForwardRef = forwardRef(ContentEditor);
export {ContentEditorForwardRef as ContentEditor};

export type ContentEditorProps = {
    /**
     * The current state of our content editor.
     *
     * Mostly the content editor state is a wrapper around ProseMirror's immutable
     * `EditorState` with some type safety and helper functions.
     */
    state: ContentEditorState;

    /**
     * Fired whenever the content editor's state changes.
     *
     * Every state change will be optimistically synchronously applied to the
     * DOM. If you don't re-render with the new state then that optimistic
     * update will be reverted.
     */
    onChange: (
        state: ContentEditorState,
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
function ContentEditor(props: ContentEditorProps, ref: Ref<ContentEditorRef>) {
    const {
        state,
        placeholder,
        className,
        containerClassName,
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

    const [lastTransactionTime, setLastTransactionTime] = useState(Date.now());
    const [floaterState, setFloaterState] = useState(initialContentEditorFloaterState);

    // Effect which initializes and destroys a ProseMirror editor view.
    //
    // Layout effect because the visual layout of this component depends on the
    // editor view being initialized.
    useLayoutEffect(() => {
        assert(elementRef.current);

        const view = new EditorView(elementRef.current, {
            state: unwrap(propsRef.current.state),

            domParser: ContentEditorDomParser.fromSchema(ContentSchema),
            clipboardSerializer: ContentEditorDomClipboardSerializer.fromSchema(ContentSchema),

            nodeViews: {
                orderedListItem: createContentEditorOrderedListItemNodeView,
                checkListItem: createContentEditorCheckListItemNodeView,
                link: createContentEditorLinkNodeViewConstructor({
                    onPreviewShow: pos => setFloaterState({type: "PointerLink", pos}),
                    onPreviewHide: () => setFloaterState(initialContentEditorFloaterState),
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
                // By default, applying a transaction will clear the editor's stored
                // marks. We don't want that behavior! Instead we want to preserve marks
                // until a user explicitly toggles them off.
                if (view.state.storedMarks && !transaction.storedMarksSet) {
                    transaction.setStoredMarks(view.state.storedMarks);
                }

                const newState = view.state.apply(transaction);

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
                setLastTransactionTime(transaction.time);

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

    // Apply `className`s from our `className` prop. Take care to make sure class
    // names added by ProseMirror or other effects continue to be applied.
    useLayoutEffect(() => {
        assert(viewRef.current);
        const editorElement = viewRef.current.dom;

        const classList = classNames(docClassName, className).split(" ");
        editorElement.classList.add(...classList);

        return () => {
            editorElement.classList.remove(...classList);
        };
    }, [className]);

    /**
     * Adds the `styles.empty` class if the editor document is empty and
     * removes the class when the editor document is not empty.
     */
    function updateEditorEmptyClass(state: EditorState) {
        assert(viewRef.current);
        const editorElement = viewRef.current.dom;

        const showPlaceholder = shouldShowPlaceholder(state.doc);

        if (showPlaceholder && !editorElement.classList.contains(emptyContentEditorClassName)) {
            editorElement.classList.add(emptyContentEditorClassName);
        }

        if (!showPlaceholder && editorElement.classList.contains(emptyContentEditorClassName)) {
            editorElement.classList.remove(emptyContentEditorClassName);
        }
    }

    // Keep various attributes on the editor element up to date.
    useLayoutEffect(() => {
        assert(viewRef.current);
        const editorElement = viewRef.current.dom;

        // Set the role for assistive technologies. For documentation see:
        // https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/textbox_role
        editorElement.setAttribute("role", "textbox");
        editorElement.setAttribute("aria-multiline", hasEnterCallback ? "false" : "true");

        if (ariaLabel) {
            editorElement.setAttribute("aria-label", ariaLabel);
        } else {
            editorElement.removeAttribute("aria-label");
        }

        if (ariaLabelledBy) {
            editorElement.setAttribute("aria-labelledby", ariaLabelledBy);
        } else {
            editorElement.removeAttribute("aria-labelledby");
        }

        // Our `content-editor.module.css` file uses the `aria-placeholder`
        // attribute to render placeholder text.
        if (placeholder) {
            editorElement.setAttribute("aria-placeholder", placeholder);
        } else {
            editorElement.removeAttribute("aria-placeholder");
        }
    }, [ariaLabel, ariaLabelledBy, hasEnterCallback, placeholder]);

    // TODO(calebmer): Make this component SSR safe! All the `useLayoutEffect()`s
    // are logging warnings on the server and they're right.
    return (
        <>
            <div
                ref={elementRef}
                className={containerClassName}
                onFocus={onFocus}
                onBlur={onBlur}
            />
            <ContentEditorFloater
                state={unwrap(state)}
                viewRef={viewRef}
                floaterState={floaterState}
                setFloaterState={setFloaterState}
            />
        </>
    );
}

// Inspired by [React internal keys][1].
//
// [1]: https://github.com/facebook/react/blob/80c4dea0d1da0012977c6c4b2ac7a8bd37154d50/packages/react-dom/src/client/ReactDOMComponentTree.js#L34-L41
const internalEditorViewKey = `__prosemirrorEditorView$${Math.random().toString(36).slice(2)}`;

export function getEditorViewForTest(element: unknown): EditorView {
    assert(process.env.NODE_ENV === "test");
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
        view.state.selection.$from.node().type === ContentSchema.nodes.paragraph &&
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
    if (url && !startsWithAllowedProtocol(url)) {
        return false;
    }

    // 3. Instead of replacing the selected text with the replaced text we instead
    // add a link mark to the selection.
    view.dispatch(
        state.tr.addMark(
            state.selection.from,
            state.selection.to,
            ContentSchema.mark("link", {url}),
        ),
    );
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

/**
 * Should we show the placeholder text for this content?
 */
function shouldShowPlaceholder(node: Node): boolean {
    assert(node.type.name === "doc");
    return (
        node.childCount <= 1 &&
        (!node.firstChild ||
            (node.firstChild.type === ContentSchema.nodes.paragraph &&
                node.firstChild.content.size <= 0))
    );
}
