import {
    ApiContentCheckListBlockElementItem,
    ApiContentListBlockElementItem,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";

export function assertApiChecklistBlockElementItem(
    item: ApiContentCheckListBlockElementItem | ApiContentListBlockElementItem,
): ApiContentCheckListBlockElementItem {
    assert(typeof item.checked === "boolean", "Check list items must contain a `checked` property");
    return item;
}
