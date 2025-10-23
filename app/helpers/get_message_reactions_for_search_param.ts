import {InvalidArgumentError} from "~/shared/error/error.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {findMessageReactionPosIfPossible} from "~/shared/messaging/compute_set_message_reaction.js";
import {MessagePayload, MessageStream} from "~/shared/messaging/message_schema.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";

export function getMessageReactionsForSearchParam(
    url: URL,
    message: {
        payload: MessagePayload;
        stream: MessageStream | null;
    },
) {
    const searchParam = url.searchParams.get("at");
    if (!searchParam) throw new InvalidArgumentError("Missing `at` search param");

    const [posString = "", contentVersionString = ""] = searchParam.split("@", 2);

    if (!/^(0|[1-9][0-9]*)$/.test(posString)) {
        throw new InvalidArgumentError("Invalid pos in `at` search param");
    }

    if (!/^(0|[1-9][0-9]*)$/.test(contentVersionString)) {
        throw new InvalidArgumentError("Invalid content version in `at` search param");
    }

    const pos = parseInt(posString, 10);
    const contentVersion = parseInt(contentVersionString, 10);

    const {payload, pos: actualPos} = unwrapResult(
        findMessageReactionPosIfPossible({message, contentVersion, pos}),
    );

    return payload.reactionsByPos.get(actualPos) ?? emptyReactionSet;
}
