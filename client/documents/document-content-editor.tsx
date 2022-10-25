import Head from "next/head";
import {Transaction} from "prosemirror-state";
import {ReplaceStep, Step} from "prosemirror-transform";
import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {sprinkles} from "~/client/design/sprinkles.css";
import {typingNetworkThrottleMs} from "~/client/design/timing-constants";
import {DocumentCollaborationWorkerConnection} from "~/client/documents/document-collaboration-worker-connection";
import {DocumentContent} from "~/shared/documents/document-content-schema";
import {DocumentModel, getDocumentContentTitle} from "~/shared/documents/document-model";
import {assert} from "~/shared/helpers/control/assert";

function getInitialState(initialDocument: DocumentModel): ContentEditorState<DocumentContent> {
    return ContentEditorState.createCollab({
        version: initialDocument.version,
        content: initialDocument.content,
    });
}

export function DocumentContentEditor({initialDocument}: {initialDocument: DocumentModel}) {
    const documentId = initialDocument.id;

    const [isConnected, setIsConnected] = useState(false);
    const [state, setState] = useState(() => getInitialState(initialDocument));

    // TODO: not this, probably react-ify the collaboration connection class?
    const stateRef = useRef<ContentEditorState<DocumentContent>>();
    useLayoutEffect(() => {
        stateRef.current = state;
    }, [state]);

    const connectionRef = useRef<DocumentCollaborationWorkerConnection>();
    useEffect(() => {
        const connection = new DocumentCollaborationWorkerConnection(
            documentId,
            () => {
                assert(stateRef.current);
                return stateRef.current;
            },
            setState,
        );
        connectionRef.current = connection;
        const unsubscribeFromConnect = connection.onConnect(() => setIsConnected(true));
        const unsubscribeFromDisconnect = connection.onDisconnect(() => setIsConnected(false));

        return () => {
            connectionRef.current = undefined;
            unsubscribeFromConnect();
            unsubscribeFromDisconnect();
            connection.destroy();
        };
    }, [documentId]);

    useEffect(() => {
        if (connectionRef.current && state) {
            connectionRef.current.stateDidChange(state);
        }
    }, [state]);

    return (
        <>
            <Head>
                <title>{getDocumentContentTitle(state.getContent())}</title>
            </Head>
            {isConnected && (
                <ContentEditor
                    state={state}
                    onChange={state => setState(state)}
                    aria-label="Document editor"
                    placeholder="Share your ideas…"
                    className={sprinkles({paddingBottom: "24"})}
                />
            )}
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
