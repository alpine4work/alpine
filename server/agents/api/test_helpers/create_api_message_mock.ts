import {parseApiContentResponseFromMarkdownForTest} from "~/shared/api/content/test_helpers/parse_api_content_response_from_markdown_for_test.js";
import {
    ApiAccount,
    ApiContent,
    ApiMessage,
    ApiMessageContentPayloadFile,
    ApiMessageContentPayloadParentContentSnippet,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.open_source.js";
import {
    assertDateString,
    serializeDateString,
} from "~/shared/helpers/date/date_string.open_source.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";

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
    files = [],
}: {
    index: number;
    author: ApiAccount | ReadonlyArray<ApiAccount>;
    content?: string | ApiContent;
    createdTime?: string | Date;
    createdTimeZone?: TimeZone;
    parent?: ApiMessageMockParent;
    files?: ReadonlyArray<ApiMessageContentPayloadFile>;
}): ApiMessage {
    return {
        index,
        author: isReadonlyArray(author) ? author[index % author.length]! : author,
        createdTime:
            typeof createdTime === "string"
                ? assertDateString(createdTime)
                : serializeDateString(createdTime),
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
            files,
        },
    };
}
