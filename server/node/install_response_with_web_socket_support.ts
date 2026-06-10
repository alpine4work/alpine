// Cloudflare allows attaching a `webSocket` to a response object. Our Node.js
// `createStandardizedServer()` uses the same API for WebSockets so knows to look
// for this property.
//
// https://developers.cloudflare.com/workers/runtime-apis/websockets/use-websockets/
declare global {
    interface ResponseInit {
        webSocket?: globalThis.WebSocket | null;
    }

    interface Response {
        webSocket: globalThis.WebSocket | null;
    }
}

let ActualResponse = globalThis.Response;

// If we are in a Node.js environment then replace the `Response` global with one
// that supports `webSocket` in its `RequestInit`.
if (process.versions.node) {
    const OriginalResponse = globalThis.Response;

    // WebSocket support in `Response` adapted from:
    // https://github.com/cloudflare/miniflare/blob/7e4d906e19cc69cd3446512bfeb7f8aee3a2bda7/packages/core/src/standards/http.ts#L624-L635
    class Response extends OriginalResponse {
        private readonly _status?: number;
        private readonly _webSocket: globalThis.WebSocket | null;

        constructor(body?: BodyInit | null, init?: ResponseInit) {
            let status: number | undefined;
            let webSocket: globalThis.WebSocket | undefined;

            // Status 101 Switching Protocols would normally throw a RangeError, but we need to
            // allow it for WebSockets
            if (init && init.webSocket) {
                if (init.status !== 101) {
                    throw new RangeError("Responses with a WebSocket must have status code 101.");
                }
                status = init.status;
                webSocket = init.webSocket;
                init = {...init, status: 200};
            }

            super(body, init);

            if (status !== undefined) this._status = status;
            this._webSocket = webSocket ?? null;
        }

        public override get status() {
            return this._status ?? super.status;
        }

        public override get webSocket() {
            return this._webSocket;
        }
    }

    Object.defineProperty(globalThis, "Response", {value: Response});
    ActualResponse = Response;
}

export {ActualResponse as Response};
