import classNames from "classnames";
import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {useRef, useState} from "react";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {sprinkles, tasksStyles} from "~/shared/styles/styles";
import {TaskTitle, assertTaskTitle} from "~/shared/tasks/task_title_schema";

const taskDetailTitleInputAriaLabel = "Title";

const taskDetailTitleInputClassName = `ProseMirror ${sprinkles({
    fontSize: "300",
})} ${tasksStyles.titleInputPlaceholderClassName}`;

export function TaskDetailTitleInput({
    title,
    onTitleChange,
    placeholder,
}: {
    title: TaskTitle;
    onTitleChange: (title: TaskTitle) => void;
    placeholder?: string;
}) {
    const isInitialAppRender = useIsInitialAppRender();
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    const [titleState, setTitleState] = useState(() => EditorState.create({doc: title}));

    // If our title in state changed out-of-step with our editor state then reset
    // the editor state. Maybe a parent component didn't accept our title update?
    // Or a parent component push a new update down.
    if (title !== titleState.doc) {
        setTitleState(EditorState.create({doc: title}));
    }

    const titleStateRef = useRef(titleState);
    const onTitleChangeRef = useRef(onTitleChange);
    useLayoutEffectWithoutServerSideWarning(() => {
        titleStateRef.current = titleState;
        onTitleChangeRef.current = onTitleChange;
    });

    useLayoutEffectWithoutServerSideWarning(() => {
        // Wait for the client-side rerender before mounting our editor.
        if (isInitialAppRender) return;

        const containerElement = assertExists(containerRef.current);
        const initialTitleState = titleStateRef.current;

        const view = new EditorView(containerElement, {
            state: initialTitleState,

            dispatchTransaction: transaction => {
                const oldTitleState = view.state;
                const newTitleState = oldTitleState.apply(transaction);

                // We need to run this with immediate priority so that we call
                // `view.updateState()` synchronously.
                //
                // See the "Efficient updating" section in the [editor view guide][1].
                // If we don't synchronously apply the transaction it is considered
                // cancelled. A quote from the guide:
                //
                // > When such a transaction is canceled or modified somehow, the view
                // > will undo the DOM change...
                //
                // [1]: https://prosemirror.net/docs/guide/#view
                runWithImmediatePriority(() => {
                    setTitleState(newTitleState);

                    // We only need to send this update to our parent if the doc changed. Selection
                    // changes do nothing.
                    if (oldTitleState.doc !== newTitleState.doc) {
                        onTitleChangeRef.current(assertTaskTitle(newTitleState.doc));
                    }
                });
            },
        });

        view.dom.ariaLabel = taskDetailTitleInputAriaLabel;
        view.dom.className = taskDetailTitleInputClassName;

        viewRef.current = view;
        return () => {
            viewRef.current = null;
            view.destroy();
        };

        // IMPORTANT: We want to maintain the `EditorView` instance during updates. Be
        // careful about what you put in here. Ideally we never destroy the
        // `EditorView` while this component is mounted.
    }, [isInitialAppRender]);

    // Update our `EditorView`'s `EditorState` whenever it changes.
    useLayoutEffectWithoutServerSideWarning(() => {
        // Wait for the client-side rerender before mounting our editor.
        if (isInitialAppRender) return;

        const view = assertExists(viewRef.current);
        view.updateState(titleState);
    }, [isInitialAppRender, titleState]);

    useLayoutEffectWithoutServerSideWarning(() => {
        // Server-side render attaches this attribute differently.
        if (isInitialAppRender) return;

        const viewElement = assertExists(viewRef.current).dom;

        if (!placeholder) {
            viewElement.removeAttribute("aria-placeholder");
        } else {
            viewElement.setAttribute("aria-placeholder", placeholder);
        }
    }, [isInitialAppRender, placeholder]);

    return (
        <div
            ref={containerRef}
            className={classNames(
                tasksStyles.titleInputContainerClassName,
                titleState.doc.childCount === 0 && tasksStyles.titleInputEmptyContainerClassName,
            )}
        >
            {isInitialAppRender && (
                // On server-side render serialize our title to HTML since we can't mount an
                // `EditorView` until we are on the client.
                <div
                    className={taskDetailTitleInputClassName}
                    aria-label={taskDetailTitleInputAriaLabel}
                    aria-placeholder={placeholder}
                    dangerouslySetInnerHTML={{
                        __html: serializeProsemirrorFragmentToHtml(titleState.doc.content),
                    }}
                />
            )}
        </div>
    );
}
