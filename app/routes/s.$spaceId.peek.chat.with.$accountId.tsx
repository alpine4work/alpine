import ChatRoute from "~/app/routes/s.$spaceId.chat.with.$accountId.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";

export {meta, loader} from "~/app/routes/s.$spaceId.chat.with.$accountId.js";

export default function ChatPeekRoute() {
    return <ChatRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
