import NewChatRoute from "~/app/routes/s.$spaceId.chat.new.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";

export {meta, loader, shouldRevalidate} from "~/app/routes/s.$spaceId.chat.new.js";

export default function NewChatPeekRoute() {
    return <NewChatRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
