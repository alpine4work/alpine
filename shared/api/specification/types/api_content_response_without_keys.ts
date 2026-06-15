import {
    ApiContentBlockElementResponse,
    ApiContentCheckListBlockElementItemResponse,
    ApiContentListBlockElementItemResponse,
    ApiContentListBlockElementResponse,
    ApiContentParagraphBlockElementResponse,
    ApiContentResponse,
    ApiContentTableBlockElementCellResponse,
    ApiContentTableBlockElementRowResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {JsonScalarValue} from "~/shared/helpers/types/json_value.js";

// `ApiContentResponse` includes resolved response-only fields such as mention
// titles, task display status, file metadata, and content keys on addressable text
// containers. API callers use those keys to create document comment target ranges
// with `{key, index}`.
//
// Those keys are not just opaque ids. They encode the source entity/version and
// the ProseMirror position of the block or code line. They are only meaningful
// when we are returning content for a known API entity at a known version, such as
// `GET /documents/{id}`, `PATCH /documents/{id}`, `GET /tasks/{id}`, or a document
// comment snippet. Those callers pass an `encoder` and use the generated
// `ApiContentResponse`.
//
// API content is also a general conversion/printing intermediate for flows that
// never send positions back to the API. Current no-key flows include:
//
// - `client/web/documents/internal/export_document_content.ts`, which converts a
//   local document to API content only so it can print Markdown/HTML export.
// - Notion import conversion code, which uses API content as an intermediate
//   representation while converting imported Markdown/CSV data into ProseMirror
//   documents.
// - `server/agents/internal/print_api_content_to_agent_markdown.ts` and its
//   frontmatter wrapper, which need response-shaped mentions to produce agent
//   links but never read content keys.
// - Agent Markdown and shared converter tests, which build literal response
//   content fixtures with no backing API entity/version.
//
// For those flows, requiring keys would force them to invent fake entity/version
// provenance. That would make the type checker happy while implying the content
// can be used for stable position mapping, which it cannot.
//
// This helper is the type-level mirror of the no-entity-context overload: keep the
// response shape and recursively remove content keys. If a caller needs comment
// ranges or any other stable position mapping, it should pass an `encoder` instead
// of using this keyless shape. The conditional type preserves primitives, walks
// arrays and objects, and strips `key` wherever the generated response type
// declares one.
type ApiContentWithoutKeys<Value> = Value extends JsonScalarValue | undefined
    ? Value
    : Value extends ReadonlyArray<infer Item>
      ? ReadonlyArray<ApiContentWithoutKeys<Item>>
      : Value extends {readonly key?: string}
        ? Omit<{readonly [Key in keyof Value]: ApiContentWithoutKeys<Value[Key]>}, "key">
        : Value extends object
          ? {readonly [Key in keyof Value]: ApiContentWithoutKeys<Value[Key]>}
          : Value;

export type ApiContentResponseWithoutKeys = ApiContentWithoutKeys<ApiContentResponse>;

export type ApiContentBlockElementResponseWithoutKeys =
    ApiContentWithoutKeys<ApiContentBlockElementResponse>;

export type ApiContentParagraphBlockElementResponseWithoutKeys =
    ApiContentWithoutKeys<ApiContentParagraphBlockElementResponse>;

type ApiContentWithOptionalKeys<Value> = Value extends JsonScalarValue | undefined
    ? Value
    : Value extends ReadonlyArray<infer Item>
      ? ReadonlyArray<ApiContentWithOptionalKeys<Item>>
      : Value extends {readonly key: infer Key}
        ? Omit<{readonly [K in keyof Value]: ApiContentWithOptionalKeys<Value[K]>}, "key"> & {
              readonly key?: Key;
          }
        : Value extends object
          ? {readonly [K in keyof Value]: ApiContentWithOptionalKeys<Value[K]>}
          : Value;

export type ApiContentResponseWithOptionalKeys = ApiContentWithOptionalKeys<ApiContentResponse>;

export type ApiContentBlockElementResponseWithOptionalKeys =
    ApiContentWithOptionalKeys<ApiContentBlockElementResponse>;

export type ApiContentParagraphBlockElementResponseWithOptionalKeys =
    ApiContentWithOptionalKeys<ApiContentParagraphBlockElementResponse>;

export type ApiContentListBlockElementResponseWithOptionalKeys =
    ApiContentWithOptionalKeys<ApiContentListBlockElementResponse>;

export type ApiContentListBlockElementItemResponseWithOptionalKeys =
    ApiContentWithOptionalKeys<ApiContentListBlockElementItemResponse>;

export type ApiContentCheckListBlockElementItemResponseWithOptionalKeys =
    ApiContentWithOptionalKeys<ApiContentCheckListBlockElementItemResponse>;

export type ApiContentTableBlockElementCellResponseWithOptionalKeys =
    ApiContentWithOptionalKeys<ApiContentTableBlockElementCellResponse>;

export type ApiContentTableBlockElementRowResponseWithOptionalKeys =
    ApiContentWithOptionalKeys<ApiContentTableBlockElementRowResponse>;
