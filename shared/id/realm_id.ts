import {Id, generateId} from "~/shared/id/id";

let realmId: Id | undefined;

/**
 * A [realm][1] is an instance of the JavaScript platform. A window in the browser, web
 * worker, iframe, will all have different realms.
 *
 * This function gets an ID unique to our current realm that will never change for the
 * lifetime of the realm.
 *
 * [1]: https://stackoverflow.com/questions/49832187/how-to-understand-js-realms
 */
export function getRealmId(): Id {
    realmId ??= generateId();
    return realmId;
}
