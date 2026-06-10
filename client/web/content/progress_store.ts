import {Easing, easeOutQuint} from "~/shared/design/core/easing.js";
import {perceivedAsInstantLimitMs} from "~/shared/design/core/timing.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {lerp} from "~/shared/helpers/number/lerp.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

export type ProgressValueStoreWithCancel = ProgressValueStore & {
    readonly isCancelled: () => boolean;
    readonly cancel: () => void;
};

/**
 * Create a progress store composed of multiple smaller progress stores. Each
 * individual progress store contributes to the final progress value we show the
 * user.
 *
 * You provide an array of weights and we return a `ProgressValueStore` for each
 * weight. If you think one progress store will take longer than the others you
 * should give it a larger weight.
 *
 * If you no longer need a progress component you may cancel it. The progress it
 * has already contributed will be frozen but from then on if other progress stores
 * update they won't be weighted down by the cancelled store.
 */
// NOTE(calebmer, 2024-10-11): This feels like the wrong abstraction. When I wrote
// it I thought I'd also be using it on the server and that I'd be manually
// instrumenting each file processor. But that approach felt like it would be too
// much maintenance given many of the tools we use don't report progress (e.g.
// `sharp` and LibreOffice). So instead I decided to create a really dumb model to
// estimate upload duration on the client. Now that we're only using this progress
// store file on the client maybe there's a simpler way to implement this code that
// doesn't create an unnecessary abstraction. After all, I certainly hold to the
// wisdom: "No abstraction is better than the wrong abstraction".
export function createProgressCompositeStore<const Weights extends ReadonlyArray<number>>(
    weights: Weights,
): [Store<number>, {[Key in keyof Weights]: ProgressValueStoreWithCancel}] {
    const cancellationStore = new ValueStore<{
        readonly lastProgressComposite: number;
        readonly lastProgresses: ReadonlyArray<number>;
        readonly cancelledIndexes: ReadonlySet<number>;
    }>({
        lastProgressComposite: 0,
        lastProgresses: createArrayWithLength(weights.length, () => 0),
        cancelledIndexes: emptySet,
    });

    const progressStores = weights.map((weight, index) => {
        const store = new ProgressValueStore();

        return Object.assign(store, {
            isCancelled: () => {
                return cancellationStore.getSnapshot().cancelledIndexes.has(index);
            },
            cancel: () => {
                const lastProgressComposite = progressCompositeStore.getSnapshot();
                const lastProgresses = progressStores.map(progressStore =>
                    progressStore.getSnapshot(),
                );
                const lastCancellation = cancellationStore.getSnapshot();

                // Noop if already cancelled.
                if (lastCancellation.cancelledIndexes.has(index)) return;

                const nextCancelledIndexes = new Set(lastCancellation.cancelledIndexes);
                nextCancelledIndexes.add(index);

                cancellationStore.set({
                    lastProgressComposite,
                    lastProgresses,
                    cancelledIndexes: nextCancelledIndexes,
                });
            },
        });
    });

    const progressCompositeStore = computeStore(get => {
        const cancellation = get(cancellationStore);
        const progresses = progressStores.map(get);

        let totalWeight = 0;
        let totalProgress = 0;
        let totalLastProgress = 0;

        for (let index = 0; index < weights.length; index++) {
            if (cancellation.cancelledIndexes.has(index)) continue;

            const weight = weights[index]!;
            const progress = progresses[index]!;
            const lastProgress = cancellation.lastProgresses[index]!;

            totalWeight += weight;
            totalProgress += progress * weight;
            totalLastProgress += lastProgress * weight;
        }

        const progressComposite = totalProgress / totalWeight;
        const lastProgressCompositeWithoutCancels = totalLastProgress / totalWeight;

        return (
            cancellation.lastProgressComposite +
            ((progressComposite - lastProgressCompositeWithoutCancels) /
                (1 - lastProgressCompositeWithoutCancels)) *
                (1 - cancellation.lastProgressComposite)
        );
    });

    return [
        progressCompositeStore,
        progressStores as {[Key in keyof Weights]: ProgressValueStoreWithCancel},
    ];
}

/**
 * A `ValueStore` specifically for a progress percentage. The value is always
 * between 0 and 1 and the value will never decrease. Once we reach 1 the store
 * finalizes.
 */
export class ProgressValueStore extends Store<number> {
    private readonly _store = new ValueStore(0);
    private _cancelEase: (() => void) | null = null;

    public override isFinal(): boolean {
        return this._store.isFinal();
    }

    public override readonly getSnapshot = (): number => {
        return this._store.getSnapshot();
    };

    public override addListener(listener: () => void): void {
        this._store.addListener(listener);
    }

    public override removeListener(listener: () => void): void {
        this._store.removeListener(listener);
    }

    public override _addWeakImmediateListener(listener: () => void): void {
        this._store._addWeakImmediateListener(listener);
    }

    public override _removeWeakImmediateListener(listener: () => void): void {
        this._store._removeWeakImmediateListener(listener);
    }

    /**
     * Set the current progress value. Can't set to a value less than the current
     * progress value. The progress value must be between 0 and 1. Setting progress to
     * 1 finalizes the store.
     */
    public set(progress: number | ((progress: number) => number)) {
        const oldProgress = this._store.getSnapshot();
        const newProgress = Math.max(
            oldProgress,
            clamp(0, typeof progress === "function" ? progress(oldProgress) : progress, 1),
        );

        if (oldProgress !== newProgress) {
            if (newProgress === 1) {
                this._store.finalSet(newProgress);
                this._cancelEase?.();
                this._cancelEase = null;
            } else {
                this._store.set(newProgress);
            }
        }
    }

    /** Cancel any in-progress easing animation. */
    public cancelEase(): void {
        this._cancelEase?.();
        this._cancelEase = null;
    }

    /**
     * Eases the progress monitor from 0 to ~0.86 over a third of the provided duration
     * and from 0 to ~0.99 over the full provided duration. Starts by quickly updating
     * progress then slows down over time.
     *
     * Use this when you don't have a way to track progress but you know the p95 time
     * is around `duration`. This function will provide a realistic looking progress
     * indicator even if it isn't quite anchored in reality.
     *
     * Updates the store every `perceivedAsInstantLimitMs`.
     */
    public ease(duration: number, startProgress: number = 0, endProgress: number = 0.99) {
        // `easeOutCirc(1 / 3)` is ~0.86
        this._ease(easeOutQuint, duration, startProgress, endProgress);
    }

    private _ease(easing: Easing, duration: number, startProgress: number, endProgress: number) {
        this._cancelEase?.();
        this._cancelEase = null;

        startProgress = clamp(0, startProgress, 1);
        endProgress = clamp(0, endProgress, 1);

        const startTime = Date.now();
        let timeout: Timeout | undefined;

        const loop = () => {
            const currentTime = Date.now();
            const elapsed = currentTime - startTime;

            this.set(
                clamp(
                    startProgress,
                    lerp(startProgress, endProgress, easing(elapsed / duration)),
                    endProgress,
                ),
            );

            if (this._store.getSnapshot() < endProgress) {
                timeout = createTimeout(loop, perceivedAsInstantLimitMs);
            }
        };

        loop();

        this._cancelEase = () => {
            timeout?.clear();
        };
    }
}
