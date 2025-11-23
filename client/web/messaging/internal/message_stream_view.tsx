import {differenceInMilliseconds} from "date-fns/differenceInMilliseconds";
import {Memo, useEffect, useMemo, useState} from "react";
import {ContentView} from "~/client/web/content/content_view.js";
import {
    hasMessageStreamTimedOutOnClient,
    messageStreamTimeoutClientLimitMs,
} from "~/client/web/messaging/internal/has_message_stream_timed_out_on_client.js";
import {MessageStreamViewItemList} from "~/client/web/messaging/internal/message_stream_view_item_list.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {getSynchronizedSystemClock} from "~/client/web/tracer/synchronized_system_clock.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {isContentBodyEmpty} from "~/shared/content/is_content_empty.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {
    MessageContentProsemirrorSchema,
    MessageContentWithReferences,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {MessageStream} from "~/shared/messaging/message_schema.js";

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

// TODO(calebmer, #ai-realtime-hacks): I haven't implemented backfilling
// for message streams. That means a user could load the page when there's an
// active stream and they'll load the current stream parts from the server but
// miss some realtime events that happen between the Remix `loader()` call and
// when we connect to a messaging realtime WebSocket. Or they'll miss realtime
// events if they go temporarily offline.
//
// My proposal for backfill is to initiate backfill in this component. (So we
// only backfill message streams that are rendered.) And pass the list of parts
// plus the parts versions, compare that to what's on the server, and return
// any new parts.
//
// I haven't implemented backfilling since I'm moving fast today to get this
// shipped.
export function MessageStreamView({
    message,
    content,
    stream,
    withUserSelectNone,
    getClipboardSerializerPrefix,
    jumpAnimation,
}: {
    message: MessageModel<string> | OptimisticMessageModel;
    content: MessageContentWithReferences;
    stream: MessageStream;
    withUserSelectNone: boolean;
    getClipboardSerializerPrefix: Memo<() => string | null>;
    jumpAnimation: Memo<{from: number | null; to: number | null; startTime: Date}> | null;
}) {
    const spacingScale = useSpacingScale();

    const isContentEmpty = useMemo(() => isContentBodyEmpty(content.doc), [content.doc]);
    const [wasIncompleteWhenMounted] = useState(() => stream.completedTime === null);

    // When we render the component, if the current date is past the timeout threshold,
    // set `hasResponseTimedOut` to true.
    const [hasResponseTimedOut, setHasResponseTimedOut] = useState(() => {
        return stream.completedTime === null && hasMessageStreamTimedOutOnClient(stream);
    });

    useEffect(() => {
        // If the stream is completed or we've already timed out, return early.
        if (stream.completedTime !== null || hasResponseTimedOut) return;

        const lastUpdatedTime = stream.lastPingTime ?? stream.createdTime;

        // See comment [1] for guidance on using sycnhronized system clock on client.
        //
        // [1]: https://app.graphite.com/github/pr/cyberworlds/cyberworlds/784/ping-API-to-keep-durable-object-alive#comment-PRRC_kwDOH2ktg86XX_c_
        const clock =
            getSynchronizedSystemClock().getStateWithoutListening().value ??
            unsynchronizedSystemClock;
        const timeoutTime = lastUpdatedTime.getTime() + messageStreamTimeoutClientLimitMs;

        // We want to run the timeout logic 15 seconds after the last time the stream
        // was updated. So we calculate the absolute time of the last update plus 15 seconds,
        // and then we figure out how many milliseconds away we are from that time.
        // So if current time is timestep 45 and last updated time is 35, the timeout
        // will run in about 5 seconds (at timestep 50, which is 15 seconds after the last update).
        const timeoutMs = differenceInMilliseconds(timeoutTime, clock.now());
        const {clear} = createTimeout(() => setHasResponseTimedOut(true), timeoutMs);

        return () => clear();
    }, [stream.completedTime, stream.lastPingTime, stream.createdTime, hasResponseTimedOut]);

    if (hasResponseTimedOut) {
        return (
            <ContentView
                content={{
                    doc: createErrorMessageContent.get(),
                    references: emptyContentReferences,
                }}
            />
        );
    }

    return (
        <div
            style={{
                minHeight: wasIncompleteWhenMounted
                    ? contentStyles.paragraphLineHeightPx[spacingScale] * 8
                    : contentStyles.paragraphLineHeightPx[spacingScale],
            }}
        >
            <MessageStreamViewItemList
                message={message}
                isContentEmpty={isContentEmpty}
                content={content}
                stream={stream}
                withUserSelectNone={withUserSelectNone}
                getClipboardSerializerPrefix={getClipboardSerializerPrefix}
                jumpAnimation={jumpAnimation}
            />
        </div>
    );
}

const createErrorMessageContent = new Lazy(() => {
    return assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text(
                    "I couldn’t generate a response. An unexpected error occurred, please try again. If the problem continues, let Alpine know at ",
                ),
                MessageContentProsemirrorSchema.text("support@alpine.inc", [
                    MessageContentProsemirrorSchema.mark("link", {
                        url: "mailto:support@alpine.inc",
                    }),
                ]),
                MessageContentProsemirrorSchema.text("."),
            ]),
        ]),
    );
});
