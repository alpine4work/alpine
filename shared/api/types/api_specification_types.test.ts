import {
    ApiSearchResult,
    ApiSearchResultBodyMatch,
    ApiSearchResultPath,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {ApiTarget} from "~/shared/api/types/api_target.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";

test("all search results conform to the expected shape", () => {
    assertAssignableTypes<
        ApiSearchResult,
        {
            readonly type: string;
            readonly path: ApiSearchResultPath;
            readonly title: string | null;
            readonly bodyMatch: ApiSearchResultBodyMatch | null;
        }
    >();

    // Make sure `ApiSearchResultPath` is exactly equal to the search result
    // union's path property.
    assertEqualTypes<ApiSearchResult["path"], ApiSearchResultPath>();
});

test("all search results are assignable to `ApiTarget`", () => {
    assertAssignableTypes<ApiSearchResult, ApiTarget>();
});
