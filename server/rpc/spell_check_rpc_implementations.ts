import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {
    createSpellCheckIgnoredLint,
    getSpellCheckIgnoredLints,
} from "~/server/spell_check/spell_check_actions.js";
import * as definitions from "~/shared/rpc/spell_check_rpc_definitions.js";

export default implementRpcs(definitions, {
    getSpellCheckIgnoredLints: {
        visibility: ["AppClient", "DocumentCollaborationService"],
        execute: async (context, input) => {
            const ignoredLints = await getSpellCheckIgnoredLints(
                context.actor.authorizeSession(),
                input.spellCheckEntityId,
            );
            return {ignoredLints: ignoredLints.map(item => item.model)};
        },
    },

    createSpellCheckIgnoredLint: {
        visibility: ["AppClient", "DocumentCollaborationService"],
        execute: async (context, input) => {
            await createSpellCheckIgnoredLint(
                context.actor.authorizeSession(),
                input.spellCheckEntityId,
                input.key,
                input.kind,
            );

            return {};
        },
    },
});
