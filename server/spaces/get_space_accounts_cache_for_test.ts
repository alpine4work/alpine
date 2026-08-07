import {
    SpaceAccountsCache,
    spaceAccountsCache,
} from "~/server/spaces/internal/space_accounts_cache.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export function getSpaceAccountsCacheForTest(): SpaceAccountsCache {
    assert(process.env.NODE_ENV === "test");
    return spaceAccountsCache;
}
