import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {Clock} from "~/shared/helpers/clock/clock.open_source.js";
import {MonotonicClock} from "~/shared/helpers/clock/monotonic_clock.open_source.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.open_source.js";

/**
 * A clock which attempts to keep an inaccurate system clock synchronized with an
 * accurate clock on some server. So we can generate times consistent with the
 * server's clock. Used on the client.
 */
export class SynchronizedSystemClock implements Clock {
    private readonly _offset: number;
    private readonly _fetchSample: () => Promise<number>;
    private _syncMutex: Mutex | null = null;

    private constructor(fetchSample: () => Promise<number>, offset: number) {
        this._fetchSample = fetchSample;
        this._offset = offset;
    }

    /**
     * Creates a `SynchronizedSystemClock` and performs an initial sync with the
     * server. The initial sync takes at least 5 samples (which means 5 network
     * roundtrips), so initializing a `SynchronizedSystemClock` may take some time.
     */
    public static async new(fetchSample: () => Promise<number>): Promise<SynchronizedSystemClock> {
        const offset = await sync(fetchSample);
        return new SynchronizedSystemClock(fetchSample, offset);
    }

    /**
     * The current offset (in milliseconds) between the `unsynchronizedSystemClock`
     * time and the server time.
     */
    public get offset(): number {
        return this._offset;
    }

    /**
     * Returns the current, synchronized, time. Which is the time from
     * `unsynchronizedSystemClock` plus the current offset.
     */
    public now(): number {
        return unsynchronizedSystemClock.now() + this._offset;
    }

    /**
     * Re-sync the time. Clients may call this when the browsers closes and reopens,
     * for instance.
     */
    public async sync(): Promise<void> {
        this._syncMutex ??= new Mutex();

        await this._syncMutex.withLock(async () => {
            await sync(this._fetchSample);
        });
    }
}

async function sync(fetchSample: () => Promise<number>): Promise<number> {
    const samples: Array<Sample> = [];

    for (let i = 0; i < 5; i++) {
        samples.push(await actuallyFetchSample(fetchSample));
    }

    // We want to use the sample with the shortest round trip time as that's closest to
    // an idealized "instant" request.
    samples.sort((sample1, sample2) => sample1.roundTripTime - sample2.roundTripTime);

    const {offset} = samples[0]!;

    return offset;
}

type Sample = {
    readonly roundTripTime: number;
    readonly offset: number;
};

async function actuallyFetchSample(fetchSample: () => Promise<number>): Promise<Sample> {
    const clock = new MonotonicClock(unsynchronizedSystemClock);

    const clientStartTime = clock.now();
    const serverTime = await fetchSample();
    const clientEndTime = clock.now();

    const roundTripTime = clientEndTime - clientStartTime;

    const offset = serverTime - (clientStartTime + roundTripTime / 2);

    return {roundTripTime, offset};
}
