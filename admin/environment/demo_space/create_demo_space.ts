import {uploadDemoSpaceAccountAvatar} from "~/admin/environment/demo_space/upload_demo_space_account_avatar.js";
import {uploadDemoSpaceAvatar} from "~/admin/environment/demo_space/upload_demo_space_avatar.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {runAllObjectPromises, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId, unsafelyGenerateStableId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

const debug = createDebug(import.meta.url);

export type DemoSpaceAccounts = Awaited<ReturnType<typeof createDemoSpaceAccounts>>;

export async function createDemoSpace(
    context: TestContext,
    tokenAgent: TokenAgent,
    options?: {stableRandom?: StableRandom},
) {
    const {space, accounts} = await createDemoSpaceWithoutUploadingAvatars(context, options);

    await runAllPromises([
        uploadDemoSpaceAvatars(tokenAgent, accounts),
        uploadDemoSpaceAccountAvatars(tokenAgent, accounts),
    ]);

    return {space, accounts};
}

export async function createDemoSpaceWithoutUploadingAvatars(
    context: TestContext,
    options?: {stableRandom?: StableRandom},
) {
    debug("Creating space");

    const space = await TestSpace.create(context, {
        id: options?.stableRandom
            ? unsafelyGenerateStableId<SpaceId>(options.stableRandom, "demoSpace")
            : undefined,

        // We use our company name for the space since a fictional product name might not
        // be clear (it may look like an Alpine product name). Plus it's good to get our
        // company name in more screenshots.
        name: "Alpine",
    });

    const accounts = await createDemoSpaceAccounts(space, options);

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

async function createDemoSpaceAccounts(space: TestSpace, options?: {stableRandom?: StableRandom}) {
    // Generate all `AccountId`s up front and sort them. So anything in the product
    // that depends on `AccountId` sort order is consistent across demo spaces.
    const accountIds = createArrayWithLength(7, index =>
        options?.stableRandom
            ? unsafelyGenerateStableId<AccountId>(options.stableRandom, `demoSpaceAccount:${index}`)
            : generateId<AccountId>(),
    ).sort(defaultCompareStrings);

    const currentTime = Date.now();
    const createdTimes = createArrayWithLength(7, index => new Date(currentTime + index));

    return runAllObjectPromises({
        // Chief of Staff (landing page is from Cass's perspective)
        cassCade: space.createSession({
            id: accountIds[0],
            overrideCreatedTime: createdTimes[0],
            name: "Cass Cade",
            role: "Admin",
            reactionCharacter: {type: "Yeti", variant: "Blue"},
        }),

        // CEO (launch video is from Rose's perspective)
        roseCompas: space.createSession({
            id: accountIds[1],
            overrideCreatedTime: createdTimes[1],
            name: "Rose Compás",
            role: "Owner",
            reactionCharacter: {type: "Tree", variant: "Green"},
            hasInternalAccess: true,
        }),

        // Designer
        mattRHorn: space.createSession({
            id: accountIds[2],
            overrideCreatedTime: createdTimes[2],
            name: "Matt R. Horn",
            reactionCharacter: {type: "Frog", variant: "Green"},
        }),

        // Engineer 1
        masonClay: space.createSession({
            id: accountIds[3],
            overrideCreatedTime: createdTimes[3],
            name: "Mason Clay",
            reactionCharacter: {type: "Pigeon", variant: "Plain"},
        }),

        // Engineer 2
        elleKappaTan: space.createSession({
            id: accountIds[4],
            overrideCreatedTime: createdTimes[4],
            name: "Elle Kappa-Tan",
            reactionCharacter: {type: "Cat", variant: "Yellow"},
        }),

        // Sales
        cliffWeathers: space.createSession({
            id: accountIds[5],
            overrideCreatedTime: createdTimes[5],
            name: "Cliff Weathers",
            reactionCharacter: {type: "Tree", variant: "Blue"},
        }),

        // HR
        hollyEvergreen: space.createSession({
            id: accountIds[6],
            overrideCreatedTime: createdTimes[6],
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
