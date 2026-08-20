import {
    ApiContentCheckListBlockElementItemRequest,
    ApiContentListBlockElementItemRequest,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.open_source.js";

export function assertApiCheckListBlockElementItem(
    item: ApiContentCheckListBlockElementItemRequest | ApiContentListBlockElementItemRequest,
): ApiContentCheckListBlockElementItemRequest {
    assert(hasOwnProperty(item, "checked") && typeof item.checked === "boolean");
    return item;
}
