import {useMemo} from "react";
import {Box} from "~/client/web/design/box.js";
import {formatMessageViewTimestampDividerDate} from "~/client/web/messaging/format_message_view_timestamp_divider_date.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/web/remix/use_current_time_rounded_to_hour.js";

export function MessageViewMenuCreatedTime({
    createdTime,
    contentUpdatedTime,
}: {
    createdTime: Date;
    contentUpdatedTime: Date | null;
}) {
    const {timeZone, locale} = useClientInfo();
    const currentTime = useCurrentTimeRoundedToHour();

    const formattedCreatedTime = useMemo(
        () =>
            formatMessageViewTimestampDividerDate(createdTime, {
                currentTime,
                locale,
                timeZone,
            }),
        [createdTime, currentTime, locale, timeZone],
    );

    const formattedContentUpdatedTime = useMemo(
        () =>
            contentUpdatedTime
                ? formatMessageViewTimestampDividerDate(contentUpdatedTime, {
                      currentTime,
                      locale,
                      timeZone,
                  })
                : null,
        [contentUpdatedTime, currentTime, locale, timeZone],
    );

    return (
        <>
            <Box paddingX="1" paddingY="1">
                <Box width="full" borderBottom="grey-5" />
            </Box>
            <Box
                paddingX="2"
                paddingY={{desktop: "1", mobile: "1.5"}}
                fontSize="50"
                color="grey-50"
            >
                <Box>
                    {formattedContentUpdatedTime && <>Sent: </>}
                    {formattedCreatedTime}
                </Box>
                {formattedContentUpdatedTime && (
                    <Box paddingTop="1">Edited: {formattedContentUpdatedTime}</Box>
                )}
            </Box>
        </>
    );
}
