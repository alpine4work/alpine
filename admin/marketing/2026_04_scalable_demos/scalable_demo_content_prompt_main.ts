import * as inquirer from "@inquirer/prompts";
import fs from "fs/promises";
import {dirname, join as joinPath} from "path";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {runProcessWithInheritedStdio} from "~/server/helpers/node/run_process_with_inherited_stdio.js";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

const env = parseDotenv();

const xPlatformPrompt = markdown`
You are a word class degenerate genz social media marketer. You\u2019re in touch with the latest
trends and what gets views on X (the everything app). You work for Alpine, the modern productivity
suite. Alpine has a daily demo video series posted on X. These demo videos are short (8–12 seconds)
and show exactly one feature. You need to come up with engaging X post text for these videos.

## What makes a great post

The post text is MORE important than the video. The video is eye candy. The text is what actually
stops the scroll and makes someone care.

Our best performing posts follow this structure:

1. **Hook** \u2014 a punchy first line that feels like something is launching. It should catch the
   viewer\u2019s attention on its own, even without the video. Think \u201Cwe built an app where
   that\u2019s one scroll instead\u201D not \u201Ccheck out this new feature.\u201D The hook should
   make the viewer feel like they\u2019re discovering something, not watching a product demo.

2. **Real problem** \u2014 call out a specific, relatable pain the viewer actually experiences at
   work. Not abstract productivity talk. Concrete. \u201CYou spent 20 minutes this
   morning\u2026\u201D hits harder than \u201Csave time on your workflow.\u201D The viewer should
   think \u201Cyeah, that IS annoying.\u201D

3. **The payoff** \u2014 connect the problem to what Alpine does about it. Keep it tight.

The post must be entirely self-contained. A viewer who never watches the video should still get a
complete, compelling idea from the text alone. Our posts that flop feel like captions for a demo
video. Our posts that pop feel like a complete thing is being presented, and the video just happens
to be attached. Write the post as if there is no video.

## Rules you must follow

- Posts are written entirely in lowercase (after all, you are a degenerate genz social media
  marketer).

- Posts will be made from Alpine\u2019s founder (Caleb Meredith\u2019s) account. So you can say
  things like \u201Cmy app\u201D or \u201Ci built\u201D. These are build-in-public style posts.

- Assume the viewer knows nothing about Alpine. The post should still be interesting to them! The
  demo videos alone are very aesthetic but need some text to explain what\u2019s happening. We
  provide value to the viewer by being aesthetic and showing them an interesting idea.

- The hook in the first few words is the most important part of the whole post! It should catch the
  viewer\u2019s attention and set them up for what they\u2019re about to see in the video.

- Posts should be no longer than one or two sentences. Three if you absolutely must.

- Be provocative, be funny, be arrogant. As a degenerate genz social media marketer, you should know
  this works well on X.

- The theme of the demo series is \u201Chow Alpine saves you time\u201D. Your text should generally
  explain how the presented feature saves you time at work. THIS IS THE MOST IMPORTANT RULE. We
  should always connect features back to how they save the viewer time.

Think hard, cook for a bit, then provide three different options for the post text.
`;

const linkedInPlatformPrompt = markdown`
You are a world class social media marketer. Specializing in growing LinkedIn accounts for
executives. You understand the motivations of the person browsing LinkedIn and what will resonate
with them. You work for Alpine, the modern productivity suite. Alpine has a daily demo video series
posted on LinkedIn. These demo videos are short (8-12 seconds) and show exactly one feature. You
need to write engaging post text to go along with these videos.

A couple rules you must follow:

- The theme for this demo series is \u201Chow Alpine saves you time\u201D. Generally, the post
  should discuss something that eats a lot of the viewer\u2019s time at work and how the Alpine
  feature shown helps.

- Posts will be made from Alpine\u2019s founder (Caleb Meredith\u2019s) account. So you can say
  things like \u201Cmy app\u201D or \u201CI built\u201D. Caleb is proud of what he\u2019s built and
  that shows in the content.

- The first sentence hook is the most important part of the whole post! On a LinkedIn feed
  there\u2019s a sentence or two of content visible and then a \u201CSee more\u201D button. This
  \u201CSee more\u201D button appears after the first 1–2 lines of text. That text should capture
  the viewers attention and cause them to hit \u201CSee more\u201D to read the rest of the post. We
  recommend ending the first 1–2 lines with a \u201C:\u201D or \u201C…\u201D or something
  that\u2019ll appear right before the \u201CSee more\u201D button to really get the user curious
  about what\u2019s next.

- Provide value to the viewer in the first half of the post that\u2019s unrelated to Alpine. Then in
  the second half connect the Alpine feature on display to whatever generic topic you chose for the
  first half.

- Assume the viewer knows nothing about Alpine.

- Posts should be <750 characters and have varied formatting (some examples of popular formatting
  options on LinkedIn: numbered lists, bullet list with \u201C→\u201D as the bullet, bullet list
  with \u201C↳\u201D as the bullet following another line of text, parenthetical. you\u2019re the
  expert, draw from your expertise as well).

- The post text must be able to completely stand on its own. It should be valuable even if the
  viewer didn\u2019t watch the video. So the text should probably explain what\u2019s in the video.

- Be professional but fun. Everyone\u2019s favorite coworker who keeps it light. Be candid,
  don\u2019t mince words but also don\u2019t hurt feelings. The target of your candor is usually
  something everyone believes to be bad.

Think hard then provide three different options for the post text.
`;

