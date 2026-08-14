import {redirect} from "@remix-run/server-runtime";
import {
    deserializeDocumentCommentThreadIdForLoader,
    deserializeDocumentIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";

export async function loader({request, params}: LoaderArgs) {
    const url = new URL(request.url);

    const documentId = deserializeDocumentIdForLoader(params.documentId);
    const threadSearchParam = url.searchParams.get("thread");

    if (!threadSearchParam) {
        throw new InvalidArgumentError("No `thread` search param provided");
    }

    const commentThreadId = deserializeDocumentCommentThreadIdForLoader(
        documentId,
        threadSearchParam,
    );

    return redirect(`/debug/claude/doc/${documentId}/thread/${commentThreadId}`);
}
