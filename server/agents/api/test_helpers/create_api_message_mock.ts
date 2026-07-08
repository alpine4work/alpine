import {parseApiContentResponseFromMarkdownForTest} from "~/shared/api/content/test_helpers/parse_api_content_response_from_markdown_for_test.js";
import {
    ApiAccount,
    ApiContentResponse,
    ApiMessageContentPayloadParentContentSnippet,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {DateString, serializeDateString} from "~/shared/helpers/date/date_string.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";

export type ApiMessageMockParent = {
    author: ApiAccount;
    index: number;
    endIndex?: number;
    contentSnippet: ApiMessageContentPayloadParentContentSnippet | string;
};

export function createApiMessageMock({
    index,
    author,
    content = `Test message ${index}`,
    createdTime = new Date(Date.UTC(2026, 4, 14, 15, index * 5)),
    createdTimeZone = defaultTimeZone,
    parent,
}: {
    index: number;
    author: ApiAccount | ReadonlyArray<ApiAccount>;
    content?: string | ApiContentResponse;
    createdTime?: DateString | Date;
    createdTimeZone?: TimeZone;
    parent?: ApiMessageMockParent;
}): ApiMessageResponse {
    return {
        index,
        author: isReadonlyArray(author) ? author[index % author.length]! : author,
        createdTime:
            typeof createdTime === "string" ? createdTime : serializeDateString(createdTime),
        createdTimeZone,
        payload: {
            type: "Content",
            content:
                typeof content === "string"
                    ? parseApiContentResponseFromMarkdownForTest(content)
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
            files: [],
        },
    };
}
