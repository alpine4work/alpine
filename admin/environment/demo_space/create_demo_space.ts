import {uploadDemoSpaceAccountAvatar} from "~/admin/environment/demo_space/upload_demo_space_account_avatar.js";
import {uploadDemoSpaceAvatar} from "~/admin/environment/demo_space/upload_demo_space_avatar.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {runAllObjectPromises, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

const debug = createDebug(import.meta.url);

export type DemoSpaceAccounts = Awaited<ReturnType<typeof createDemoSpaceAccounts>>;

export async function createDemoSpace(context: TestContext, tokenAgent: TokenAgent) {
    const {space, accounts} = await createDemoSpaceWithoutUploadingAvatars(context);

    await runAllPromises([
        uploadDemoSpaceAvatars(tokenAgent, accounts),
        uploadDemoSpaceAccountAvatars(tokenAgent, accounts),
    ]);

    return {space, accounts};
}

export async function createDemoSpaceWithoutUploadingAvatars(context: TestContext) {
    debug("Creating space");

    const space = await TestSpace.create(context, {
        // We use our company name for the space since a fictional product name might not
        // be clear (it may look like an Alpine product name). Plus it's good to get our
        // company name in more screenshots.
        name: "Alpine",
    });

    const accounts = await createDemoSpaceAccounts(space);

    debug("Created accounts");

    const currentTime = new Date();

    const emailAddressTime =
        currentTime.getFullYear().toString().padStart(4, "0") +
        "." +
        (currentTime.getMonth() + 1).toString().padStart(2, "0") +
        "." +
        currentTime.getDate().toString().padStart(2, "0") +
        "." +
        // Seconds through the day. We use this format instead of `hh.mm.ss` so the date
        // clearly reads as a date. Seconds are added on purely to disambiguate.
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

    return {space, accounts, cassCadeEmailAddress, roseCompasEmailAddress};
}

export async function uploadDemoSpaceAvatars(tokenAgent: TokenAgent, accounts: DemoSpaceAccounts) {
    await runAllPromises([
        uploadDemoSpaceAvatar(
            tokenAgent,
            accounts.cassCade,
            "light",
            "demo_space_avatar_light.svg",
        ),
        uploadDemoSpaceAvatar(tokenAgent, accounts.cassCade, "dark", "demo_space_avatar_dark.svg"),
        uploadDemoSpaceAccountAvatars(tokenAgent, accounts),
    ]);

    debug("Uploaded avatars");
}

async function createDemoSpaceAccounts(space: TestSpace) {
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
            reactionCharacter: {type: "Frog", variant: "Green"},
        }),

        // Engineer 1
        masonClay: space.createSession({
            name: "Mason Clay",
            reactionCharacter: {type: "Pigeon", variant: "Plain"},
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
            reactionCharacter: {type: "Tulip", variant: "Pink"},
        }),
    });
}

export async function uploadDemoSpaceAccountAvatars(
    tokenAgent: TokenAgent,
    accounts: DemoSpaceAccounts,
) {
    const upload = (name: Exclude<keyof DemoSpaceAccounts, "chatGpt">, path: string) =>
        uploadDemoSpaceAccountAvatar(tokenAgent, accounts[name], path);

    await runAllPromises([
        upload("cassCade", "demo_space_cass_cade_avatar.png"),
        upload("roseCompas", "demo_space_rose_compas_avatar.png"),
        upload("mattRHorn", "demo_space_matt_r_horn_avatar.png"),
        upload("masonClay", "demo_space_mason_clay_avatar.png"),
        upload("elleKappaTan", "demo_space_elle_kappa_tan_avatar.png"),
        upload("cliffWeathers", "demo_space_cliff_weathers_avatar.png"),
        upload("hollyEvergreen", "demo_space_holly_evergreen_avatar.png"),
    ]);
}
