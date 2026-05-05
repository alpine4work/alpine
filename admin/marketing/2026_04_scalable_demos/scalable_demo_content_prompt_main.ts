import * as inquirer from "@inquirer/prompts";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {runProcessWithInheritedStdio} from "~/server/helpers/node/run_process_with_inherited_stdio.js";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

const env = parseDotenv();

const xPlatformPrompt = markdown`
You are a word class degenerate genz social media marketer. You\u2019re in touch with the latest
trends and what gets views on X (the everything app). You work for Alpine, the modern productivity
suite. Alpine has a daily demo video series posted on X. These demo videos are short (8–12 seconds)
and show exactly one feature. You need to come up with engaging X post text for these videos.

A couple rules you must follow:

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

async function main() {
    const workspacePath = getWorkspacePath();
    const demosPath = joinPath(workspacePath, "admin/marketing/2026_04_scalable_demos/demos");

    const demoNames = (await fs.readdir(demosPath)).filter(name =>
        name.endsWith("_demo_recorder.ts"),
    );

    const platform = await inquirer.select({
        message: "Platform",
        choices: [
            {name: "X", value: "x"},
            {name: "LinkedIn", value: "linkedin"},
        ] as const,
    });

    const demoName = await inquirer.select({
        message: "Demo",
        choices: demoNames
            .map(demoName => ({
                name: demoName.slice(0, -"_recorder.ts".length),
                value: demoName,
            }))
            .reverse(),
    });

    const additionalNotes = await inquirer.input({
        message: "Additional notes",
    });

    const demoCode = await fs.readFile(joinPath(demosPath, demoName), "utf8");

    const platformPrompt = {
        x: xPlatformPrompt,
        linkedin: linkedInPlatformPrompt,
    }[platform];

    const prompt =
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
        "\n\n## Additional notes\n\n" +
        additionalNotes.trim() +
        "\n";

    const claudeEnv = {
        CLAUDE_CODE_OAUTH_TOKEN: assertExists(
            env.CLAUDE_CODE_OAUTH_TOKEN,
            "Missing `CLAUDE_CODE_OAUTH_TOKEN` in `.env.development.local`. Run `claude setup-token` and add the generated token to `.env.development.local`.",
        ),
    };

    const claudeBaseArgs = [
        ["--settings", joinPath(workspacePath, ".claude/settings.json")],
        ["--permission-mode", "dontAsk"],
        "-p",
    ];

    // eslint-disable-next-line no-console
    console.log("\nGenerating post copy with Claude...\n");

    await runProcessWithInheritedStdio("claude", claudeBaseArgs, {
        cwd: workspacePath,
        stdin: prompt,
        env: claudeEnv,
    });

    // Follow-up loop — press Enter with no input to exit.
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
