import {useRef, useState} from "react";
import * as Y from "yjs";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {TaskTitleModel} from "~/shared/tasks/model/task_title_model.js";
import {TaskTitle, TaskTitleUpdate} from "~/shared/tasks/task_title.js";

function createYDoc(title: TaskTitleModel): Y.Doc & {
    matches: {
        rawTitle: TaskTitle;
        titleUpdate: TaskTitleUpdate | null;
    } | null;
} {
    const titleDoc = new Y.Doc();
    Y.applyUpdateV2(titleDoc, title.raw);

    return Object.assign(titleDoc, {
        matches: {
            rawTitle: title.raw,
            titleUpdate: null,
        },
    });
}

const titleEffectTransactionOrigin = Symbol("titleEffectTransactionOrigin");

/**
 * Get a `Y.Doc` for the provided `TaskTitleModel`. We update task titles using
 * standard React data down, actions up. But we need a `Y.Doc` for managing our
 * editor state and `Y.Doc` maintains its own state internally. This hook
 * returns a `Y.Doc` that you can use with a `y-prosemirror` text editor that
 * we make sure always has the same underlying value as the provided title.
 */
export function useTaskTitleModelYDoc(
    title: TaskTitleModel,
    onTitleUpdate: (titleUpdate: TaskTitleUpdate) => void,
): Y.Doc {
    const [yDoc, setYDoc] = useState(() => createYDoc(title));

    const titleRef = useRef(title);
    const onTitleUpdateRef = useRef(onTitleUpdate);
    useLayoutEffectWithoutServerSideWarning(() => {
        titleRef.current = title;
        onTitleUpdateRef.current = onTitleUpdate;
    });

    useLayoutEffectWithoutServerSideWarning(() => {
        // If our `yDoc` matches our `title` prop then we're good!
        if (yDoc.matches?.rawTitle === title.raw && yDoc.matches.titleUpdate === null) {
            return;
        }

        // If our `yDoc` doesn't match our `title` prop then let's check the `title`
        // prop's previous update...
        const titlePreviousUpdate = title.getPreviousUpdate();
        if (
            titlePreviousUpdate !== null &&
            yDoc.matches?.rawTitle === titlePreviousUpdate.rawTitle
        ) {
            // If our `title` prop's previous update is the same update that was just
            // applied to our `yDoc` then everything is in sync. Hooray!
            //
            // This happens when `onTitleUpdate` synchronously calls
            // `setTitle(title.apply(titleUpdate))` so our component re-renders with an
            // update the component already saw and optimistically applied.
            if (yDoc.matches.titleUpdate === titlePreviousUpdate.titleUpdate) {
                yDoc.matches = {rawTitle: title.raw, titleUpdate: null};
                return;
            }

            // If our `yDoc` matches the previous `title` then all we need to do is apply
            // the previous `title`'s update to synchronize our `yDoc`.
            //
            // This happens when we get a title update from a realtime event. The component
            // will re-render with the new `title` model and we'll need to apply the update
            // in our component.
            if (yDoc.matches.titleUpdate === null) {
                Y.applyUpdateV2(
                    yDoc,
                    titlePreviousUpdate.titleUpdate,
                    titleEffectTransactionOrigin,
                );
                yDoc.matches = {rawTitle: title.raw, titleUpdate: null};
                return;
            }
        }

        // If our `title` is out of sync with our `yDoc` then fully reset our `yDoc`.
        // We can't call `Y.applyUpdateV2()` with the full `title` since that merges
        // the `title` prop with the `yDoc` state. We need the `yDoc` to exactly match
        // the `title` prop.
        //
        // This might happen if we optimistically update a task title but then we need
        // to revert that update because an error occurs on the backend.
        setYDoc(createYDoc(title));
    }, [title, yDoc]);

    useLayoutEffectWithoutServerSideWarning(() => {
        let isUnsubscribed = false;

        const handleUpdate = (titleUpdate: TaskTitleUpdate, transactionOrigin: unknown) => {
            // If we updated `yDoc` because of our `title` effect above then in React data
            // down, actions up, style don't report this change through `onTitleUpdate()`.
            // The parent component already knows about the change, that's why it sent down
            // a new `title` prop.
            //
            // `yDoc.matches` will be updated as well by the effect.
            if (transactionOrigin === titleEffectTransactionOrigin) return;

            // If our `yDoc` starts in a good state (it matches the `title` prop) then
            // record that our `yDoc` matches the `title` prop plus the new
            // `titleUpdate`.
            if (yDoc.matches !== null && yDoc.matches.titleUpdate === null) {
                yDoc.matches.titleUpdate = titleUpdate;
            } else {
                // We can't update `titleUpdate` twice. We need React to re-render
                // between updates.
                yDoc.matches = null;
            }

            // If `onTitleUpdate()` calls `setState()` we need React to re-render
            // synchronously so run with immediate priority. Otherwise our
            // `scheduleMicrotask()` below will believe `yDoc` is out-of-sync with the
            // `title` prop.
            runWithImmediatePriority(() => {
                onTitleUpdateRef.current(titleUpdate);
            });

            // Wait for after the next React render. Because of
            // `runWithImmediatePriority()` we should only need to wait a microtask. If
            // there is no React render with an update `title` then we need to revert our
            // `yDoc` to the correct state.
            scheduleMicrotask(() => {
                if (isUnsubscribed) return;

                if (
                    yDoc.matches?.rawTitle !== titleRef.current.raw ||
                    yDoc.matches.titleUpdate !== null
                ) {
                    setYDoc(createYDoc(titleRef.current));
                }
            });
        };

        yDoc.on("updateV2", handleUpdate);

        return () => {
            isUnsubscribed = true;
            yDoc.off("updateV2", handleUpdate);
        };
    }, [yDoc]);

    return yDoc;
}
