import {InternalError} from "~/shared/error/error.open_source.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {
    AccountId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {
    TaskAction,
    TaskUpdateAccountNameAction,
    TaskUpdateCollectionAction,
    TaskUpdateTaskAction,
} from "~/shared/tasks/actions/task_action.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";

/**
 * A segment of actions loaded in our history. Each segment holds a range of
 * history from `startCommittedTime` (inclusive) to
 * `startCommittedTime + history._segmentDuration` (exclusive).
 *
 * Segments form a doubly linked list which makes it easy for us to garbage collect
 * entire segment of actions at the end of the list at once.
 */
type TaskRealtimeActionHistorySegment = {
    readonly startCommittedTime: number;
    readonly spaceSegmentById: Map<SpaceId, TaskRealtimeActionHistorySpaceSegment>;
    newerSegment: TaskRealtimeActionHistorySegment | null;
    olderSegment: TaskRealtimeActionHistorySegment | null;
};

/**
 * Action history segment for a single space. Task actions do not cross space
 * boundaries. Action transactions are ordered by the time we received them. Not by
 * `committedTime` and not by logical `action.time`. Actions are designed to be
 * applied out-of-order so this is fine.
 *
 * We also keep a map of task actions by `TaskId` so if we only want to iterate
 * over the actions for a single task we can.
 */
type TaskRealtimeActionHistorySpaceSegment = {
    readonly actionTransactions: Array<TaskRealtimeActionHistorySpaceSegmentActionTransaction>;
    readonly actionsByTaskId: Map<TaskId, Array<TaskUpdateTaskAction>>;
    readonly actionsByCollectionId: Map<TaskCollectionId, Array<TaskUpdateCollectionAction>>;
    readonly updateAccountNameActions: Array<TaskUpdateAccountNameAction>;

    // Keep track of accounts referenced by actions in this segment. We need up-to-date
    // account names for computing `TaskQuerySortCursor`s. The account in this map may
    // be out-of-date in older segments. Newer segments should have a
    // `TaskUpdateAccountNameAction` action with the new name.
    readonly actionReferencedAccountById: Map<AccountId, AccountModel>;
};

type TaskRealtimeActionHistorySpaceSegmentActionTransaction = {
    readonly committedTime: number;
    readonly actions: ReadonlyArray<TaskAction>;
};

/**
 * `TaskRealtimeActionHistory` interface where you can only read actions and not
 * add new actions.
 */
export interface ReadonlyTaskRealtimeActionHistory {
    iterateActions(
        tracer: TracerBase,
        spaceId: SpaceId,
        callback: (
            action: TaskAction,
            options: {
                getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount;
            },
        ) => void,
    ): void;

    iterateTaskActions(
        tracer: TracerBase,
        spaceId: SpaceId,
        taskId: TaskId,
        callback: (
            action: TaskUpdateTaskAction | TaskUpdateAccountNameAction,
            options: {
                getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount;
            },
        ) => void,
    ): void;

    iterateCollectionActions(
        tracer: TracerBase,
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
        callback: (
            action: TaskUpdateCollectionAction,
            options: {
                getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount;
            },
        ) => void,
    ): void;
}

/**
 * Holds all actions within the last 10 minutes (by default) so we can replay the
 * recent action history after loading some data from OpenSearch to make sure what
 * we send to the user is fully caught up and can be maintained in realtime.
 */
export class TaskRealtimeActionHistory implements ReadonlyTaskRealtimeActionHistory {
    /**
     * Determines the history visibility window. We keep track of actions committed
     * this long before the present. By default the visibility window is 10 minutes.
     * That means the last 10 minutes of actions are tracked by this class by default.
     *
     * Our visibility window needs to be generous enough for us to catch up a query
     * made against our OpenSearch task index. Our task index refreshes every 30
     * seconds. Then add to that the latency between committing an action transaction
     * and indexing it. 10 minutes feels like we'll comfortably have enough visibility
     * to catch up an OpenSearch query.
     *
     * We may temporarily hold slightly more actions than this duration in history.
     * `_segmentDuration` influences how often we cleanup old actions.
     */
    private readonly _visibleDuration = 1000 * 60 * 10;

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
     * If we are actively recording history (`start()` was called) then this will be
     * non-null. While we are actively running, both `this._newestSegment` and
     * `this._oldestSegment` should be non-null.
     */
    private _state: {timeout: Timeout} | null = null;

