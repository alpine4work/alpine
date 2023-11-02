import {AllSelection, EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {Ref, forwardRef, useCallback, useImperativeHandle, useInsertionEffect, useRef} from "react";
import {ySyncPlugin, ySyncPluginKey, yUndoPlugin} from "y-prosemirror";
import * as Y from "yjs";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useTaskTitleModelYDoc} from "~/client/tasks/internal/use_task_title_model_y_doc.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {fontSizes, sprinkles, tasksStyles} from "~/shared/styles/styles.js";
import {TaskTitleModel} from "~/shared/tasks/model/task_title_model.js";
import {TaskTitleProsemirrorSchema, TaskTitleUpdate} from "~/shared/tasks/task_title.js";

export type TaskDetailTitleInputRef = {
    isFocused(): boolean;
    focusAll(): void;
};

const taskDetailTitleInputAriaLabel = "Title";

const taskDetailTitleInputClassName = `ProseMirror ${sprinkles({
    fontSize: "300",
    fontStyle: "semi-bold",
    userSelect: "text",
})} ${tasksStyles.detailTitleInputPlaceholderClassName}`;

const TaskDetailTitleInputForwardRef = forwardRef(TaskDetailTitleInput);
export {TaskDetailTitleInputForwardRef as TaskDetailTitleInput};

