import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.open_source.js";

/**
 * Does the provided object have any own properties?
 */
export function hasAnyOwnProperties(object: {[key: string]: unknown}): boolean {
    for (const key in object) {
        if (hasOwnProperty(object, key)) {
            return true;
        }
    }
    return false;
}
