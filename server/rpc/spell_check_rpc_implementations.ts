import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {backfillSpellCheckIgnoredLints} from "~/server/spell_check/backfill_spell_check_ignored_lints.js";
import {createSpellCheckIgnoredLint} from "~/server/spell_check/create_spell_check_ignored_lint.js";
import {getSpellCheckIgnoredLints} from "~/server/spell_check/get_spell_check_ignored_lints.js";
import * as definitions from "~/shared/rpc/spell_check_rpc_definitions.js";

export default implementRpcs(definitions, {
    getSpellCheckIgnoredLints: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const spellCheckIgnoredLints = await getSpellCheckIgnoredLints(
                context.actor.authorizeSession(),
                input.entityId,
            );
            return {spellCheckIgnoredLints};
        },
    },

    backfillSpellCheckIgnoredLints: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const result = await backfillSpellCheckIgnoredLints(context, input);
            return {result};
        },
    },

    createSpellCheckIgnoredLint: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {getRynamoEventTransaction} = await createSpellCheckIgnoredLint(
                context.actor.authorizeSession(),
                input.entityId,
                input.key,
                input.kind,
            );

            return {
                eventTransaction: await getRynamoEventTransaction(context),
            };
        },
    },
});
