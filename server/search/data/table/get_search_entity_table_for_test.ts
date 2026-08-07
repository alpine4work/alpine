import {SearchEntityTable} from "~/server/search/data/table/internal/search_entity_table.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export function getSearchEntityTableForTest() {
    assert(import.meta.jest);
    return SearchEntityTable;
}
