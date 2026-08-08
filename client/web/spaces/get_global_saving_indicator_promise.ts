import {getGlobalContext} from "~/client/web/helpers/global_context.js";
import {GlobalSavingIndicatorContext} from "~/client/web/spaces/internal/global_saving_indicator_context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {noop} from "~/shared/helpers/control/noop.open_source.js";

/**
 * Return a promise that resolves when all `{type: "Saving"}` promises added via
 * `global_loading_indicator.ts` have resolved.
 */
export function getGlobalSavingIndicatorPromise(): Promise<void> {
    const promisesStore = getGlobalContext(GlobalSavingIndicatorContext);

    return runAllPromises(promisesStore.getSnapshot()).then(noop, noop);
}