    private constructor() {}

    /**
     * Create a new history object. Only the history object creator can call `start()`
     * and `stop()`.
     */
    public static new(): [TaskRealtimeActionHistory, {start: () => void; stop: () => void}] {
        const history = new TaskRealtimeActionHistory();
        return [history, {start: () => history._start(), stop: () => history._stop()}];
    }

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
                  // running) and `\_newestSegment should be null (doubly linked list is empty).
                  this._state === null && this._newestSegment === null
                : // If `_oldestSegment` is not null then `_state` should not be null (history is
                  // running) and there should be no older segment.
                  this._state !== null && segment.olderSegment === null,
        );

        while (segment !== null) {
            assert(
                segment.newerSegment === null
                    ? // If there is no newer segment then this should be our newest segment.
                      this._newestSegment === segment
                    : // Make sure the doubly linked list back link is correct and make sure our segment
                      // start times are evenly spaced out.
                      segment.newerSegment.olderSegment === segment &&
                          segment.newerSegment.startCommittedTime ===
                              segment.startCommittedTime + this._segmentDuration,
            );

            // Make sure action transactions have the right `committedTime` for the segment.
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
    private _start() {
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
            // While our class is running, `this._oldestSegment` should never be null or else
            // we will ignore all incoming action transactions.
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
            // Remember timers are best effort and `Date.now()` is not monotonic. So we always
            // compute ourselves when we expect the next timer to run.
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
    private _stop() {
        assert(this._state !== null);
        this._state.timeout.clear();
        this._state = null;
        this._newestSegment = null;
        this._oldestSegment = null;
    }

    /**
     * Add an action transaction to our history. If we are not recording (`start()` has
     * not been called) then this function does nothing.
     */
    public addActionTransaction(
        {
            spaceId,
            committedTime: committedTimeDate,
            actions,
        }: {
            spaceId: SpaceId;
            committedTime: Date;
            actions: ReadonlyArray<TaskAction>;
        },
        actionReferencedAccounts: ReadonlyArray<AccountModel>,
    ) {
        const committedTime = committedTimeDate.getTime();

        // Ignore actions committed before our history cutoff.
        if (
            this._oldestSegment === null ||
            committedTime < this._oldestSegment.startCommittedTime
        ) {
            return;
        }

        // If `_lastSegment` is non-null then `_firstSegment` should also be non-null. They
        // form a double-linked list.
        assert(this._newestSegment !== null);

        let segment: TaskRealtimeActionHistorySegment;

        // Create segment(s) when we receive an action transaction newer than our current
        // segments.
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
        // The segment for our action transaction should already exist, find it and insert
        // our action transaction.
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
            actionsByTaskId: new Map(),
            actionsByCollectionId: new Map(),
            actionReferencedAccountById: new Map(),
            updateAccountNameActions: [],
        }));

        spaceSegment.actionTransactions.push({
            committedTime,
            actions,
        });

        for (const action of actions) {
            switch (action.type) {
                case "UpdateTask": {
                    getOrSetDefaultMapValue(
                        spaceSegment.actionsByTaskId,
                        action.taskId,
                        () => [],
                    ).push(action);
                    break;
                }
                case "UpdateCollection": {
                    getOrSetDefaultMapValue(
                        spaceSegment.actionsByCollectionId,
                        action.collectionId,
                        () => [],
                    ).push(action);
                    break;
                }
                case "UpdateAccountName": {
                    spaceSegment.updateAccountNameActions.push(action);
                    break;
                }
                case "UpdateNotepadPage": {
                    break;
                }
                default:
                    throw exhaustive(action);
            }
        }

        // Put updated accounts in `referencedAccountById`. If an account already exists in
        // the map with the latest version then we don't need to override it.
        for (const newAccount of actionReferencedAccounts) {
            const oldAccount = spaceSegment.actionReferencedAccountById.get(newAccount.id);
            if (!oldAccount || oldAccount.initialData.version < newAccount.initialData.version) {
                spaceSegment.actionReferencedAccountById.set(newAccount.id, newAccount);
            }
        }
    }

    private _getActionReferencedSortableAccount(
        spaceId: SpaceId,
        accountId: AccountId,
    ): TaskSortableAccount {
        let segment = this._newestSegment;
        while (segment !== null) {
            const account = segment.spaceSegmentById
                .get(spaceId)
                ?.actionReferencedAccountById.get(accountId);
            if (account) {
                return {
                    accountId,
                    workingAccountName: account.initialData.name,
                    workingAccountNameVersion: account.initialData.nameVersion,
                };
            }

            segment = segment.olderSegment;
        }

        throw new InternalError(
            "Expected account referenced by task action to be available in action history",
        );
    }

    /**
     * Iterate through all the action transactions for the provided space in our
     * history.
     */
    public iterateActions(
        tracer: TracerBase,
        spaceId: SpaceId,
        callback: (
            action: TaskAction,
            options: {
                getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount;
            },
        ) => void,
    ) {
        const options = {
            getActionReferencedSortableAccount: (accountId: AccountId) =>
                this._getActionReferencedSortableAccount(spaceId, accountId),
        };

        let segment = this._oldestSegment;
        while (segment !== null) {
            const spaceSegment = segment.spaceSegmentById.get(spaceId);

            if (spaceSegment !== undefined) {
                const spaceSegmentActionTransactionCount = spaceSegment.actionTransactions.length;

                for (let i = 0; i < spaceSegmentActionTransactionCount; i++) {
                    const actions = spaceSegment.actionTransactions[i]!.actions;

                    for (const action of actions) {
                        callback(action, options);
                    }
                }
            }

            segment = segment.newerSegment;
        }
    }

    /**
     * Iterate through all the action transactions for the provided task in our
     * history.
     */
    public iterateTaskActions(
        tracer: TracerBase,
        spaceId: SpaceId,
        taskId: TaskId,
        callback: (
            action: TaskUpdateTaskAction | TaskUpdateAccountNameAction,
            options: {
                getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount;
            },
        ) => void,
    ) {
        const options = {
            getActionReferencedSortableAccount: (accountId: AccountId) =>
                this._getActionReferencedSortableAccount(spaceId, accountId),
        };

        let segment = this._oldestSegment;
        while (segment !== null) {
            const spaceSegment = segment.spaceSegmentById.get(spaceId);

            if (spaceSegment !== undefined) {
                const actions = spaceSegment.actionsByTaskId.get(taskId);

                if (actions !== undefined) {
                    for (const action of actions) {
                        callback(action, options);
                    }
                }

                // `UpdateAccountName` actions need to be applied against every task.
                for (const action of spaceSegment.updateAccountNameActions) {
                    callback(action, options);
                }
            }

            segment = segment.newerSegment;
        }
    }

    /**
     * Iterate through all the action transactions for the provided collection in our
     * history.
     */
    public iterateCollectionActions(
        tracer: TracerBase,
        spaceId: SpaceId,
        collectionId: TaskCollectionId,
        callback: (
            action: TaskUpdateCollectionAction,
            options: {
                getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount;
            },
        ) => void,
    ) {
        const options = {
            getActionReferencedSortableAccount: (accountId: AccountId) =>
                this._getActionReferencedSortableAccount(spaceId, accountId),
        };

        let segment = this._oldestSegment;
        while (segment !== null) {
            const actions = segment.spaceSegmentById
                .get(spaceId)
                ?.actionsByCollectionId.get(collectionId);

            if (actions !== undefined) {
                for (const action of actions) {
                    callback(action, options);
                }
            }

            segment = segment.newerSegment;
        }
    }
}