type Platform = "x" | "linkedin";

type ContentPromptArgs = {
    additionalNotes: string | null;
    demoArg: string | null;
    outputPath: string | null;
    platform: Platform | null;
    url: string | null;
};

function parseContentPromptArgs(): ContentPromptArgs {
    const argv = process.argv.slice(2);
    let additionalNotes: string | null = null;
    let demoArg: string | null = null;
    let outputPath: string | null = null;
    let platform: Platform | null = null;
    let url: string | null = null;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;

        if (arg === "--demo") {
            demoArg = argv[i + 1] ?? null;
            i++;
            continue;
        }

        if (arg.startsWith("--demo=")) {
            demoArg = arg.slice("--demo=".length);
            continue;
        }

        if (arg === "--notes") {
            additionalNotes = argv[i + 1] ?? null;
            i++;
            continue;
        }

        if (arg.startsWith("--notes=")) {
            additionalNotes = arg.slice("--notes=".length);
            continue;
        }

        if (arg === "--output") {
            outputPath = argv[i + 1] ?? null;
            i++;
            continue;
        }

        if (arg.startsWith("--output=")) {
            outputPath = arg.slice("--output=".length);
            continue;
        }

        if (arg === "--platform") {
            platform = parsePlatform(argv[i + 1] ?? "");
            i++;
            continue;
        }

        if (arg.startsWith("--platform=")) {
            platform = parsePlatform(arg.slice("--platform=".length));
            continue;
        }

        if (arg === "--url") {
            url = argv[i + 1] ?? null;
            i++;
            continue;
        }

        if (arg.startsWith("--url=")) {
            url = arg.slice("--url=".length);
            continue;
        }

        throw new InvalidArgumentError(`Unknown argument: ${arg}`);
    }

    return {additionalNotes, demoArg, outputPath, platform, url};
}

function parsePlatform(platform: string): Platform {
    switch (platform) {
        case "linkedin":
        case "x":
            return platform;
        default:
            throw new InvalidArgumentError(`Unsupported platform: ${platform}`);
    }
}

function resolveDemoName(demoNames: ReadonlyArray<string>, demoArg: string): string {
    const matches = demoNames.filter(demoName => {
        const demoBaseName = demoName.slice(0, -"_recorder.ts".length);

        if (/^\d+$/.test(demoArg)) {
            return demoBaseName.startsWith(`${demoArg.padStart(3, "0")}_`);
        }

        return demoBaseName.startsWith(demoArg);
    });

    switch (matches.length) {
        case 0:
            throw new InvalidArgumentError(`No demo recorder found matching: ${demoArg}`);
        case 1:
            return matches[0]!;
        default:
            throw new InvalidArgumentError(
                `Multiple demo recorders matched ${demoArg}: ${matches.join(", ")}`,
            );
    }
}

async function getInteractivePlatform(): Promise<Platform> {
    return inquirer.select({
        message: "Platform",
        choices: [
            {name: "X", value: "x"},
            {name: "LinkedIn", value: "linkedin"},
        ] as const,
    });
}

async function getInteractiveDemoName(demoNames: ReadonlyArray<string>): Promise<string> {
    return inquirer.select({
        message: "Demo",
        choices: demoNames
            .map(demoName => ({
                name: demoName.slice(0, -"_recorder.ts".length),
                value: demoName,
            }))
            .reverse(),
    });
}

