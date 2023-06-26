import ChatRoute from "~/app/routes/s/$space_id/chat/$chat_id.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";

export {meta, loader} from "~/app/routes/s/$space_id/chat/$chat_id.js";

export default function ChatPeekRoute() {
    return <ChatRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
