import Head from "next/head";
import {Transaction} from "prosemirror-state";
import {ReplaceStep, Step} from "prosemirror-transform";
import {useEffect, useReducer, useState} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {sprinkles} from "~/client/design/sprinkles.css";
import {typingNetworkThrottleMs} from "~/client/design/timing-constants";
import {DocumentContent} from "~/shared/documents/document-content-schema";
import {DocumentModel, getDocumentContentTitle} from "~/shared/documents/document-model";
import {runAsyncWithoutAwaiting} from "~/shared/helpers/async/run-async-without-awaiting";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Id} from "~/shared/id/id";
import {updateDocumentContent} from "~/shared/network/documents-network-definition";

type Action = EditAction | ReceiveStepsAction;

type EditAction = {
    readonly type: "Edit";
    readonly state: ContentEditorState<DocumentContent>;
};

type ReceiveStepsAction = {
    readonly type: "ReceiveSteps";
    readonly newVersion: number;
    readonly steps: ReadonlyArray<{readonly step: Step; readonly clientId: Id}>;
};

function getInitialState(initialDocument: DocumentModel): ContentEditorState<DocumentContent> {
    return ContentEditorState.createCollab({
        version: initialDocument.version,
        content: initialDocument.content,
    });
}

function reduce(
    state: ContentEditorState<DocumentContent>,
    action: Action,
): ContentEditorState<DocumentContent> {
    switch (action.type) {
        case "Edit": {
            return action.state;
        }
        // `ReceiveSteps` may be dispatched multiple times with the same steps. Over
        // HTTP and over WebSockets. Drop steps we have seen before. Assume the server
        // sends us the same step for the same version.
        case "ReceiveSteps": {
            const oldVersion = state.getVersion();
            if (action.newVersion <= oldVersion) return state;

            const steps = action.steps.slice(action.steps.length - action.newVersion - oldVersion);
            assert(oldVersion + steps.length === action.newVersion);

            return state.receiveSteps(steps);
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
        const sendableSteps = state.sendableSteps();
        if (!sendableSteps) return;
        const {version, steps, origins, clientId} = sendableSteps;

        // As a performance optimization, we sometimes throttle updates when a user
        // is typing fast to let a couple steps accumulate before sending a mutation
        // to our servers. See `shouldThrottleUpdate()` for more info on the desired
        // user experience.
        if (shouldThrottleUpdate(origins)) return;

        runAsyncWithoutAwaiting(async () => {
            setIsUpdating(true);
            try {
                const {newVersion, newSteps, conflictingSteps} = await updateDocumentContent({
                    id: documentId,
                    version,
                    steps,
                    clientId,
                });

                // The `prosemirror-collab` module needs to receive steps from our own client
                // separately from another client's steps.
                dispatch({
                    type: "ReceiveSteps",
                    newVersion: newVersion - newSteps.length,
                    steps: conflictingSteps,
                });
                dispatch({
                    type: "ReceiveSteps",
                    newVersion,
                    steps: newSteps.map(step => ({step, clientId})),
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

    return (
        <>
            <Head>
                <title>{getDocumentContentTitle(state.getContent())}</title>
            </Head>
            <ContentEditor
                state={state}
                onChange={state => dispatch({type: "Edit", state})}
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
