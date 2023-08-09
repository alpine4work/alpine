import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

/**
 * A segment of actions loaded in our history. Each segment holds a range of
 * history from `startCommittedTime` (inclusive) to
 * `startCommittedTime + history._segmentDuration` (exclusive).
 *
 * Segments form a doubly linked list which makes it easy for us to
 * garbage collect entire segment of actions at the end of the list at once.
 */
type TaskRealtimeActionHistorySegment = {
    readonly startCommittedTime: number;
    readonly spaceSegmentById: Map<SpaceId, TaskRealtimeActionHistorySpaceSegment>;
    newerSegment: TaskRealtimeActionHistorySegment | null;
    olderSegment: TaskRealtimeActionHistorySegment | null;
};

/**
 * Action history segment for a single space. Task actions do not cross space
 * boundaries. Action transactions are ordered by the time we received them.
 * Not by `committedTime` and not by logical `action.time`. Actions are
 * designed to be applied out-of-order so this is fine.
 */
type TaskRealtimeActionHistorySpaceSegment = {
    readonly actionTransactions: Array<TaskRealtimeActionHistorySpaceSegmentActionTransaction>;
};

type TaskRealtimeActionHistorySpaceSegmentActionTransaction = {
    readonly committedTime: number;
    readonly actions: ReadonlyArray<TaskAction>;
};

/**
 * Holds all actions within the last 5 minutes (by default) so we can replay
 * the recent action history after loading some data from OpenSearch to make
 * sure what we send to the user is fully caught up and can be maintained in
 * realtime.
 */
export class TaskRealtimeActionHistory {
    /**
     * Determines the history visibility window. We keep track of actions committed
     * this long before the present. By default the visibility window is 5
     * minutes. That means the last 5 minutes of actions are tracked by this
     * class by default.
     *
     * Our visibility window needs to be generous enough for us to catch up a query
     * made against our OpenSearch task index. Our task index refreshes every 30
     * seconds. Then add to that the latency between committing an action
     * transaction and indexing it. 5 minutes feels like we'll comfortably have
     * enough visibility to catch up an OpenSearch query.
     *
     * We may temporarily hold slightly more actions than this duration in history.
     * `_segmentDuration` influences how often we cleanup old actions.
     */
    private readonly _visibleDuration = 1000 * 60 * 5;

    /**
     * Determines the duration of time a single history segment covers. Our history
     * class is structured as a doubly linked list so we can easy throw away many
     * actions at once.
     *
     * Picking a value for this is a tradeoff between segment count and how long to
     * keep actions after they leave the visible duration.
     */
    private readonly _segmentDuration = 1000 * 20;

    private _newestSegment: TaskRealtimeActionHistorySegment | null = null;
    private _oldestSegment: TaskRealtimeActionHistorySegment | null = null;

    /**
     * If we are actively recording history (`start()` was called) then this will
     * be non-null. While we are actively running, both `this._newestSegment` and
     * `this._oldestSegment` should be non-null.
     */
    private _state: {timeout: Timeout} | null = null;

    /**
     * Get the start time of our visibility window.
     */
    public getVisibleStartTime() {
        return Date.now() - this._visibleDuration;
    }

    /**
     * Asserts that history is well-formed in Jest unit tests.
     */
    public assertCorrectForTest() {
        assert(import.meta.jest);

        let segment = this._oldestSegment;
        assert(
            segment === null
                ? // If `_oldestSegment` is null then `_state` should be null (history is not
                  // running) and `_newestSegment should be null (doubly linked list is empty).
                  this._state === null && this._newestSegment === null
                : // If `_oldestSegment` is not null then `_state` should not be null (history
                  // is running) and there should be no older segment.
                  this._state !== null && segment.olderSegment === null,
        );

        while (segment !== null) {
            assert(
                segment.newerSegment === null
                    ? // If there is no newer segment then this should be our newest
                      // segment.
                      this._newestSegment === segment
                    : // Make sure the doubly linked list back link is correct and make sure our
                      // segment start times are evenly spaced out.
                      segment.newerSegment.olderSegment === segment &&
                          segment.newerSegment.startCommittedTime ===
                              segment.startCommittedTime + this._segmentDuration,
            );

            // Make sure action transactions have the right `committedTime` for
            // the segment.
            for (const spaceSegment of segment.spaceSegmentById.values()) {
                for (const {committedTime} of spaceSegment.actionTransactions) {
                    assert(
                        segment.startCommittedTime <= committedTime &&
                            committedTime < segment.startCommittedTime + this._segmentDuration,
                    );
                }
            }

            segment = segment.newerSegment;
        }
    }

