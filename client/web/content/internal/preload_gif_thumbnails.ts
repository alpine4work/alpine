import {IGif} from "@giphy/js-types";
import {isHtmlImageElementLoadedAndDecoded} from "~/client/web/helpers/elements/is_html_image_element_loaded_and_decoded.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";

/**
 * Maximum number of preloaded thumbnails to keep cached. When the limit is
 * exceeded the oldest entries are evicted (FIFO).
 */
const maxPreloadCacheSize = 50;

/**
 * Deduplication map: URL -> Promise that resolves when the image is loaded and
 * decoded. Entries are evicted in FIFO order once the map exceeds
 * `maxPreloadCacheSize`.
 */
const preloadPromises = new Map<string, Promise<void>>();

/**
 * Preload thumbnail images for a batch of GIFs so they render instantly when the
 * picker grid appears.
 */
export function preloadGifThumbnails(gifs: ReadonlyArray<IGif>): Promise<void> {
    const promises: Array<Promise<void>> = [];

    for (const gif of gifs) {
        const url = gif.images.fixed_width.url;
        if (!url) continue;

        const existing = preloadPromises.get(url);
        if (existing) {
            promises.push(existing);
        } else {
            const img = new Image();
            img.decoding = "async";
            img.src = url;
            // Wrap PromiseImmediate in a standard Promise and swallow errors — preload
            // failures are non-fatal.
            const promise = new Promise<void>(resolve => {
                isHtmlImageElementLoadedAndDecoded(img).then(
                    () => resolve(),
                    () => resolve(),
                );
            });
            preloadPromises.set(url, promise);
            promises.push(promise);

            // Evict oldest entries when the cache exceeds the limit.
            while (preloadPromises.size > maxPreloadCacheSize) {
                const oldestKey = preloadPromises.keys().next().value;
                if (oldestKey !== undefined) {
                    preloadPromises.delete(oldestKey);
                }
            }
        }
    }

    return runAllPromises(promises).then(() => undefined);
}
