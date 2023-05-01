import NewChatRoute from "~/app/routes/s/$space_id/chat/new";
import {usePeekContext} from "~/client/peek/peek_remix_embed";

export {meta, loader} from "~/app/routes/s/$space_id/chat/new";

export default function NewChatPeekRoute() {
    return <NewChatRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
