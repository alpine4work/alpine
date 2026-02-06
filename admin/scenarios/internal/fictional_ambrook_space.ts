import {createDebug} from "~/admin/helpers/create_debug.js";
import {uploadScenarioAccountAvatar} from "~/admin/scenarios/internal/upload_scenario_account_avatar.js";
import {uploadScenarioSpaceAvatar} from "~/admin/scenarios/internal/upload_scenario_space_avatar.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {runAllObjectPromises, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

const debug = createDebug(import.meta.url);

export type FictionalAmbrookAccounts = Awaited<ReturnType<typeof createFictionalAmbrookAccounts>>;

export async function createFictionalAmbrookSpace(context: TestContext, tokenAgent: TokenAgent) {
    debug("Creating space");

    const space = await TestSpace.create(context, {
        // We use our company name for the space since a fictional product name might
        // not be clear (it may look like an Alpine product name). Plus it's good to
        // get our company name in more screenshots.
        name: "Alpine",
    });

    const accounts = await createFictionalAmbrookAccounts(space);

    debug("Created accounts");

    const currentTime = new Date();

    const emailAddressTime =
        currentTime.getFullYear().toString().padStart(4, "0") +
        "." +
        (currentTime.getMonth() + 1).toString().padStart(2, "0") +
        "." +
        currentTime.getDate().toString().padStart(2, "0") +
        "." +
        // Seconds through the day. We use this format instead of `hh.mm.ss` so the
        // date clearly reads as a date. Seconds are added on purely to disambiguate.
        (
            currentTime.getHours() * 60 * 60 +
            currentTime.getMinutes() * 60 +
            currentTime.getSeconds()
        )
            .toString()
            .padStart(5, "0");

    const [cassCadeEmailAddress, roseCompasEmailAddress] = await runAllPromises([
        accounts.cassCade.account.createEmailAddress(
            `cass.cade.${emailAddressTime}@test.cyberworlds.dev`,
        ),
        accounts.roseCompas.account.createEmailAddress(
            `rose.compas.${emailAddressTime}@test.cyberworlds.dev`,
        ),
    ]);

    context.process.waitUntil(async () => {
        await runAllPromises([
            uploadScenarioSpaceAvatar(
                tokenAgent,
                accounts.cassCade,
                "light",
                "scenario_space_avatar_light.svg",
            ),
            uploadScenarioSpaceAvatar(
                tokenAgent,
                accounts.cassCade,
                "dark",
                "scenario_space_avatar_dark.svg",
            ),
            uploadFictionalAmbrookAccountAvatars(tokenAgent, accounts),
        ]);

        debug("Uploaded avatars");
    });

    return {space, accounts, cassCadeEmailAddress, roseCompasEmailAddress};
}

async function createFictionalAmbrookAccounts(space: TestSpace) {
    const roseCompasPromise = space.createSession({
        name: "Rose Compás",
        role: "Owner",
        reactionCharacter: {type: "Tree", variant: "Green"},
    });

    return runAllObjectPromises({
        // Chief of Staff (landing page is from Cass's perspective)
        cassCade: space.createSession({
            name: "Cass Cade",
            role: "Admin",
            reactionCharacter: {type: "Yeti", variant: "Blue"},
        }),

        // CEO (launch video is from Rose's perspective)
        roseCompas: roseCompasPromise,

        // Designer
        mattRHorn: space.createSession({
            name: "Matt R. Horn",
            reactionCharacter: {type: "Cat", variant: "Grey"},
        }),

        // Engineer 1
        masonClay: space.createSession({
            name: "Mason Clay",
            reactionCharacter: {type: "Yeti", variant: "Brown"},
        }),

        // Engineer 2
        elleKappaTan: space.createSession({
            name: "Elle Kappa-Tan",
            reactionCharacter: {type: "Cat", variant: "Yellow"},
        }),

        // Sales
        cliffWeathers: space.createSession({
            name: "Cliff Weathers",
            reactionCharacter: {type: "Tree", variant: "Blue"},
        }),

        // HR
        hollyEvergreen: space.createSession({
            name: "Holly Evergreen",
            reactionCharacter: {type: "Tree", variant: "Pink"},
        }),

        // AI
        chatGpt: (async () => {
            // TODO(calebmer, 2025-12-08): We don't currently have bot avatars set up yet.
            // There's a file in `scenario_chatgpt_avatar.png` that we're not currently
            // using. We need to figure out a way to get avatars uploaded for bots for test
            // scenarios.
            const bot = await TestBot.get(space.context, getDynamoSeedConstants().mockChatGptBotId);

            const roseCompas = await roseCompasPromise;

            return bot.instantiate(roseCompas);
        })(),
    });
}

export async function uploadFictionalAmbrookAccountAvatars(
    tokenAgent: TokenAgent,
    accounts: FictionalAmbrookAccounts,
) {
    const upload = (name: Exclude<keyof FictionalAmbrookAccounts, "chatGpt">, path: string) =>
        uploadScenarioAccountAvatar(tokenAgent, accounts[name], path);

    await runAllPromises([
        upload("cassCade", "scenario_cass_cade_avatar.png"),
        upload("roseCompas", "scenario_rose_compas_avatar.png"),
        upload("mattRHorn", "scenario_matt_r_horn_avatar.png"),
        upload("masonClay", "scenario_mason_clay_avatar.png"),
        upload("elleKappaTan", "scenario_elle_kappa_tan_avatar.png"),
        upload("cliffWeathers", "scenario_cliff_weathers_avatar.png"),
        upload("hollyEvergreen", "scenario_holly_evergreen_avatar.png"),
    ]);
}
