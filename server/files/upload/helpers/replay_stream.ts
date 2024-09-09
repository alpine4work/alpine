import {Duplex as DuplexStream, Readable as ReadableStream} from "stream";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * You can pipe a readable stream into a replay stream which'll buffer all
 * received writes until `ready()` as called. At which point all buffered
 * chunks will be replayed once you start consuming the stream's data.
 *
 * You can't start receiving data from a `ReplayStream` until `ready()` is
 * called. So you can't call `readyStream.pipe(writeStream)` or
 * `readyStream.on("data", listener)` until you've called `ready()` first. This
 * is because `ReplayStream` receives writes without applying backpressure
 * before `ready()` is called. Once `ready()` is called then backpressure will
 * start kicking in.
 */
export class ReplayStream extends DuplexStream {
    private _isReady = false;
    private _writeCallback: ((error?: Error | null | undefined) => void) | null = null;

    public override _read(): void {
        if (this._writeCallback !== null) {
            const callback = this._writeCallback;
            this._writeCallback = null;
            callback();
        }
    }

    public override _write(
        chunk: any,
        encoding: BufferEncoding,
        callback: (error?: Error | null | undefined) => void,
    ): void {
        if (this.push(chunk, encoding) || this._isReady === false) {
            callback();
        } else {
            this._writeCallback = callback;
        }
    }

    public override _final(callback: (error?: Error | null | undefined) => void): void {
        this.push(null);
        callback();
    }

    public ready() {
        assert(this._isReady === false);
        this._isReady = true;
    }

    public override pause(): this {
        assert(this._isReady === true);
        return super.pause();
    }

    public override resume(): this {
        assert(this._isReady === true);
        return super.resume();
    }

    public override pipe<Stream extends NodeJS.WritableStream>(
        destination: Stream,
        options?: {end?: boolean},
    ): Stream {
        assert(this._isReady === true);
        return super.pipe(destination, options);
    }

    public override unpipe(destination?: NodeJS.WritableStream | undefined): this {
        assert(this._isReady === true);
        return super.unpipe(destination);
    }

    public override on(event: "close", listener: () => void): this;
    public override on(event: "data", listener: (chunk: any) => void): this;
    public override on(event: "drain", listener: () => void): this;
    public override on(event: "end", listener: () => void): this;
    public override on(event: "error", listener: (err: Error) => void): this;
    public override on(event: "finish", listener: () => void): this;
    public override on(event: "pause", listener: () => void): this;
    public override on(event: "pipe", listener: (src: ReadableStream) => void): this;
    public override on(event: "readable", listener: () => void): this;
    public override on(event: "resume", listener: () => void): this;
    public override on(event: "unpipe", listener: (src: ReadableStream) => void): this;
    public override on(event: string | symbol, listener: (...args: Array<any>) => void): this;
    public override on(event: string | symbol, listener: (...args: Array<any>) => void): this {
        if (event === "data") {
            assert(this._isReady === true);
        }
        return super.on(event, listener);
    }
}
