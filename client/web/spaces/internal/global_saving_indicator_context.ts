import {createGlobalContext, getGlobalContext} from "~/client/web/helpers/global_context.js";
import {emptySet} from "~/shared/helpers/set/empty_set.open_source.js";
import {ValueStore} from "~/shared/store/value_store.js";

export const GlobalSavingIndicatorContext = createGlobalContext(
    () => new ValueStore<ReadonlySet<Promise<unknown>>>(emptySet),
);

export function addGlobalSavingIndicatorPromise(promise: Promise<unknown>) {
    const promisesStore = getGlobalContext(GlobalSavingIndicatorContext);

    if (promisesStore.getSnapshot().has(promise)) return;

    promisesStore.set(oldPromises => {
        const newPromises = new Set(oldPromises);
        newPromises.add(promise);
        return newPromises;
    });

    const remove = () => {
        promisesStore.set(oldPromises => {
            const newPromises = new Set(oldPromises);
            newPromises.delete(promise);
            return newPromises;
        });
    };

    promise.then(remove, remove);
}