function createPrompt({
    additionalNotes,
    demoCode,
    demoName,
    platform,
    url,
}: {
    additionalNotes: string;
    demoCode: string;
    demoName: string;
    platform: Platform;
    url: string | null;
}): string {
    const platformPrompt = {
        linkedin: linkedInPlatformPrompt,
        x: xPlatformPrompt,
    }[platform];
    const recordingUrlSection =
        url === null || url.trim() === "" ? "" : `\n\n## Recording URL\n\n${url.trim()}`;

    return (
        platformPrompt.trim() +
        "\n\n" +
        markdown`
## Demo video code

Here\u2019s the code for the demo you\u2019ll be showcasing today. This code launches a browser
controlled by Playwright and a human will start a screen recording and follow the \`instructions\`
to create the demo video. This demo video will be posted along with the text you write.
        `.trim() +
        `\n\nThis code is from the file \`admin/marketing/2026_04_scalable_demos/demos/${demoName}\`:\n\n\`\`\`ts\n` +
        demoCode.trim() +
        "\n```\n\n" +
        markdown`
Remember, you\u2019re a marketer, not an engineer. We include the code since that\u2019ll be easy
for you to understand as an LLM assistant summoning the knowledge of a world class marketer from
your training data (vs trying to have you watch a video). Feel free to browse the codebase to learn
more about the Alpine feature in question but be careful that this doesn\u2019t pollute your context
and cause you to sound like an out-of-touch software engineer.
        `.trim() +
        recordingUrlSection +
        "\n\n## Additional notes\n\n" +
        additionalNotes.trim() +
        "\n"
    );
}

async function runClaude({
    claudeBaseArgs,
    claudeEnv,
    outputPath,
    prompt,
    workspacePath,
}: {
    claudeBaseArgs: Array<string | Array<string>>;
    claudeEnv: {[key: string]: string};
    outputPath: string | null;
    prompt: string;
    workspacePath: string;
}): Promise<void> {
    let generatedOutput = "";

    await runProcessWithInheritedStdio("claude", claudeBaseArgs, {
        cwd: workspacePath,
        stdin: prompt,
        env: claudeEnv,
        onStdoutData: chunk => {
            generatedOutput += Buffer.from(chunk).toString("utf8");
        },
    });

    if (outputPath === null) return;

    const resolvedOutputPath = joinPath(workspacePath, outputPath);
    await fs.mkdir(dirname(resolvedOutputPath), {recursive: true});
    await fs.writeFile(resolvedOutputPath, generatedOutput.trim() + "\n");
}

async function main() {
    const workspacePath = getWorkspacePath();
    const demosPath = joinPath(workspacePath, "admin/marketing/2026_04_scalable_demos/demos");
    const args = parseContentPromptArgs();
    const isInteractive = process.argv.slice(2).length === 0;

    const demoNames = (await fs.readdir(demosPath)).filter(name =>
        name.endsWith("_demo_recorder.ts"),
    );
    const platform = isInteractive
        ? await getInteractivePlatform()
        : assertExists(args.platform, "Missing required argument `--platform`.");
    const demoName = isInteractive
        ? await getInteractiveDemoName(demoNames)
        : resolveDemoName(
              demoNames,
              assertExists(args.demoArg, "Missing required argument `--demo`."),
          );
    const additionalNotes = isInteractive
        ? await inquirer.input({message: "Additional notes"})
        : (args.additionalNotes ?? "");
    const demoCode = await fs.readFile(joinPath(demosPath, demoName), "utf8");
    const prompt = createPrompt({
        additionalNotes,
        demoCode,
        demoName,
        platform,
        url: args.url,
    });

    const claudeEnv = {
        CLAUDE_CODE_OAUTH_TOKEN: assertExists(
            env.CLAUDE_CODE_OAUTH_TOKEN,
            "Missing `CLAUDE_CODE_OAUTH_TOKEN` in `.env.development.local`. Run `claude setup-token` and add the generated token to `.env.development.local`.",
        ),
    };
    const claudeBaseArgs: Array<string | Array<string>> = [
        ["--settings", joinPath(workspacePath, ".claude/settings.json")],
        ["--permission-mode", "dontAsk"],
        "-p",
    ];

    // eslint-disable-next-line no-console
    console.log("\nGenerating post copy with Claude...\n");

    await runClaude({
        claudeBaseArgs,
        claudeEnv,
        outputPath: args.outputPath,
        prompt,
        workspacePath,
    });

    if (!isInteractive) return;

    while (true) {
        // eslint-disable-next-line no-console
        console.log();
        const followUp = await inquirer.input({message: "Follow up (or press Enter to exit)"});
        if (!followUp.trim()) break;

        // eslint-disable-next-line no-console
        console.log("Thinking...\n");
        await runProcessWithInheritedStdio("claude", [...claudeBaseArgs, "--continue"], {
            cwd: workspacePath,
            stdin: followUp,
            env: claudeEnv,
        });
    }
}

main().then(
    () => {
        process.exit(0);
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exit(1);
    },
);
