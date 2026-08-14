import {Step} from "prosemirror-transform";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {ContentEditorClientId} from "~/shared/id/types/id_types.js";

export type CollaborationStepCacheStep = {
    step: Step;
    invertedStep: Step;
    clientId: ContentEditorClientId;
};

type CollaborationStepCacheLoadSteps<ContextType> = (
    context: ContextType,
    versions: {
        startVersion: number;
        endVersion: number;
    },
) => Promise<{
    steps: ReadonlyArray<CollaborationStepCacheStep>;
}>;

/**
 * Stores prosemirror steps in an in-memory read-through cache to avoid having to
 * load steps from the database on every read.
 */
export class CollaborativeContentStepCache<ContextType> {
    private _startVersion: number;
    private _endVersion: number;
    private _stepByVersion: Map<number, CollaborationStepCacheStep>;
    private _loadSteps: CollaborationStepCacheLoadSteps<ContextType>;

    private _loadOldStepsState: {
        startVersionAfterPromise: number;
        promise: Promise<void>;
    } | null = null;

    constructor(options: {
        startVersion: number;
        loadSteps: CollaborationStepCacheLoadSteps<ContextType>;
    }) {
        this._startVersion = options.startVersion;
        this._endVersion = options.startVersion;
        this._stepByVersion = new Map();
        this._loadSteps = options.loadSteps;
    }

    /**
     * Add a step to the end of our cache.
     *
     * Does not validate whether the step is valid for its content!
     */
    public dangerouslyAddStepToEnd(step: CollaborationStepCacheStep) {
        this._stepByVersion.set(this._endVersion, step);
        this._endVersion += 1;
    }

    /**
     * Reads all steps between `startVersion` (inclusive) and `endVersion` (exclusive).
     *
     * We cache steps in memory so we return steps from our in-memory cache if we have
     * them. If we don't have the steps in our cache then we load steps from the
     * database and put them in our in-memory cache for future requests.
     */
    public async getSteps(
        context: ContextType,
        startVersion: number,
        endVersion: number,
    ): Promise<Array<CollaborationStepCacheStep>> {
        if (startVersion < 0)
            throw new InvalidArgumentError("Start version cannot be less than zero");
        if (startVersion > endVersion)
            throw new InvalidArgumentError(
                "Cannot get collaborative content steps with start version greater than end version",
            );
        if (endVersion > this._endVersion)
            throw new FailedPreconditionError(
                "Cannot get collaborative content steps with end version greater than the last version in the cache",
            );

        if (startVersion === endVersion) return [];

        const steps: Array<CollaborationStepCacheStep> = [];

        // If we are trying to get steps not in our store, then first we need to load those
        // steps.
        if (startVersion < this._startVersion) await this._loadOldSteps(context, startVersion);
        assert(startVersion >= this._startVersion);

        for (let version = startVersion; version < endVersion; version++) {
            const step = this._stepByVersion.get(version);
            if (!step) throw new InternalError("Missing step in collaborative content step cache");
            steps.push(step);
        }

        return steps;
    }

    private _loadOldSteps(context: ContextType, newStartVersion: number): Promise<void> {
        assert(newStartVersion < this._startVersion);

        // If we have a promise that is already loading all the steps after
        // `newStartVersion` then return that promise. Don't load steps again!
        if (
            this._loadOldStepsState &&
            this._loadOldStepsState.startVersionAfterPromise <= newStartVersion
        ) {
            return this._loadOldStepsState.promise;
        }

        // If we are currently loading steps, then load more steps up to the version we are
        // loading. (So we don't load steps twice.) Otherwise load steps up to the current
        // stored start version.
        const lastLoadOldStepsState = this._loadOldStepsState;
        const endVersion = lastLoadOldStepsState?.startVersionAfterPromise ?? this._startVersion;

        const promise = (async () => {
            const {steps} = await this._loadSteps(context, {
                startVersion: newStartVersion,
                endVersion,
            });

            // Before we update our store state, wait for our last load to finish. The current
            // load should run in parallel with this promise.
            if (lastLoadOldStepsState) await lastLoadOldStepsState.promise;

            // Populate the steps we loaded in our store. We expect every step to only be
            // loaded once.
            for (let version = newStartVersion; version < endVersion; version++) {
                const step = steps[version - newStartVersion];
                assert(step);
                assert(!this._stepByVersion.has(version));
                this._stepByVersion.set(version, step);
            }

            this._startVersion = newStartVersion;
        })();

        const ourLoadOldStepsState = {
            startVersionAfterPromise: newStartVersion,
            promise,
        };

        // If when the promise resolves, our load state is still the current load state
        // then clear the load state.
        void ourLoadOldStepsState.promise
            .finally(() => {
                if (this._loadOldStepsState === ourLoadOldStepsState) {
                    this._loadOldStepsState = null;
                }
            })
            .catch(() => {});

        this._loadOldStepsState = ourLoadOldStepsState;

        return promise;
    }
}
