import {
    ApiContentCheckListBlockElementItem,
    ApiContentListBlockElementItem,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";

export function assertApiCheckListBlockElementItem(
    item: ApiContentCheckListBlockElementItem | ApiContentListBlockElementItem,
): ApiContentCheckListBlockElementItem {
    assert(hasOwnProperty(item, "checked") && typeof item.checked === "boolean");
    return item;
}
