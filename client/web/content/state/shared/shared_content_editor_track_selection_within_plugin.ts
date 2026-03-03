import {EditorState, Plugin, PluginKey, Transaction} from "prosemirror-state";
import {isRangeContained} from "~/shared/helpers/geometry/is_range_contained.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {iterableSome} from "~/shared/helpers/iterable/iterable_some.js";

type SharedContentEditorTrackSelectionWithinPluginState = ImmutableMap<
    string,
    {readonly start: number; readonly end: number}
>;

const sharedContentEditorTrackSelectionWithinPluginKey =
    new PluginKey<SharedContentEditorTrackSelectionWithinPluginState>(
        "sharedContentEditorTrackSelectionWithin",
    );

/**
 * Plugin that allows us to keep track of whether the user's selection stays within
 * a certain range. This is useful for building context-aware behavior that's based
 * on the user not leaving a certain editing location.
 *
 * If you're using `addSharedContentEditorKeymapCommands()` you'll also need this
 * plugin.
 */
export function sharedContentEditorTrackSelectionWithinPlugin() {
    return new Plugin<SharedContentEditorTrackSelectionWithinPluginState>({
        key: sharedContentEditorTrackSelectionWithinPluginKey,
        state: {
            init: () => ImmutableMap.empty(),
            apply: (transaction, trackerByKey, oldState, newState) => {
                const newTracker:
                    | [string, {readonly start: number; readonly end: number}]
                    | undefined = transaction.getMeta(
                    sharedContentEditorTrackSelectionWithinPluginKey,
                );
                if (newTracker) {
                    trackerByKey = trackerByKey.set(newTracker[0], newTracker[1]);
                }

                return trackerByKey.updateEvery(tracker => {
                    // Don't map trackers we added in this transaction. Trackers added in this
                    // transaction should have valid positions as of the transaction end.
                    const newStart =
                        newTracker?.[1] !== tracker
                            ? transaction.mapping.map(tracker.start, -1)
                            : tracker.start;
                    const newEnd =
                        newTracker?.[1] !== tracker
                            ? transaction.mapping.map(tracker.end, 1)
                            : tracker.end;

                    if (tracker.start !== newStart || tracker.end !== newEnd) {
                        tracker = {start: newStart, end: newEnd};
                    }

                    // If we collapse into an impossible state (e.g. content is deleted) the tracker is
                    // removed.
                    if (tracker.start >= tracker.end) {
                        return undefined;
                    }

                    // If the tracker no longer contains our selection then return `undefined` deleting
                    // the tracker from our state.
                    if (
                        !isRangeContained(
                            tracker.start,
                            // `tracker.end` is exclusive.
                            tracker.end - 1,
                            newState.selection.from,
                            newState.selection.to,
                        )
                    ) {
                        return undefined;
                    }

                    return tracker;
                });
            },
        },
    });
}

/**
 * Start tracking a range in our editor state. Provide a key to identify the range
 * later.
 *
 * `tracker.start` is inclusive, `tracker.end` is exclusive.
 */
export function trackSelectionWithinSharedContentEditor(
    transaction: Transaction,
    key: string,
    tracker: {start: number; end: number},
): Transaction {
    return transaction.setMeta(sharedContentEditorTrackSelectionWithinPluginKey, [key, tracker]);
}

/**
 * Test if we're still tracking a specific key. If true then the selection hasn't
 * left the range we provided in our `trackSelectionWithinSharedContentEditor()`
 * call.
 */
export function isTrackingSelectionWithinSharedContentEditor(
    state: EditorState,
    key: string,
): boolean {
    return sharedContentEditorTrackSelectionWithinPluginKey.getState(state)?.has(key) === true;
}

/**
 * Test if, out of all the ranges we're tracking whether the selection stays
 * within, one meets the provided condition.
 */
export function isTrackingSomeSelectionWithinSharedContentEditor(
    state: EditorState,
    test: (key: string, tracker: {start: number; end: number}) => boolean,
): boolean {
    const trackerByKey =
        sharedContentEditorTrackSelectionWithinPluginKey.getState(state) ?? ImmutableMap.empty();

    return iterableSome(trackerByKey.entries(), ([key, tracker]) => test(key, tracker));
}