    /**
     * Start recording actions.
     */
    public start() {
        assert(this._state === null);

        // Initialize the first segment at the end of our history visibility window.
        {
            const initialSegment = {
                startCommittedTime: Date.now() - this._visibleDuration,
                spaceSegmentById: new Map(),
                newerSegment: null,
                olderSegment: null,
            };
            this._oldestSegment = initialSegment;
            this._newestSegment = initialSegment;
        }

        const cleanup = () => {
            assert(this._state === state);

            const time = Date.now();

            // Expire any segments when the last action in the segment is no longer in the
            // history visibility window.
            while (
                this._oldestSegment !== null &&
                this._oldestSegment.startCommittedTime + this._segmentDuration <=
                    time - this._visibleDuration
            ) {
                const expiredSegment = this._oldestSegment;

                if (expiredSegment.newerSegment === null) {
                    this._oldestSegment = null;
                    this._newestSegment = null;
                } else {
                    this._oldestSegment = expiredSegment.newerSegment;
                    expiredSegment.newerSegment.olderSegment = null;
                    expiredSegment.newerSegment = null;
                }
            }

            // If we expired all the segments in our history class then create a new empty
            // segment at the beginning of our history visibility window.
            //
            // While our class is running, `this._oldestSegment` should never be null or
            // else we will ignore all incoming action transactions.
            if (this._oldestSegment === null) {
                const initialSegment = {
                    startCommittedTime: time - this._visibleDuration,
                    spaceSegmentById: new Map(),
                    newerSegment: null,
                    olderSegment: null,
                };
                this._oldestSegment = initialSegment;
                this._newestSegment = initialSegment;
            }

            // Run our cleanup function again when the oldest segment should expire.
            //
            // Remember timers are best effort and `Date.now()` is not monotonic. So we
            // always compute ourselves when we expect the next timer to run.
            state.timeout = createTimeout(
                cleanup,
                this._segmentDuration -
                    (time - this._visibleDuration - this._oldestSegment.startCommittedTime),
            );
        };

        const state = {timeout: createTimeout(cleanup, this._segmentDuration)};
        this._state = state;
    }

    /**
     * Stop recording actions. Clears the internal action history.
     */
    public stop() {
        assert(this._state !== null);
        this._state.timeout.clear();
        this._state = null;
        this._newestSegment = null;
        this._oldestSegment = null;
    }

    /**
     * Add an action transaction to our history. If we are not recording (`start()`
     * has not been called) then this function does nothing.
     */
    public addActionTransaction({
        spaceId,
        committedTime: committedTimeDate,
        actions,
    }: {
        spaceId: SpaceId;
        committedTime: Date;
        actions: ReadonlyArray<TaskAction>;
    }) {
        const committedTime = committedTimeDate.getTime();

        // Ignore actions committed before our history cutoff.
        if (
            this._oldestSegment === null ||
            committedTime < this._oldestSegment.startCommittedTime
        ) {
            return;
        }

        // If `_lastSegment` is non-null then `_firstSegment` should also be non-null.
        // They form a double-linked list.
        assert(this._newestSegment !== null);

        let segment: TaskRealtimeActionHistorySegment;

        // Create segment(s) when we receive an action transaction newer than our
        // current segments.
        if (committedTime >= this._newestSegment.startCommittedTime + this._segmentDuration) {
            while (
                committedTime >=
                this._newestSegment.startCommittedTime + this._segmentDuration
            ) {
                const olderSegment = this._newestSegment;

                const newerSegment: TaskRealtimeActionHistorySegment = {
                    startCommittedTime: olderSegment.startCommittedTime + this._segmentDuration,
                    spaceSegmentById: new Map(),
                    newerSegment: null,
                    olderSegment,
                };

                olderSegment.newerSegment = newerSegment;
                this._newestSegment = newerSegment;
            }

            segment = this._newestSegment;
        }
        // The segment for our action transaction should already exist, find it and
        // insert our action transaction.
        //
        // Search from new to old since we mostly receive transactions that ascend in
        // commit time.
        else {
            segment = this._newestSegment;
            while (committedTime < segment.startCommittedTime) {
                // This assert is safe since above in this function, we return early if
                // `committedTime` is before our oldest segment's start time.
                assert(segment.olderSegment !== null);

                segment = segment.olderSegment;
            }
        }

        const spaceSegment = getOrSetDefaultMapValue(segment.spaceSegmentById, spaceId, () => ({
            actionTransactions: [],
        }));

        spaceSegment.actionTransactions.push({
            committedTime,
            actions,
        });
    }

    /**
     * Iterate through all the action transactions for the provided space in
     * our history.
     *
     * All the actions in an action transaction are expected to be applied
     * atomically.
     */
    public iterateActionTransactions(
        spaceId: SpaceId,
        callback: (actions: ReadonlyArray<TaskAction>) => void,
    ) {
        let segment = this._oldestSegment;
        while (segment !== null) {
            const spaceSegment = segment.spaceSegmentById.get(spaceId);

            if (spaceSegment !== undefined) {
                const actionTransactionCount = spaceSegment.actionTransactions.length;
                for (let i = 0; i < actionTransactionCount; i++) {
                    callback(spaceSegment.actionTransactions[i]!.actions);
                }
            }

            segment = segment.newerSegment;
        }
    }
}
