import {redirect} from "@remix-run/server-runtime";
import {
    deserializeSpaceIdForLoader,
    deserializeTaskIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";

export async function loader({params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const taskId = deserializeTaskIdForLoader(params.taskId);

    return redirect(`/debug/chat-gpt/s/${spaceId}/tasks/${taskId}`);
}
