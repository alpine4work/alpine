import {redirect} from "@remix-run/server-runtime";
import {
    deserializeDocumentCommentThreadIdForLoader,
    deserializeDocumentIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";

export async function loader({request, params}: LoaderArgs) {
    const url = new URL(request.url);

    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const documentId = deserializeDocumentIdForLoader(params.documentId);
    const commentsSearchParam = url.searchParams.get("comments");

    if (!commentsSearchParam) {
        throw new InvalidArgumentError("No `comments` search param provided");
    }

    const commentThreadId = deserializeDocumentCommentThreadIdForLoader(
        documentId,
        commentsSearchParam,
    );

    return redirect(
        `/debug/chat-gpt/s/${spaceId}/documents/${documentId}/comments/${commentThreadId}`,
    );
}
