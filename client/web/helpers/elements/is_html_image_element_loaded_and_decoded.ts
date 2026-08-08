import {UnknownError} from "~/shared/error/error.open_source.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

let htmlImageElementLoadedAndDecodedPromiseByElement:
    | WeakMap<HTMLImageElement, PromiseImmediate<void>>
    | undefined;

/**
 * Return a promise that resolves when the provided image element has finished
 * loading and decoding. Once this promise is resolved the image is ready to be
 * rendered in the DOM.
 *
 * If the image fails to load then the promise rejects. If you call this function
 * multiple times for the same element then we'll return the same promise. We
 * return a `PromiseImmediate` so you can figure out synchronously whether the
 * image has loaded.
 */
export function isHtmlImageElementLoadedAndDecoded(
    element: HTMLImageElement,
): PromiseImmediate<void> {
    htmlImageElementLoadedAndDecodedPromiseByElement ??= new WeakMap();

    return getOrSetDefaultMapValue(
        htmlImageElementLoadedAndDecodedPromiseByElement,
        element,
        () => {
            return new PromiseImmediate<void>((resolve, reject) => {
                const handleLoad = () => {
                    element.removeEventListener("load", handleLoad);
                    element.removeEventListener("error", handleLoad);

                    // If there was a problem while loading the image then it'll have a natural width
                    // and height of 0. In this case we never resolve the promise.
                    if (element.naturalWidth === 0 && element.naturalHeight === 0) {
                        reject(
                            new UnknownError(quote`Error loading image with source ${element.src}`),
                        );
                        return;
                    }

                    // Only decode images which need asynchronous decoding.
                    if (element.decoding === "sync") {
                        resolve();
                    } else {
                        element.decode().then(
                            resolve,
                            // NOTE(calebmer, 2024-10-17): Sometimes when decoding fails it's actually fine and
                            // the browser can render the image. Don't know why but fine I'll ignore errors for
                            // now.
                            resolve,
                        );
                    }
                };

                if (element.complete) {
                    handleLoad();
                } else {
                    element.addEventListener("load", handleLoad);
                    element.addEventListener("error", handleLoad);
                }
            });
        },
    );
}
