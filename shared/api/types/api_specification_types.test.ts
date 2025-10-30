import {
    ApiSearchResult,
    ApiSearchResultBodyMatches,
    ApiSearchResultPath,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";

test("all search results conform to the expected shape", () => {
    assertAssignableTypes<
        ApiSearchResult,
        {
            readonly type: string;
            readonly path: ApiSearchResultPath;
            readonly title: string | null;
            readonly bodyMatch: ApiSearchResultBodyMatches | null;
        }
    >();

    // Make sure `ApiSearchResultPath` is exactly equal to the search result
    // union's path property.
    assertEqualTypes<ApiSearchResult["path"], ApiSearchResultPath>();
});
