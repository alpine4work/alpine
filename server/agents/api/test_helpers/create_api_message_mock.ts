import {
    ApiAccount,
    ApiContentResponse,
    ApiMessageContentPayloadParentContentSnippet,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {assertDateString} from "~/shared/helpers/date/date_string.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";

export function createApiMessageMock({
    index,
    author,
    content = `Test message ${index}`,
    createdTime = new Date(Date.UTC(2026, 4, 14, 15, index * 5)).toISOString(),
    createdTimeZone = defaultTimeZone,
    parent,
}: {
    index: number;
    author: ApiAccount | ReadonlyArray<ApiAccount>;
    content?: ApiContentResponse | string;
    createdTime?: string;
    createdTimeZone?: TimeZone;
    parent?: {
        author: ApiAccount;
        index: number;
        endIndex?: number;
        contentSnippet: ApiMessageContentPayloadParentContentSnippet | string;
    };
}): ApiMessageResponse {
    return {
        index,
        author: isReadonlyArray(author) ? author[index % author.length]! : author,
        createdTime: assertDateString(createdTime),
        createdTimeZone,
        payload: {
            type: "Content",
            content:
                typeof content === "string"
                    ? {elements: [{type: "Paragraph", elements: [{type: "Text", text: content}]}]}
                    : content,
            parent: parent
                ? {
                      type: "Message" as const,
                      index: parent.index,
                      ...(parent.endIndex !== undefined ? {endIndex: parent.endIndex} : {}),
                      author: parent.author,
                      contentSnippet:
                          typeof parent.contentSnippet === "string"
                              ? {
                                    elements: [{type: "Text", text: parent.contentSnippet}],
                                    isTruncated: false,
                                }
                              : parent.contentSnippet,
                  }
                : undefined,
        },
    };
}
