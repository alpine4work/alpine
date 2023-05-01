import ChatRoute from "~/app/routes/s/$space_id/chat/$chat_id";
import {usePeekContext} from "~/client/peek/peek_remix_embed";

export {meta, loader} from "~/app/routes/s/$space_id/chat/$chat_id";

export default function ChatPeekRoute() {
    return <ChatRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
