import {
    ApiBotWebhookNewMessageEventParent,
    ApiContentMentionInlineElement,
    ApiContentTextInlineElement,
    ApiCreateDocumentRequestBody,
    ApiGetDocumentResponse,
    ApiMentionReference,
    ApiMentionReferenceResponse,
    ApiMessageContentPayloadParentContentSnippetTextInlineElement,
    ApiMessageContentPayloadParentResponse,
    ApiMessageStreamToolCallPartCreateCallReference,
    ApiSearchResult,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";
import {ApiReference} from "~/shared/api/specification/types/api_reference.js";
import {ApiReferenceResponse} from "~/shared/api/specification/types/api_reference_response.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";

test("all `ApiReferenceResponse` are assignable to `ApiReference`", () => {
    assertAssignableTypes<ApiReferenceResponse, ApiReference>();
});

test("all search results are assignable to `ApiReferenceResponse`", () => {
    assertAssignableTypes<ApiSearchResult, ApiReferenceResponse>();
});

test("all mention targets are assignable to `ApiReferenceResponse`", () => {
    assertAssignableTypes<ApiMentionReferenceResponse, ApiReferenceResponse>();
});

test("create tool call target is assignable to ApiMentionReference", () => {
    assertAssignableTypes<ApiMessageStreamToolCallPartCreateCallReference, ApiMentionReference>();
});

test("`ApiContentMentionInlineElement` is assignable to `ApiMention`", () => {
    assertAssignableTypes<ApiContentMentionInlineElement, ApiMention>();
});

test("`/mention` paths are assignable to `ApiMentionResponse`", () => {
    type Left = ApiSpecification.paths[{
        [Key in keyof ApiSpecification.paths]: Key extends `${string}/mention` ? Key : never;
    }[keyof ApiSpecification.paths]]["get"]["responses"]["200"]["content"]["application/json"]["mention"];

    assertAssignableTypes<Left, ApiMentionResponse>();
});

test("all mention targets are assignable to `ApiReference`", () => {
    assertAssignableTypes<ApiMentionReference, ApiReference>();
});

test("`ApiMentionReferenceResponse` is assignable to `ApiMentionReference`", () => {
    assertAssignableTypes<ApiMentionReferenceResponse, ApiMentionReference>();
});

test("ApiGetDocumentResponse is assignable to ApiCreateDocumentRequestBody", () => {
    assertAssignableTypes<ApiGetDocumentResponse, ApiCreateDocumentRequestBody>();
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
