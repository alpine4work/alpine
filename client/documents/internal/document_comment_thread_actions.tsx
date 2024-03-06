import {useMemo} from "react";
import {Box} from "~/client/design/box.js";
import {DocumentCommentThreadResolveButton} from "~/client/documents/internal/document_comment_thread_resolve_button.js";
import {formatMessageViewTimestampDividerDate} from "~/client/messaging/message_view.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {DocumentCommentThreadModel} from "~/shared/documents/document_model.js";

export const documentCommentThreadActionsHeight = "7";

export function DocumentCommentThreadActions({
    commentThread,
}: {
    commentThread: DocumentCommentThreadModel;
}) {
    const {locale, timeZone} = useClientInfo();
    const currentTime = useCurrentTimeRoundedToHour();

    const formattedDate = useMemo(
        () =>
            formatMessageViewTimestampDividerDate(commentThread.createdTime, {
                currentTime,
                locale,
                timeZone,
            }),
        [commentThread.createdTime, currentTime, locale, timeZone],
    );

    return (
        <Box
            height={documentCommentThreadActionsHeight}
            display="flex"
            justifyContent="space-between"
            alignItems="center"
        >
            <DocumentCommentThreadResolveButton />
            <Box fontSize="50" fontStyle="truncate" color="grey-50">
                {formattedDate}
            </Box>
        </Box>
    );
}
