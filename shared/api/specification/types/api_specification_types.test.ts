import {
    ApiBotWebhookNewMessageEventParent,
    ApiContentMentionInlineElement,
    ApiContentTextInlineElement,
    ApiCreateDocumentRequestBody,
    ApiCreateTaskCollectionRequestBody,
    ApiCreateTaskRequestBody,
    ApiGetDocumentResponse,
    ApiGetTaskCollectionResponse,
    ApiGetTaskResponse,
    ApiMention,
    ApiMentionResponse,
    ApiMentionTarget,
    ApiMentionTargetResponse,
    ApiMessageContentPayloadFileResponse,
    ApiMessageContentPayloadParentContentSnippetTextInlineElement,
    ApiMessageContentPayloadParentResponse,
    ApiMessageStreamToolCallPartCreateCallTarget,
    ApiSearchResult,
    ApiSearchResultBodyMatch,
    ApiSearchResultParsedFilter,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";
import {ApiTarget} from "~/shared/api/specification/types/api_target.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";

test("all search results are assignable to `ApiTarget`", () => {
    // TODO(@#sites-api): Add Site to ApiTarget once we decide how to share site data
    // across the API. I'm still not exactly sure about what that should look like.
    // Theoretically, if it were to look like the app, fetching a Site's entity should
    // also return the site chrome. And since our hypothesis is generally that you
    // can't understand a site's entity without the site context (e.g. a "Status"
    // channel in a Site named "Add meeting notetaker to Alpine"), it may make sense to
    // load the two together as opposed to making callers fetch them separately? Or
    // maybe we just load the site Id and name, and have the caller fetch the rest of
    // the site if so desired? And what does it look like? Do we load the "access" for
    // the client which can be "Site" or "Local"? Do we expose all of the grants? Lots
    // of open questions...
    assertAssignableTypes<Exclude<ApiSearchResult, {type: "Site"}>, ApiTarget>();
});

test("all search results have the same common properties", () => {
    assertAssignableTypes<
        ApiSearchResult,
        {
            title: string | null;
            bodyMatch: ApiSearchResultBodyMatch | null;
            parsedFilter?: ApiSearchResultParsedFilter;
        }
    >();
});

test("Create tool call target is assignable to ApiMentionTarget", () => {
    assertAssignableTypes<ApiMessageStreamToolCallPartCreateCallTarget, ApiMentionTarget>();
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

test("all mention targets are assignable to `ApiTarget`", () => {
    // TODO(#sites-api)
    assertAssignableTypes<Exclude<ApiMentionTarget, {type: "Site"}>, ApiTarget>();
});

test("`ApiMentionTargetResponse` is assignable to `ApiMentionTarget`", () => {
    assertAssignableTypes<ApiMentionTargetResponse, ApiMentionTarget>();
});

test("ApiGetDocumentResponse is assignable to ApiCreateDocumentRequestBody", () => {
    assertAssignableTypes<ApiGetDocumentResponse, ApiCreateDocumentRequestBody>();
});

test("ApiGetTaskResponse is assignable to ApiCreateTaskRequestBody", () => {
    assertAssignableTypes<ApiGetTaskResponse, ApiCreateTaskRequestBody>();
});

test("ApiGetTaskCollectionResponse is assignable to ApiCreateTaskCollectionRequestBody", () => {
    assertAssignableTypes<ApiGetTaskCollectionResponse, ApiCreateTaskCollectionRequestBody>();
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

test("response file elements are assignable to `CreateMessage` request body files", () => {
    type CreateMessageFiles = NonNullable<
        ApiSpecification.components["requestBodies"]["CreateMessage"]["content"]["application/json"]["files"]
    >[number];

    assertAssignableTypes<ApiMessageContentPayloadFileResponse, CreateMessageFiles>();
});

test("`ApiMessageContentPayloadParentResponse` is assignable to `ApiBotWebhookNewMessageEventParent`", () => {
    assertAssignableTypes<
        ApiMessageContentPayloadParentResponse,
        ApiBotWebhookNewMessageEventParent
    >();
});
