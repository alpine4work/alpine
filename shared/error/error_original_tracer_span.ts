import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.js";

export type OriginalTracerSpan = {
    readonly time: Date;
    readonly traceId: TraceId;
    readonly spanId: TraceSpanId;
};

// Original tracer spans are stored in a `WeakMap` instead of our `ErrorBase`
// constructor to support error objects that were not created by our
// `ErrorBase` constructor.
const originalTracerSpanByError =
    process.env.NODE_ENV !== "development"
        ? new WeakMap<object, OriginalTracerSpan>()
        : // In development, because of our Vite hot reloading setup, this file may be
          // imported twice. So to correctly track original tracer spans we need a shared
          // global.
          ((globalThis as any).__originalTracerSpanByError ??= new WeakMap<
              object,
              OriginalTracerSpan
          >());

export function getErrorOriginalTracerSpan(error: unknown): OriginalTracerSpan | undefined {
    if (typeof error !== "object" || error === null) return undefined;

    return originalTracerSpanByError.get(error);
}

export function setErrorOriginalTracerSpan(error: unknown, original: OriginalTracerSpan): void {
    if (typeof error !== "object" || error === null) return undefined;

    originalTracerSpanByError.set(error, original);
}

export type ErrorOriginalTracerSpanResult =
    | {
          readonly isOriginal: true;
          readonly originalSpan?: undefined;
      }
    | {
          readonly isOriginal: false;
          readonly originalSpan: OriginalTracerSpan;
      };

export function getOrSetErrorOriginalTracerSpan(
    error: unknown,
    getCurrentSpan: () => OriginalTracerSpan,
): ErrorOriginalTracerSpanResult {
    if (typeof error !== "object" || error === null) return {isOriginal: true};

    const originalSpan = originalTracerSpanByError.get(error);
    if (originalSpan) return {isOriginal: false, originalSpan};

    originalTracerSpanByError.set(error, getCurrentSpan());
    return {isOriginal: true};
}
