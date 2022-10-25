import Head from "next/head";
import {Transaction} from "prosemirror-state";
import {ReplaceStep, Step} from "prosemirror-transform";
import {useEffect, useReducer, useState} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {sprinkles} from "~/client/design/sprinkles.css";
import {typingNetworkThrottleMs} from "~/client/design/timing-constants";
import {subscribeToMessagesFromNetworkChannel} from "~/client/network/subscribe-to-messages-from-network-channel";
import {DocumentContent} from "~/shared/documents/document-content-schema";
import {DocumentModel, getDocumentContentTitle} from "~/shared/documents/document-model";
import {CancelledError} from "~/shared/error/error";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run-promise-without-awaiting";
import {scheduleException} from "~/shared/helpers/async/schedule-exception";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Id} from "~/shared/id/id";
import {
    DocumentNetworkChannel,
    updateDocumentContent,
} from "~/shared/network/documents-network-definition";

type State = {
    editorState: ContentEditorState<DocumentContent>;
    /**
     * We may get `ReceiveSteps` actions out of order. If we see an action for a
     * future version we put it in this array and re-apply the action when older
     * steps are applied.
     */
    pendingActions: Array<ReceiveStepsAction>;
};

function getInitialState(initialDocument: DocumentModel): State {
    const editorState = ContentEditorState.createCollab({
        version: initialDocument.version,
        content: initialDocument.content,
    });

    return {
        editorState,
        pendingActions: [],
    };
}

type Action = EditAction | ReceiveStepsAction;

type EditAction = {
    readonly type: "Edit";
    readonly editorState: ContentEditorState<DocumentContent>;
};

type ReceiveStepsAction = {
    readonly type: "ReceiveSteps";
    readonly newVersion: number;
    readonly steps: ReadonlyArray<{readonly step: Step; readonly clientId: Id}>;
};

function reduce(state: State, action: Action): State {
    const oldVersion = state.editorState.getVersion();
    state = reduceWithAction(state, action);
    const newVersion = state.editorState.getVersion();

    // If the version changed then we want to retry our pending actions since they
    // may be ok to run now.
    if (oldVersion === newVersion) return state;

    // We may receive actions out of order, but make sure we run them in order
    // now.
    const pendingActions = [...state.pendingActions].sort((pendingAction1, pendingAction2) => {
        const baseVersion1 = pendingAction1.newVersion - pendingAction1.steps.length;
        const baseVersion2 = pendingAction2.newVersion - pendingAction2.steps.length;
        return baseVersion1 - baseVersion2;
    });

    // We are going to try and run all pending actions. If actions are still
    // pending they will be put back into this array.
    state = {...state, pendingActions: []};

    return pendingActions.reduce(reduceWithAction, state);
}

function reduceWithAction(state: State, action: Action): State {
    switch (action.type) {
        case "Edit": {
            return {
                ...state,
                editorState: action.editorState,
            };
        }
        case "ReceiveSteps": {
            const oldVersion = state.editorState.getVersion();
            if (action.newVersion <= oldVersion) return state;

            // If we received an action that's applied on a future version of our content,
            // we can't commit it until our local state has caught up. So stick it in
            // pending actions and we'll come back to it.
            if (oldVersion < action.newVersion - action.steps.length) {
                return {
                    ...state,
                    pendingActions: [...state.pendingActions, action],
                };
            }

            // We may dispatch this action multiple times with the same steps. Remove any
            // steps we've already seen.
            const steps = action.steps.slice(action.steps.length - action.newVersion - oldVersion);
            assert(oldVersion + steps.length === action.newVersion);

            // If we've already seen all the steps, no change is needed.
            if (steps.length === 0) return state;

            let editorState = state.editorState;
            let stepTransaction: Array<{step: Step; clientId: Id}> = [];

            // `prosemirror-collab` needs steps from our `clientId` to be at the beginning
            // of the `receiveSteps()` call. So call `receiveSteps()` whenever the
            // `clientId` of our steps change.
            //
            // Arguably, this is a bug in `prosemirror-collab`.
            //
            // Here is the code which requires our steps to be first this:
            // https://github.com/ProseMirror/prosemirror-collab/blob/94df0cc9288960e7e64dc9721abbf8f656df444f/src/collab.ts#L125-L129
            for (const {step, clientId} of steps) {
                if (
                    stepTransaction.length > 0 &&
                    stepTransaction[stepTransaction.length - 1]!.clientId !== clientId
                ) {
                    editorState = editorState.receiveSteps(stepTransaction);
                    stepTransaction = [];
                }

                stepTransaction.push({step, clientId});
            }

            editorState = editorState.receiveSteps(stepTransaction);
            stepTransaction = [];

            return {...state, editorState};
        }
        default:
            throw exhaustive(action);
    }
}

