import TaskCommentsRoute, {
    loader as originalLoader,
} from "~/app/routes/s.$spaceId.tasks.$taskId.comments.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";

export {meta} from "~/app/routes/s.$spaceId.tasks.$taskId.comments.js";

export function loader(args: LoaderArgs) {
    return originalLoader({...args, isPeek: true});
}

export default function TaskCommentsPeekRoute() {
    return <TaskCommentsRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
