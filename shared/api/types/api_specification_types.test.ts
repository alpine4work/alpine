import {
    ApiContent,
    ApiContentMentionInlineElement,
    ApiContentMentionInlineElementResponse,
    ApiContentResponse,
    ApiMentionTarget,
    ApiMentionTargetResponse,
    ApiMessageStreamToolCallPartPayloadCall,
    ApiMessageStreamToolCallPartPayloadCallResponse,
    ApiSearchResult,
    ApiSearchResultBodyMatch,
    ApiSearchResultParsedFilter,
    ApiSearchResultPath,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {ApiTarget, ApiTargetResponse} from "~/shared/api/types/api_target.js";
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
            readonly parsedFilter?: ApiSearchResultParsedFilter | null;
        }
    >();

    // Make sure `ApiSearchResultPath` is exactly equal to the search result
    // union's path property.
    assertEqualTypes<ApiSearchResult["path"], ApiSearchResultPath>();
});

test("all search results are assignable to `ApiTargetResponse`", () => {
    assertAssignableTypes<ApiSearchResult, ApiTargetResponse>();
});

test("all mention targets are assignable to `ApiTargetResponse`", () => {
    assertAssignableTypes<ApiMentionTargetResponse, ApiTargetResponse>();
});

test("all input mention targets are assignable to `ApiTarget`", () => {
    assertAssignableTypes<ApiMentionTarget, ApiTarget>();
});

test("`ApiMentionTargetResponse` is assignable to `ApiContentMentionInlineElement`", () => {
    assertAssignableTypes<ApiMentionTargetResponse, ApiMentionTarget>();
});

test("`ApiContentMentionInlineElementResponse` is assignable to `ApiContentMentionInlineElement`", () => {
    assertAssignableTypes<ApiContentMentionInlineElementResponse, ApiContentMentionInlineElement>();
});

test("`ApiContentResponse` is assignable to `ApiContent`", () => {
    assertAssignableTypes<ApiContentResponse, ApiContent>();
});

test("`ApiMessageStreamToolCallPartPayloadCallResponse` is assignable to `ApiMessageStreamToolCallPartPayloadCall`", () => {
    assertAssignableTypes<
        ApiMessageStreamToolCallPartPayloadCallResponse,
        ApiMessageStreamToolCallPartPayloadCall
    >();
});
