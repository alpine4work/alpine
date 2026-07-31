import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentBlockElementResponse,
    ApiContentCheckListBlockElementItemResponse,
    ApiContentFileBlockElementResponse,
    ApiContentListBlockElementItemResponse,
    ApiContentListBlockElementResponse,
    ApiContentParagraphBlockElementResponse,
    ApiContentPreviewBlockElementResponse,
    ApiContentResponse,
    ApiContentTableBlockElementCellResponse,
    ApiContentTableBlockElementRowResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {JsonScalarValue} from "~/shared/helpers/types/json_value.js";

type MakeApiContentWithOptionalKeys<Value> = Value extends JsonScalarValue | undefined
    ? Value
    : Value extends ReadonlyArray<infer Item>
      ? ReadonlyArray<MakeApiContentWithOptionalKeys<Item>>
      : Value extends {readonly key: infer Key}
        ? Omit<{readonly [K in keyof Value]: MakeApiContentWithOptionalKeys<Value[K]>}, "key"> & {
              readonly key?: Key;
          }
        : Value extends object
          ? {readonly [K in keyof Value]: MakeApiContentWithOptionalKeys<Value[K]>}
          : Value;

export type ApiContentWithOptionalKeys = MakeApiContentWithOptionalKeys<ApiContent>;

export type ApiContentBlockElementWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentBlockElement>;

export type ApiContentResponseWithOptionalKeys = MakeApiContentWithOptionalKeys<ApiContentResponse>;

export type ApiContentBlockElementResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentBlockElementResponse>;

export type ApiContentParagraphBlockElementResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentParagraphBlockElementResponse>;

export type ApiContentListBlockElementResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentListBlockElementResponse>;

export type ApiContentListBlockElementItemResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentListBlockElementItemResponse>;

export type ApiContentCheckListBlockElementItemResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentCheckListBlockElementItemResponse>;

export type ApiContentTableBlockElementCellResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentTableBlockElementCellResponse>;

export type ApiContentTableBlockElementRowResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentTableBlockElementRowResponse>;

export type ApiContentFileBlockElementResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentFileBlockElementResponse>;

export type ApiContentPreviewBlockElementResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentPreviewBlockElementResponse>;
