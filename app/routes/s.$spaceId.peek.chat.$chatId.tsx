import ChatRoute from "~/app/routes/s.$spaceId.chat.$chatId.js";
import {usePeekContext} from "~/client/peek/peek_context.js";

export {meta, loader} from "~/app/routes/s.$spaceId.chat.$chatId.js";

export default function ChatPeekRoute() {
    return <ChatRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
