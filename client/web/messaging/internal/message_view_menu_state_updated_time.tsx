import {useMemo} from "react";
import {formatMessageViewTimestampDividerDate} from "~/client/web/messaging/format_message_view_timestamp_divider_date.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {sprinkles} from "~/client/web/styles/styles.js";

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// Assign a variable to null so you get a TypeScript error if you try to
// use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

export function MessageViewMenuStateUpdatedTime({
    createdTime,
    contentUpdatedTime,
    deletedTime,
}: {
    createdTime: Date;
    contentUpdatedTime: Date | null;
    deletedTime: Date | null;
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

    const formattedDeletedTime = useMemo(
        () =>
            deletedTime
                ? formatMessageViewTimestampDividerDate(deletedTime, {
                      currentTime,
                      locale,
                      timeZone,
                  })
                : null,
        [currentTime, deletedTime, locale, timeZone],
    );

    return (
        <>
            <div className={sprinkles({padding: "1"})}>
                <div className={sprinkles({width: "full", borderBottom: "grey-5"})} />
            </div>
            <div
                className={sprinkles({
                    paddingX: "2",
                    paddingY: {desktop: "1", mobile: "1.5"},
                    fontSize: "50",
                    color: "grey-50",
                })}
            >
                <div>
                    {(formattedContentUpdatedTime || formattedDeletedTime) && <>Sent: </>}
                    {formattedCreatedTime}
                </div>
                {formattedDeletedTime ? (
                    <div className={sprinkles({paddingTop: "1"})}>
                        Deleted: {formattedDeletedTime}
                    </div>
                ) : formattedContentUpdatedTime ? (
                    <div className={sprinkles({paddingTop: "1"})}>
                        Edited: {formattedContentUpdatedTime}
                    </div>
                ) : null}
            </div>
        </>
    );
}
