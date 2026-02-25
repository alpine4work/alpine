import {ServerMinimalBotActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {AccessPolicyWithoutGenerations} from "~/shared/access/access_policy.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";

export async function getBotAccessPolicy(
    context: ServerMinimalBotActionContext,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccessPolicyWithoutGenerations> {
    // The scope of access the bot has. For example, if you mention a bot from a
    // forum post then the bot's scope will be `Post` with the corresponding
    // `PostId`. If you mention a bot from a chat then the scope will be `Chat`
    // with the corresponding `ChatId`.
    //
    // A scope of `Space` means the bot only has access to content shared with
    // everyone in the space. A scope of `Account` means the bot only has access to
    // stuff that account has access to.
    //
    // All other entity scopes (e.g. `Chat`, `Document`, `Post`, etc.) means the
    // bot only has access to stuff that EVERYONE who has access to the entity has
    // access to. So if a `Chat` has Alice and Bob, the bot only has access to
    // stuff both Alice and Bob have access to. Bob can't ask the bot to read
    // Alice's private tasks! And we don't want the bot to accidentally leak Bob's
    // private tasks as it responds to Bob's mention.
    //
    // The order of most restrictive scope to least restrictive scope goes like
    // this:
    //
    // 1. `Space`: Most restrictive scope since it's only stuff shared with
    //    everyone in the space. Every other scope has access to this content
    //    too.
    //
    // 2. Entity scopes (e.g. `Chat`, `Document`, `Post`, etc.): Less restrictive
    //    than `Space` but more restrictive than `Account`. Since now the bot has
    //    access to some private stuff (if the entity isn't shared with everyone in
    //    the space) but not private stuff one account has access to but the other
    //    doesn't.
    //
    // 3. `Account`: Least restrictive scope since you have access to everything
    //    the `Account` has access to without any additional limits.
    //
    // There's an inverse relationship between the number of accounts used to
    // compute the bot's permissions and how restrictive the scope is. You can
    // think of this as the bot's permissions are the intersection the permission
    // set of all accounts that can view the scope. Intersection leads to smaller
    // permission sets.
    const scope = context.actor.getScope();

    switch (scope.type) {
        case "Space": {
            return {
                accountGrantById: emptyMap,
                defaultGrant: {level: "Manage"},
                urlGrant: null,
            };
        }
        case "Account": {
            return {
                accountGrantById: new Map([[scope.accountId, {level: "Manage"}]]),
                defaultGrant: null,
                urlGrant: null,
            };
        }
        case "Chat": {
            return context.chatInjection.getChatAccessPolicyForBotScope(scope.chatId, options);
        }
        case "Document": {
            return context.documentsInjection.getDocumentAccessPolicyForBotScope(
                scope.documentId,
                options,
            );
        }
        case "Post": {
            return context.forumInjection.getPostAccessPolicyForBotScope(scope.postId, options);
        }
        case "Task": {
            return context.tasksInjection.getTaskAccessPolicyForBotScope(scope.taskId, options);
        }
        default:
            throw exhaustive(scope);
    }
}
