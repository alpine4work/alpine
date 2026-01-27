import {
    ApiBotWebhookNewMessageEventParent,
    ApiContentTextInlineElement,
    ApiMentionTarget,
    ApiMentionTargetResponse,
    ApiMessageContentPayloadParentContentSnippetTextInlineElement,
    ApiMessageContentPayloadParentResponse,
    ApiSearchResult,
    ApiSearchResultBodyMatch,
    ApiSearchResultParsedFilter,
    ApiSearchResultPath,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/types/api_specification_types.js";
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

test("`MessageContentPayloadParentContentSnippetTextInlineElement` is assignable to `ContentTextInlineElement`", () => {
    assertAssignableTypes<
        ApiMessageContentPayloadParentContentSnippetTextInlineElement,
        ApiContentTextInlineElement
    >();
});

test("all `_Response` schemas are assignable to the corresponding base schema", () => {
    type ResponseName = keyof ApiSpecification.components["schemas"] & `${string}_Response`;

    type NameWithResponse = ResponseName extends `${infer Name}_Response` ? Name : "ERROR";

    type Left = {
        [Key in NameWithResponse]: ApiSpecification.components["schemas"][`${Key}_Response`];
    };

    type Right = {
        [Key in NameWithResponse &
            keyof ApiSpecification.components["schemas"]]: ApiSpecification.components["schemas"][Key];
    };

    // This gives a much nicer error message than `assertAssignableTypes()` if the
    // types aren't assignable. In that `assertAssignableTypes()` gives basically
    // no error message. Since we're comparing some pretty big types it's useful to
    // have a nice error message from TypeScript.
    //
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function assertAssignableReturnType(left: Left): Right {
        return left;
    }
});

test("`ApiMessageContentPayloadParentResponse` is assignable to `ApiBotWebhookNewMessageEventParent`", () => {
    assertAssignableTypes<
        ApiMessageContentPayloadParentResponse,
        ApiBotWebhookNewMessageEventParent
    >();
});
