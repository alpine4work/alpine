import {generateId} from "~/shared/id/id.open_source.js";
import {RealmId} from "~/shared/id/types/id_types.open_source.js";

let realmId: RealmId | undefined;

/**
 * A [realm][1] is an instance of the JavaScript platform. A window in the browser,
 * web worker, iframe, will all have different realms.
 *
 * This function gets an ID unique to our current realm that will never change for
 * the lifetime of the realm.
 *
 * [1]: https://stackoverflow.com/questions/49832187/how-to-understand-js-realms
 */
export function getRealmId(): RealmId {
    realmId ??= generateId<RealmId>();
    return realmId;
}
