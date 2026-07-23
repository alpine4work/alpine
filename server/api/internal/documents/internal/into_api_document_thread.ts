import {
    ApiAccountResponse,
    ApiDocumentThreadResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";

export function intoApiDocumentThread({
    id,
    isResolved,
    commentCount,
    firstCommentAuthor,
    createdTime,
    createdTimeZone,
}: {
    id: DocumentCommentThreadId;
    isResolved: boolean;
    commentCount: number;
    firstCommentAuthor: ApiAccountResponse;
    createdTime: Date;
    createdTimeZone: TimeZone;
}): ApiDocumentThreadResponse {
    return {
        id,
        isResolved,
        totalMessageCount: commentCount,
        firstMessage: {
            author: firstCommentAuthor,
            createdTime: serializeDateString(createdTime),
            createdTimeZone,
        },
    };
}
