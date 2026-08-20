import {ApiReference} from "~/shared/api/specification/types/api_reference.open_source.js";
import {ApiReferenceResponse} from "~/shared/api/specification/types/api_reference_response.open_source.js";
import {
    ApiBotWebhookCreatedMessageEventParent,
    ApiBotWebhookUpdatedMessageStreamExperimentalApprovalsPartEvent,
    ApiContentFileBlockElementWithoutKeys,
    ApiContentPreviewBlockElementWithoutKeys,
    ApiContentTextInlineElement,
    ApiGetDocumentResponse,
    ApiGetTaskResponse,
    ApiMentionReference,
    ApiMentionReferenceRequest,
    ApiMessageContentPayloadFile,
    ApiMessageContentPayloadParent,
    ApiMessageContentPayloadParentContentSnippetTextInlineElement,
    ApiMessageExperimentalApprovalDecisionOptionRequest,
    ApiMessageExperimentalApprovalDecisionValue,
    ApiMessageExperimentalApprovalDecisionValueRequest,
    ApiMessageRoomReferenceRequest,
    ApiSearchResult,
    ApiSearchResultMatch,
    ApiSearchResultParsedFilter,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.open_source.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";

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
            bodySnippet: string | null;
            matches: ReadonlyArray<ApiSearchResultMatch>;
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

test("all mention references are assignable to `ApiReference`", () => {
    assertAssignableTypes<ApiMentionReferenceRequest, ApiReference>();
    assertAssignableTypes<ApiMentionReference, ApiReferenceResponse>();
});

test("all message room references are assignable to `ApiReference`", () => {
    assertAssignableTypes<ApiMessageRoomReferenceRequest, ApiReference>();
});

test("`/reference` paths are assignable to `ApiReferenceResponse`", () => {
    type Left = ApiSpecification.paths[{
        [Key in keyof ApiSpecification.paths]: Key extends `${string}/reference` ? Key : never;
    }[keyof ApiSpecification.paths]]["get"]["responses"]["200"]["content"]["application/json"]["reference"];

    assertAssignableTypes<Left, ApiReferenceResponse>();
});

test("`ApiMentionReference` is assignable to `ApiMentionReferenceRequest`", () => {
    assertAssignableTypes<ApiMentionReference, ApiMentionReferenceRequest>();
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

test("all base response schemas are assignable to the corresponding `_Request` schema", () => {
    type RequestName = keyof ApiSpecification.components["schemas"] & `${string}_Request`;

    type NameWithRequest = RequestName extends `${infer Name}_Request` ? Name : "ERROR";

    type CommonName = NameWithRequest & keyof ApiSpecification.components["schemas"];

    type Left = {
        [Key in CommonName]: ApiSpecification.components["schemas"][Key];
    };

    type Right = {
        [Key in CommonName]: ApiSpecification.components["schemas"][`${Key}_Request`];
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

    assertAssignableTypes<ApiMessageContentPayloadFile, CreateMessageFiles>();
});

test("`ApiMessageContentPayloadParent` is assignable to `ApiBotWebhookCreatedMessageEventParent`", () => {
    assertAssignableTypes<ApiMessageContentPayloadParent, ApiBotWebhookCreatedMessageEventParent>();
});

test("`ApiContentFileBlockElementWithoutKeys` is assignable to message file elements", () => {
    assertAssignableTypes<
        ApiContentFileBlockElementWithoutKeys,
        ApiMessageContentPayloadFile["element"]
    >();
});

test("`ApiContentPreviewBlockElementWithoutKeys` is assignable to message file elements", () => {
    assertAssignableTypes<
        ApiContentPreviewBlockElementWithoutKeys,
        ApiMessageContentPayloadFile["element"]
    >();
});

test("`ApiMessageExperimentalApprovalDecisionValueRequest` is assignable to `ApiMessageExperimentalApprovalDecisionOptionRequest`", () => {
    assertAssignableTypes<
        ApiMessageExperimentalApprovalDecisionValueRequest,
        ApiMessageExperimentalApprovalDecisionOptionRequest
    >();
});

test("bot webhook approval decisions use response decision values", () => {
    type BotWebhookApprovalDecisionValue = NonNullable<
        ApiBotWebhookUpdatedMessageStreamExperimentalApprovalsPartEvent["approvals"][number]["decision"]["value"]
    >;

    assertEqualTypes<
        BotWebhookApprovalDecisionValue,
        ApiMessageExperimentalApprovalDecisionValue
    >();
});
