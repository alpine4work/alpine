import {Step} from "prosemirror-transform";
import {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {ContentEditorClientId, DocumentId} from "~/shared/id/types/id_types.js";
import {getDocumentContentSteps} from "~/shared/rpc/documents_rpc_definitions.js";

/**
 * Stores steps in an in-memory cache and loads old steps into that cache as we
 * request them.
 */
export class DocumentCollaborationStepCache {
    private _id: DocumentId;
    private _startVersion: number;
    private _endVersion: number;
    private _stepByVersion: Map<
        number,
        {
            step: Step;
            invertedStep: Step;
            clientId: ContentEditorClientId;
        }
    >;

    private _loadOldStepsState: {
        startVersionAfterPromise: number;
        promise: Promise<void>;
    } | null = null;

    constructor(id: DocumentId, version: number) {
        this._id = id;
        this._startVersion = version;
        this._endVersion = version;
        this._stepByVersion = new Map();
    }

    /**
     * Add a step to the end of our cache.
     *
     * Does not validate whether the step is valid for this document!
     */
    public dangerouslyAddStepToEnd(step: {
        step: Step;
        invertedStep: Step;
        clientId: ContentEditorClientId;
    }) {
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
        context: WorkerActionContext,
        startVersion: number,
        endVersion: number,
    ): Promise<
        Array<{
            step: Step;
            invertedStep: Step;
            clientId: ContentEditorClientId;
        }>
    > {
        if (startVersion < 0) throw new InvalidArgumentError("Start version is less than zero");
        if (startVersion > endVersion)
            throw new InvalidArgumentError("End version is greater than start version");
        if (endVersion > this._endVersion)
            throw new FailedPreconditionError(
                "End version is greater than the last version in the document",
            );

        if (startVersion === endVersion) return [];

        const steps: Array<{
            step: Step;
            invertedStep: Step;
            clientId: ContentEditorClientId;
        }> = [];

        // If we are trying to get steps not in our store, then first we need to load those
        // steps.
        if (startVersion < this._startVersion) await this._loadOldSteps(context, startVersion);
        assert(startVersion >= this._startVersion);

        for (let version = startVersion; version < endVersion; version++) {
            const step = this._stepByVersion.get(version);
            if (!step) throw new InternalError("Missing a document step");
            steps.push(step);
        }

        return steps;
    }

    private _loadOldSteps(context: WorkerActionContext, newStartVersion: number): Promise<void> {
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
            const {steps} = await getDocumentContentSteps(context, {
                documentId: this._id,
                startVersion: newStartVersion,
                endVersion,
            });

            // Before we update our store state, wait for our last load to finish.
            // `getDocumentContentSteps()` should run in parallel with this promise.
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
        void ourLoadOldStepsState.promise.finally(() => {
            if (this._loadOldStepsState === ourLoadOldStepsState) {
                this._loadOldStepsState = null;
            }
        });

        this._loadOldStepsState = ourLoadOldStepsState;

        return promise;
    }
}