export function DocumentContentEditor({initialDocument}: {initialDocument: DocumentModel}) {
    const documentId = initialDocument.id;

    const [isUpdating, setIsUpdating] = useState(false);
    const [state, dispatch] = useReducer(reduce, initialDocument, getInitialState);

    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    // TODO(calebmer): We probably want some retry mechanism for the user? But
    // until the user retries, we don't want an infinite loop where we keep trying
    // to update the document content.
    if (errorState.hasError) throw errorState.error;

    const shouldThrottleUpdate = useShouldThrottleUpdate();

    useEffect(() => {
        // If we're already updating then don't send another update mutation. Once
        // the current mutation is done we'll send another.
        if (isUpdating || errorState.hasError) return;

        // If there are no new sendable steps from this client then don’t send a
        // mutation.
        const sendableSteps = state.editorState.sendableSteps();
        if (!sendableSteps) return;
        const {version, steps, origins, clientId} = sendableSteps;

        // As a performance optimization, we sometimes throttle updates when a user
        // is typing fast to let a couple steps accumulate before sending a mutation
        // to our servers. See `shouldThrottleUpdate()` for more info on the desired
        // user experience.
        if (shouldThrottleUpdate(origins)) return;

        runPromiseWithoutAwaiting(async () => {
            setIsUpdating(true);
            try {
                const {newVersion, newSteps, conflictingSteps} = await updateDocumentContent({
                    id: documentId,
                    version,
                    steps,
                    clientId,
                });

                dispatch({
                    type: "ReceiveSteps",
                    newVersion,
                    steps: [...conflictingSteps, ...newSteps.map(step => ({step, clientId}))],
                });
            } catch (error) {
                setErrorState({hasError: true, error});
            } finally {
                setIsUpdating(false);
            }
        });

        // This effect intentionally doesn’t have a dependency array. It shouldn't
        // need one for correctness.
    });

    // TODO(calebmer): I probably want a custom hook. This is hacky becuz I
    // am tired.
    useEffect(() => {
        const abortController = new AbortController();

        // TODO(calebmer): Handle errors??
        const iterator = subscribeToMessagesFromNetworkChannel(
            DocumentNetworkChannel,
            {documentId},
            {signal: abortController.signal},
        );

        let isCancelled = false;
        const cancelError = new CancelledError("Unsubscribed from network channel");
        const cancel = () => abortController.abort(cancelError);

        const loop = () => {
            if (isCancelled) return;

            iterator.next().then(
                result => {
                    if (isCancelled || result.done) return;

                    dispatch({
                        type: "ReceiveSteps",
                        newVersion: result.value.newVersion,
                        steps: result.value.steps.map(step => ({
                            step,
                            clientId: result.value.clientId,
                        })),
                    });

                    loop();
                },
                error => {
                    // If this is the error from our `AbortSignal` then we can ignore it since
                    // it's expected.
                    if (error === cancelError) return;

                    scheduleException(error);
                },
            );
        };

        loop();

        return () => {
            isCancelled = true;
            cancel();
        };
    }, [documentId]);

    return (
        <>
            <Head>
                <title>{getDocumentContentTitle(state.editorState.getContent())}</title>
            </Head>
            <ContentEditor
                state={state.editorState}
                onChange={editorState => dispatch({type: "Edit", editorState})}
                aria-label="Document editor"
                placeholder="Share your ideas…"
                className={sprinkles({paddingBottom: "24"})}
            />
        </>
    );
}

/**
 * We want collaborative content editing to feel as realtime as possible for
 * connected users. However, sending an update mutation for every keystroke can
 * create a lot of load on our backend.
 *
 * To strike the balance of feeling like typing is happening in realtime while
 * also minimizing update mutations we throttle updates while the user is typing
 * letters.
 *
 * - While typing letters we'll send an update mutation every N milliseconds.
 * - If space or punctuation or any other character is typed we'll immediately
 *   send a mutation and restart the throttle timer.
 *
 * This breaks our update mutations into word boundaries. Connected users should
 * see words appear on screen one at a time which should feel realtime enough.
 */
function useShouldThrottleUpdate() {
    const [throttleUpdate, setThrottleUpdate] = useState<{
        startMs: number;
        expired: boolean;
    } | null>(null);

    // When the throttle state changes, set a timeout which will fire
    // `typingNetworkThrottleMs` from the start of the throttled update that
    // forces the update to go through.
    useEffect(() => {
        if (throttleUpdate === null) return;

        const nowMs = Date.now();

        const timeoutMs = Math.max(0, throttleUpdate.startMs + typingNetworkThrottleMs - nowMs);

        const timeoutId = setTimeout(() => {
            setThrottleUpdate({startMs: throttleUpdate.startMs, expired: true});
        }, timeoutMs);

        return () => {
            clearTimeout(timeoutId);
        };
    }, [throttleUpdate]);

    /**
     * Returns true if we should wait to send a mutation for a list of
     * transactions.
     *
     * Updates state so should not be called in render!
     */
    function shouldThrottleUpdate(transactions: ReadonlyArray<Transaction>) {
        const shouldThrottle = transactions.every(
            transaction =>
                !transaction.getMeta("paste") &&
                transaction.steps.length === 1 &&
                isSingleLetterInsertionStep(transaction.steps[0]!),
        );

        if (shouldThrottle && !throttleUpdate?.expired) {
            const nowMs = Date.now();

            const throttleUpdateStartMs = throttleUpdate?.startMs ?? nowMs;

            if (nowMs < throttleUpdateStartMs + typingNetworkThrottleMs) {
                // If we are starting throttling now, record the time.
                //
                // This will trigger an effect which starts a `setTimeout` to expire
                // the throttle.
                if (throttleUpdate === null) {
                    setThrottleUpdate({startMs: nowMs, expired: false});
                }
                return true;
            }
        }

        // If we’re not throttling then the throttling state should always be
        // null. This won’t re-render the component if the state was already null.
        setThrottleUpdate(null);
        return false;
    }

    return shouldThrottleUpdate;
}

/**
 * Is this step the insertion of a single letter character as determined by the
 * letter [Unicode general category][1]?
 *
 * [1]: https://en.wikipedia.org/wiki/Unicode_character_property
 */
function isSingleLetterInsertionStep(step: Step): boolean {
    if (!(step instanceof ReplaceStep)) return false;

    // If `from` and `to` are the same we are inserting at that point instead of
    // replacing some range.
    if (step.from !== step.to) return false;

    // Content should only consist of a single text node.
    if (step.slice.content.childCount !== 1) return false;
    const node = step.slice.content.child(0);
    if (!node.isText) return false;

    // Test for only a single letter character.
    return /^\p{L}$/u.test(node.textContent);
}