function TaskDetailTitleInput(
    {
        title,
        onTitleChange,
        placeholder,
        isReadOnly,
        pushUndoStackYDocEntry,
        pushUndoStackYDocEntryFromRedo,
        pushRedoStackYDocEntry,
    }: {
        title: TaskTitleModel;
        onTitleChange: (titleUpdate: TaskTitleUpdate) => void;
        placeholder: string;
        isReadOnly: boolean;
        pushUndoStackYDocEntry: (entry: {yUndoManager: Y.UndoManager; release: () => void}) => void;
        pushUndoStackYDocEntryFromRedo: (entry: {
            yUndoManager: Y.UndoManager;
            release: () => void;
        }) => void;
        pushRedoStackYDocEntry: (entry: {yUndoManager: Y.UndoManager; release: () => void}) => void;
    },
    ref: Ref<TaskDetailTitleInputRef>,
) {
    const isInitialAppRender = useIsInitialAppRender();

    const viewRef = useRef<
        | {isReady: false; callbacks: Array<(view: EditorView) => void>}
        | {isReady: true; view: EditorView}
    >({isReady: false, callbacks: []});

    const titleYDoc = useTaskTitleModelYDoc({
        title,
        onTitleChange,
        pushUndoStackYDocEntry,
        pushUndoStackYDocEntryFromRedo,
        pushRedoStackYDocEntry,
    });

    const titleRef = useRef(title);
    const isReadOnlyRef = useRef(isReadOnly);
    useInsertionEffect(() => {
        titleRef.current = title;
        isReadOnlyRef.current = isReadOnly;
    });

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
    useInsertionEffect(
        (rootElement?: HTMLDivElement) => {
            // Wait for the client-side rerender before mounting our editor.
            if (isInitialAppRender) return;

            const containerElement = assertExists(rootElement?.firstElementChild);
            assert(containerElement.childElementCount === 0);

            // Make sure our undo manager sees transactions originating from our
            // `EditorView`.
            titleYDoc.getUndoManager().addTrackedOrigin(ySyncPluginKey);

            const viewElement = document.createElement("div");
            containerElement.appendChild(viewElement);

            // Set the role for assistive technologies. For documentation see:
            // https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/textbox_role
            viewElement.role = "textbox";

            viewElement.ariaLabel = taskDetailTitleInputAriaLabel;
            viewElement.className = taskDetailTitleInputClassName;

            const view = new EditorView(
                {mount: viewElement},
                {
                    state: EditorState.create({
                        schema: TaskTitleProsemirrorSchema,
                        // Make sure we start with the correct initial document. After this the
                        // `ySyncPlugin` manages document state.
                        doc: titleRef.current.getProsemirrorNode(),
                        plugins: [
                            ySyncPlugin(titleYDoc.getXmlFragment("doc")),
                            // We install the Y.js undo plugin but we don't install the `undo`/`redo`
                            // commands from `y-prosemirror` in a keymap. Instead `useTaskTitleModelYDoc()`
                            // registers us with our global undo stack.
                            yUndoPlugin({undoManager: titleYDoc.getUndoManager()}),
                        ],
                    }),

                    // Disable editing when the `isReadOnly` prop is set.
                    editable: () => !isReadOnlyRef.current,

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
                        spellcheck: "false",
                    },

                    dispatchTransaction: transaction => {
                        const oldTitleState = view.state;
                        const newTitleState = oldTitleState.apply(transaction);

                        updateEditorEmptyClass(newTitleState);

                        view.updateState(newTitleState);
                    },
                },
            );

            // Update `viewRef` and call any callbacks that were waiting for the view to
            // be ready.
            {
                const callbacks = !viewRef.current.isReady ? viewRef.current.callbacks : [];

                viewRef.current = {isReady: true, view};

                for (const callback of callbacks) {
                    callback(view);
                }
            }

            const updateEditorEmptyClass = (state: EditorState) => {
                const addEmptyClassName = state.doc.childCount === 0;
                if (
                    addEmptyClassName &&
                    !containerElement.classList.contains(
                        tasksStyles.detailTitleInputEmptyContainerClassName,
                    )
                ) {
                    containerElement.classList.add(
                        tasksStyles.detailTitleInputEmptyContainerClassName,
                    );
                }
                if (
                    !addEmptyClassName &&
                    containerElement.classList.contains(
                        tasksStyles.detailTitleInputEmptyContainerClassName,
                    )
                ) {
                    containerElement.classList.remove(
                        tasksStyles.detailTitleInputEmptyContainerClassName,
                    );
                }
            };

            updateEditorEmptyClass(view.state);

            return () => {
                viewRef.current = {isReady: false, callbacks: []};
                view.destroy();
            };

            // IMPORTANT: We want to maintain the `EditorView` instance during updates. Be
            // careful about what you put in here. Ideally we never destroy the
            // `EditorView` while this component is mounted.
        },
        [isInitialAppRender, titleYDoc],
    );

    const runWhenViewIsReady = useCallback((run: (view: EditorView) => void) => {
        if (viewRef.current.isReady) {
            run(viewRef.current.view);
        } else {
            viewRef.current.callbacks.push(run);
        }
    }, []);

    useLayoutEffectWithoutServerSideWarning(() => {
        runWhenViewIsReady(view => {
            if (!placeholder) {
                view.dom.removeAttribute("aria-placeholder");
            } else {
                view.dom.setAttribute("aria-placeholder", placeholder);
            }
        });
    }, [placeholder, runWhenViewIsReady]);

    useImperativeHandle(
        ref,
        () => ({
            isFocused: () => {
                if (!viewRef.current.isReady) return false;
                return viewRef.current.view.dom === document.activeElement;
            },
            focusAll: () => {
                runWhenViewIsReady(view => {
                    const selection = new AllSelection(view.state.doc);

                    view.focus();
                    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
                });
            },
        }),
        [runWhenViewIsReady],
    );

    return (
        <div>
            <FocusRing isVisibleWhenFocusWithin>
                <div
                    className={sprinkles({
                        position: "relative",
                        zIndex: "0",
                        color: "grey-text",
                    })}
                    style={{minHeight: fontSizes["300"].lineHeight}}
                >
                    {isInitialAppRender && (
                        // On server-side render serialize our title to HTML since we can't mount an
                        // `EditorView` until we are on the client.
                        <div
                            className={taskDetailTitleInputClassName}
                            aria-label={taskDetailTitleInputAriaLabel}
                            aria-placeholder={placeholder}
                            dangerouslySetInnerHTML={{
                                __html: serializeProsemirrorFragmentToHtml(
                                    titleRef.current.getProsemirrorNode().content,
                                ),
                            }}
                        />
                    )}
                </div>
            </FocusRing>
        </div>
    );
}
