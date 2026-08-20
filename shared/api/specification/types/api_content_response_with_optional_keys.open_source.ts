import {
    ApiContent,
    ApiContentBlockElement,
    ApiContentBlockElementRequest,
    ApiContentCheckListBlockElementItem,
    ApiContentFileBlockElement,
    ApiContentListBlockElement,
    ApiContentListBlockElementItem,
    ApiContentParagraphBlockElement,
    ApiContentPreviewBlockElement,
    ApiContentRequest,
    ApiContentTableBlockElementCell,
    ApiContentTableBlockElementRow,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {JsonScalarValue} from "~/shared/helpers/types/json_value.open_source.js";

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

export type ApiContentWithOptionalKeys = MakeApiContentWithOptionalKeys<ApiContentRequest>;

export type ApiContentBlockElementWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentBlockElementRequest>;

export type ApiContentResponseWithOptionalKeys = MakeApiContentWithOptionalKeys<ApiContent>;

export type ApiContentBlockElementResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentBlockElement>;

export type ApiContentParagraphBlockElementResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentParagraphBlockElement>;

export type ApiContentListBlockElementResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentListBlockElement>;

export type ApiContentListBlockElementItemResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentListBlockElementItem>;

export type ApiContentCheckListBlockElementItemResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentCheckListBlockElementItem>;

export type ApiContentTableBlockElementCellResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentTableBlockElementCell>;

export type ApiContentTableBlockElementRowResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentTableBlockElementRow>;

export type ApiContentFileBlockElementResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentFileBlockElement>;

export type ApiContentPreviewBlockElementResponseWithOptionalKeys =
    MakeApiContentWithOptionalKeys<ApiContentPreviewBlockElement>;
