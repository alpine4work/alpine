import classNames from "classnames";
import {Fragment, Slice} from "prosemirror-model";
import {AllSelection, EditorState, Plugin, PluginKey, TextSelection} from "prosemirror-state";
import {ReplaceStep} from "prosemirror-transform";
import {EditorView} from "prosemirror-view";
import {
    CSSProperties,
    Ref,
    forwardRef,
    useCallback,
    useImperativeHandle,
    useInsertionEffect,
    useRef,
} from "react";
import {flushSync} from "react-dom";
import {buildSharedContentEditorInputRulesPlugin} from "~/client/content/state/shared/build_shared_content_editor_input_rules_plugin.js";
import {sharedContentEditorTrackSelectionWithinPlugin} from "~/client/content/state/shared/shared_content_editor_track_selection_within_plugin.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {sprinkles, tasksStyles} from "~/client/styles/styles.js";
import {
    taskDetailViewTitleFontSize,
    taskDetailViewTitleLineHeight,
} from "~/client/styles/tasks_shared_styles.js";
import {buildTaskTitleInputKeymapPlugin} from "~/client/tasks/internal/build_task_title_input_keymap_plugin.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {
    TaskTitleModel,
    TaskTitleProsemirrorSchema,
    TaskTitleUpdateModel,
} from "~/shared/tasks/title/task_title.js";

export type TaskDetailTitleInputRef = {
    isFocused(): boolean;
    focus(): void;
    focusAll(): void;
};

const taskDetailTitleInputAriaLabel = "Title";

const taskDetailTitleInputClassName = `ProseMirror ${sprinkles({
    fontSize: taskDetailViewTitleFontSize,
    fontStyle: "semi-bold",
    userSelect: "text",
})} ${tasksStyles.detailTitleInputPlaceholderClassName}`;

const taskDetailTitleInputStyle: CSSProperties = {
    lineHeight: spacing[taskDetailViewTitleLineHeight],
    // Render contextual alternate glyphs. User text may be rendered here. Helpful
    // for consistency if the user types anything like 2x2 or an @ mention.
    // eslint-disable-next-line string-quotes
    fontFeatureSettings: '"calt" on',
};

const TaskDetailTitleInputForwardRef = forwardRef(TaskDetailTitleInput);
export {TaskDetailTitleInputForwardRef as TaskDetailTitleInput};

function TaskDetailTitleInput(
    props: {
        title: TaskTitleModel;
        onTitleChange: (titleUpdate: TaskTitleUpdateModel) => void;
        placeholder: string;
        isReadOnly: boolean;
        elementRef: Ref<HTMLDivElement>;
    },
    ref: Ref<TaskDetailTitleInputRef>,
) {
    const {title, placeholder, isReadOnly, elementRef} = props;

    const isInitialAppRender = useIsInitialAppRender();
    const {currentAccount} = useSpaceContext();

    const viewRef = useRef<
        | {isReady: false; callbacks: Array<(view: EditorView) => void>}
        | {isReady: true; view: EditorView}
    >({isReady: false, callbacks: []});

    const propsRef = useRef(props);
    const isReadOnlyRef = useRef(isReadOnly);
    const currentAccountIdRef = useRef(currentAccount?.id);
    useInsertionEffect(() => {
        propsRef.current = props;
        isReadOnlyRef.current = isReadOnly;
        currentAccountIdRef.current = currentAccount?.id;
    });

    const updateTitleStateRef = useRef<{
        titleUpdate: TaskTitleUpdateModel;
        titleState: EditorState;
    } | null>(null);

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

            const viewElement = document.createElement("div");
            containerElement.appendChild(viewElement);

            // Set the role for assistive technologies. For documentation see:
            // https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/textbox_role
            viewElement.role = "textbox";

            viewElement.ariaLabel = taskDetailTitleInputAriaLabel;
            viewElement.className = taskDetailTitleInputClassName;
            Object.assign(viewElement.style, taskDetailTitleInputStyle);

            const view = new EditorView(
                {mount: viewElement},
                {
                    state: EditorState.create({
                        schema: TaskTitleProsemirrorSchema,
                        doc: propsRef.current.title.getProsemirrorNode(),
                        plugins: [
                            taskTitlePlugin(propsRef.current.title),

                            buildSharedContentEditorInputRulesPlugin(),
                            buildTaskTitleInputKeymapPlugin(),

                            // Our shared keymap commands use this plugin.
                            sharedContentEditorTrackSelectionWithinPlugin(),
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
                        // In iOS, however, the native spellchecker is _essential_ for proper
                        // document editing. Since typos abound on mobile keyboards. Unlike on web, iOS
                        // spell check results show up inline instead of requiring a right click (which
                        // we override).
                        ...(!isMobileWebKit ? {spellcheck: "false"} : undefined),
                    },

                    dispatchTransaction: transaction => {
                        const oldTitleState = view.state;

                        if (!transaction.docChanged) {
                            const newTitleState = oldTitleState.apply(transaction);
                            view.updateState(newTitleState);
                            return;
                        }

                        const titleUpdate = propsRef.current.title.replaceMany(
                            mapIterable(transaction.steps, step => {
                                assert(step instanceof ReplaceStep);
                                return step;
                            }),
                        );

                        const newTitleState = oldTitleState.apply(
                            transaction.setMeta(taskTitlePluginKey, titleUpdate.newTitle),
                        );

                        updateTitleStateRef.current = {
                            titleUpdate,
                            titleState: newTitleState,
                        };

                        // We must flush synchronously. Since ProseMirror preserves local DOM
                        // state when we call `updateState()` synchronously but won't otherwise.
                        //
                        // See the "Efficient updating" section in the [editor view guide][1].
                        // If we don't synchronously apply the transaction it is considered
                        // cancelled. A quote from the guide:
                        //
                        // > When such a transaction is canceled or modified somehow, the view
                        // > will undo the DOM change...
                        //
                        // [1]: https://prosemirror.net/docs/guide/#view
                        flushSync(() => {
                            propsRef.current.onTitleChange(titleUpdate);
                        });

                        updateTitleStateRef.current = null;
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
        [isInitialAppRender],
    );

    // Reconcile our imperative `EditorView` state with state from React. If this
    // is run by `dispatchTransaction()` (which updates state in `flushSync()`)
    // then this should be flushed synchronously given this is a layout effect.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        assert(viewRef.current.isReady);
        const {view} = viewRef.current;
        const {state} = view;

        // Optimization: If the user is currently typing (in other words
        // `dispatchTransaction` is called) then `updateTitleStateRef.current` will be
        // populated with the new `EditorState` which'll have the correct selection.
        if (updateTitleStateRef.current?.titleUpdate.newTitle === title) {
            view.updateState(updateTitleStateRef.current.titleState);
            return;
        }

        if (title.getProsemirrorNode() === state.doc) return;

        const transaction = state.tr;

        // If something externally changes the title (e.g. another user in realtime or
        // an undo) then we completely replace the ProseMirror content with the new
        // content. Then manually move the selection to its new position.
        //
        // This is the same approach [`y-prosemirror` uses][1]. This approach has
        // [meaningful drawbacks][2]. Namely any decorations being maintained via
        // `decorationSet.map()` will be wiped away by the full replace. We don't have
        // any decorations on this editor currently so it's not an issue for us right
        // now.
        //
        // It should be possible to compute a precise text diff between `oldTitle` and
        // the new `title` using the Yjs CRDT structure. Then call
        // `transaction.replace()` just for the changed text ranges. This would
        // preserve anything that needs to be `map()`ed along by ProseMirror (like
        // decorations for some plugins). However, such an algorithm would be
        // challenging to write so we copy the dumb `y-prosemirror` strategy for now.
        //
        // [1]: https://github.com/yjs/y-prosemirror/blob/15a3862640d4a0d02eae8cbf895f4c9927413a9e/src/plugins/sync-plugin.js#L567-L571
        // [2]: https://discuss.prosemirror.net/t/offline-peer-to-peer-collaborative-editing-using-yjs/2488
        transaction.replace(
            0,
            state.doc.content.size,
            new Slice(Fragment.from(title.getProsemirrorNode()), 0, 0),
        );

        // Move the selection to a new position using Yjs relative positions.
        // The Yjs CRDT contains enough information to map positions on its own without
        // needing the intermediate updates.
        //
        // TODO(calebmer): If this title update is from an undo ideally we'd reset the
        // selection to whatever it was before the undo. This is the standard
        // convention for text editors. Not implementing for now because wiring all the
        // pieces up through the task undo system is annoying.
        {
            const oldTitle = assertExists(taskTitlePluginKey.getState(view.state));

            const anchor = title.fromRelativePosition(
                oldTitle.intoRelativePosition(state.selection.anchor),
            );
            const head = title.fromRelativePosition(
                oldTitle.intoRelativePosition(state.selection.head),
            );

            if (state.selection instanceof AllSelection) {
                transaction.setSelection(new AllSelection(transaction.doc));
            } else if (anchor !== null && head !== null) {
                transaction.setSelection(TextSelection.create(transaction.doc, anchor, head));
            }
        }

        transaction.setMeta(taskTitlePluginKey, title);

        view.updateState(state.apply(transaction));
    }, [isInitialAppRender, title]);

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
            focus: () => {
                runWhenViewIsReady(view => {
                    view.focus();
                });
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

    const titleNodeForInitialAppRender = isInitialAppRender ? title.getProsemirrorNode() : null;

    return (
        <div ref={elementRef}>
            <FocusRing isVisibleWhenFocusWithin>
                <div
                    className={classNames(
                        sprinkles({
                            position: "relative",
                            zIndex: "0",
                            color: "grey-100",
                        }),
                        title.getProsemirrorNode().childCount === 0 &&
                            tasksStyles.detailTitleInputEmptyContainerClassName,
                    )}
                    style={{minHeight: spacing[taskDetailViewTitleLineHeight]}}
                >
                    {titleNodeForInitialAppRender && (
                        // On server-side render serialize our title to HTML since we can't mount an
                        // `EditorView` until we are on the client.
                        <div
                            className={taskDetailTitleInputClassName}
                            style={taskDetailTitleInputStyle}
                            aria-label={taskDetailTitleInputAriaLabel}
                            aria-placeholder={placeholder}
                            dangerouslySetInnerHTML={{
                                __html: serializeProsemirrorFragmentToHtml(
                                    titleNodeForInitialAppRender.content,
                                ),
                            }}
                        />
                    )}
                </div>
            </FocusRing>
        </div>
    );
}

const taskTitlePluginKey = new PluginKey<TaskTitleModel>("taskTitle");

function taskTitlePlugin(initialTaskTitle: TaskTitleModel) {
    return new Plugin<TaskTitleModel>({
        key: taskTitlePluginKey,
        state: {
            init: () => initialTaskTitle,
            apply: (transaction, oldTitle) => {
                const newTitle: TaskTitleModel | undefined =
                    transaction.getMeta(taskTitlePluginKey);
                if (newTitle) {
                    return newTitle;
                }

                return oldTitle;
            },
        },
    });
}
