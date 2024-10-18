import {UnknownError} from "~/shared/error/error.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {quote} from "~/shared/helpers/string/quote.js";

let htmlImageElementLoadedPromiseByElement:
    | WeakMap<HTMLImageElement, PromiseImmediate<void>>
    | undefined;

/**
 * Return a promise that resolves when the provided image element has finished
 * loading. Once this promise is resolved the image is ready to be rendered in
 * the DOM.
 *
 * If the image fails to load then the promise rejects. If you call this
 * function multiple times for the same element then we'll return the same
 * promise. We return a `PromiseImmediate` so you can figure out synchronously
 * whether the image has loaded.
 */
export function isHtmlImageElementLoaded(element: HTMLImageElement): PromiseImmediate<void> {
    htmlImageElementLoadedPromiseByElement ??= new WeakMap();

    return getOrSetDefaultMapValue(htmlImageElementLoadedPromiseByElement, element, () => {
        return new PromiseImmediate<void>((resolve, reject) => {
            const handleLoad = () => {
                element.removeEventListener("load", handleLoad);
                element.removeEventListener("error", handleLoad);

                // If there was a problem while loading the image then it'll have a natural
                // width and height of 0. In this case we never resolve the promise.
                if (element.naturalWidth === 0 && element.naturalHeight === 0) {
                    reject(new UnknownError(quote`Error loading image with source ${element.src}`));
                    return;
                }

                resolve();
            };

            if (element.complete) {
                handleLoad();
            } else {
                element.addEventListener("load", handleLoad);
                element.addEventListener("error", handleLoad);
            }
        });
    });
}
