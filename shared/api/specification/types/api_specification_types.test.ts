import {ApiReference} from "~/shared/api/specification/types/api_reference.js";
import {ApiReferenceResponse} from "~/shared/api/specification/types/api_reference_response.js";
import {
    ApiBotWebhookCreatedMessageEventParent,
    ApiContentFileBlockElementResponseWithoutKeys,
    ApiContentPreviewBlockElementResponseWithoutKeys,
    ApiContentTextInlineElement,
    ApiGetDocumentResponse,
    ApiGetTaskResponse,
    ApiMentionReference,
    ApiMentionReferenceResponse,
    ApiMessageContentPayloadFileResponse,
    ApiMessageContentPayloadParentContentSnippetTextInlineElement,
    ApiMessageContentPayloadParentResponse,
    ApiMessageExperimentalApprovalDecisionOption,
    ApiMessageExperimentalApprovalDecisionValue,
    ApiMessageStreamToolCallPartCreateCallReference,
    ApiSearchResult,
    ApiSearchResultBodyMatch,
    ApiSearchResultParsedFilter,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";

type ApiCreateDocumentRequestBody =
    ApiSpecification.paths["/documents"]["post"]["requestBody"]["content"]["application/json"];
type ApiCreateTaskRequestBody =
    ApiSpecification.paths["/tasks"]["post"]["requestBody"]["content"]["application/json"];
type ApiGetTaskCollectionResponse =
    ApiSpecification.paths["/task-collections/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type ApiCreateTaskCollectionRequestBody =
    ApiSpecification.paths["/task-collections"]["post"]["requestBody"]["content"]["application/json"];

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

test("all `ApiReferenceResponse` are assignable to `ApiReference`", () => {
    assertAssignableTypes<ApiReferenceResponse, ApiReference>();
});

test("all search results are assignable to `ApiReference`", () => {
    // TODO(@#sites-api): Add Site to ApiReference once we decide how to share site
    // data across the API. I'm still not exactly sure about what that should look
    // like. Theoretically, if it were to look like the app, fetching a Site's entity
    // should also return the site chrome. And since our hypothesis is generally that
    // you can't understand a site's entity without the site context (e.g. a "Status"
    // channel in a Site named "Add meeting notetaker to Alpine"), it may make sense to
    // load the two together as opposed to making callers fetch them separately? Or
    // maybe we just load the site Id and name, and have the caller fetch the rest of
    // the site if so desired? And what does it look like? Do we load the "access" for
    // the client which can be "Site" or "Local"? Do we expose all of the grants? Lots
    // of open questions...
    assertAssignableTypes<Exclude<ApiSearchResult, {type: "Site"}>, ApiReference>();
});

test("create tool call target is assignable to ApiMentionReference", () => {
    assertAssignableTypes<ApiMessageStreamToolCallPartCreateCallReference, ApiMentionReference>();
});

test("`/reference` paths are assignable to `ApiReferenceResponse`", () => {
    type Left = ApiSpecification.paths[{
        [Key in keyof ApiSpecification.paths]: Key extends `${string}/reference` ? Key : never;
    }[keyof ApiSpecification.paths]]["get"]["responses"]["200"]["content"]["application/json"]["reference"];

    assertAssignableTypes<Left, ApiReferenceResponse>();
});

test("`ApiMentionReferenceResponse` is assignable to `ApiMentionReference`", () => {
    assertAssignableTypes<ApiMentionReferenceResponse, ApiMentionReference>();
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

test("`ApiMessageContentPayloadParentResponse` is assignable to `ApiBotWebhookCreatedMessageEventParent`", () => {
    assertAssignableTypes<
        ApiMessageContentPayloadParentResponse,
        ApiBotWebhookCreatedMessageEventParent
    >();
});

test("`ApiContentFileBlockElementResponseWithoutKeys` is assignable to message file elements", () => {
    assertAssignableTypes<
        ApiContentFileBlockElementResponseWithoutKeys,
        ApiMessageContentPayloadFileResponse["element"]
    >();
});

test("`ApiContentPreviewBlockElementResponseWithoutKeys` is assignable to message file elements", () => {
    assertAssignableTypes<
        ApiContentPreviewBlockElementResponseWithoutKeys,
        ApiMessageContentPayloadFileResponse["element"]
    >();
});

test("`ApiMessageExperimentalApprovalDecisionValue` is assignable to `ApiMessageExperimentalApprovalDecisionOption`", () => {
    assertAssignableTypes<
        ApiMessageExperimentalApprovalDecisionValue,
        ApiMessageExperimentalApprovalDecisionOption
    >();
});
