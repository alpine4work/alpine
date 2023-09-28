import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {useCallback, useRef} from "react";
import {ySyncPlugin} from "y-prosemirror";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useTaskTitleModelYDoc} from "~/client/tasks/internal/use_task_title_model_y_doc.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {fontSizes, sprinkles, tasksStyles} from "~/shared/styles/styles.js";
import {TaskTitleModel} from "~/shared/tasks/model/task_title_model.js";
import {
    TaskTitleProsemirrorSchema,
    TaskTitleUpdate,
    getTaskTitleProsemirrorNode,
} from "~/shared/tasks/task_title.js";

const taskDetailTitleInputAriaLabel = "Title";

const taskDetailTitleInputClassName = `ProseMirror ${sprinkles({
    fontSize: "300",
    fontStyle: "semi-bold",
    userSelect: "text",
})} ${tasksStyles.detailTitleInputPlaceholderClassName}`;

export function TaskDetailTitleInput({
    title,
    onTitleChange,
    placeholder,
    isReadOnly,
}: {
    title: TaskTitleModel;
    onTitleChange: (titleUpdate: TaskTitleUpdate) => void;
    placeholder: string;
    isReadOnly: boolean;
}) {
    const isInitialAppRender = useIsInitialAppRender();
    const containerRef = useRef<HTMLDivElement>(null);

    const viewRef = useRef<
        | {isReady: false; callbacks: Array<(view: EditorView) => void>}
        | {isReady: true; view: EditorView}
    >({isReady: false, callbacks: []});

    const titleYDoc = useTaskTitleModelYDoc(title, onTitleChange);

    const titleRef = useRef(title);
    const isReadOnlyRef = useRef(isReadOnly);
    useLayoutEffectWithoutServerSideWarning(() => {
        titleRef.current = title;
        isReadOnlyRef.current = isReadOnly;
    });

    useLayoutEffectWithoutServerSideWarning(() => {
        // Wait for the client-side rerender before mounting our editor.
        if (isInitialAppRender) return;

        const containerElement = assertExists(containerRef.current);

        const view = new EditorView(containerElement, {
            state: EditorState.create({
                schema: TaskTitleProsemirrorSchema,
                // Make sure we start with the correct initial document. After this the
                // `ySyncPlugin` manages document state.
                doc: getTaskTitleProsemirrorNode(titleRef.current.raw),
                plugins: [ySyncPlugin(titleYDoc.getXmlFragment("doc"))],
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
        });

        view.dom.ariaLabel = taskDetailTitleInputAriaLabel;
        view.dom.className = taskDetailTitleInputClassName;

        // Update `viewRef` and call any callbacks that were waiting for the view to
        // be ready.
        {
            const callbacks = !viewRef.current.isReady ? viewRef.current.callbacks : [];

            viewRef.current = {isReady: true, view};

            for (const callback of callbacks) {
                callback(view);
            }
        }

        updateEditorEmptyClass(view.state);

        return () => {
            viewRef.current = {isReady: false, callbacks: []};
            view.destroy();
        };

        // IMPORTANT: We want to maintain the `EditorView` instance during updates. Be
        // careful about what you put in here. Ideally we never destroy the
        // `EditorView` while this component is mounted.
    }, [isInitialAppRender, titleYDoc]);

    function updateEditorEmptyClass(state: EditorState) {
        assert(viewRef.current.isReady);
        const containerElement = assertExists(viewRef.current.view.dom.parentElement);

        const addEmptyClassName = state.doc.childCount === 0;
        if (
            addEmptyClassName &&
            !containerElement.classList.contains(
                tasksStyles.detailTitleInputEmptyContainerClassName,
            )
        ) {
            containerElement.classList.add(tasksStyles.detailTitleInputEmptyContainerClassName);
        }
        if (
            !addEmptyClassName &&
            containerElement.classList.contains(tasksStyles.detailTitleInputEmptyContainerClassName)
        ) {
            containerElement.classList.remove(tasksStyles.detailTitleInputEmptyContainerClassName);
        }
    }

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

    return (
        <FocusRing isVisibleWhenFocusWithin>
            <div
                ref={containerRef}
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
                                getTaskTitleProsemirrorNode(title.raw).content,
                            ),
                        }}
                    />
                )}
            </div>
        </FocusRing>
    );
}
