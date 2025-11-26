import {Memo, useMemo, useState} from "react";
import {MessageStreamViewItemList} from "~/client/web/messaging/internal/message_stream_view_item_list.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {isContentBodyEmpty} from "~/shared/content/is_content_empty.js";
import {MessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
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
