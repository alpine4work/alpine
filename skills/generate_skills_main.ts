import fs from "fs/promises";
import {Tokenizer as HtmlTokenizer} from "htmlparser2";
import {Root, RootContent} from "mdast";
import {dirname, relative as relativePath, resolve as resolvePath} from "path";
import Yaml from "yaml";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {quote} from "~/shared/helpers/string/quote.js";

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

async function main() {
    const directoryPath = process.cwd();

    const markdownDirectoryRelativePaths = new Set<string>();

    const markdownPaths = new Set(
        process.argv.slice(2).map(markdownPath => {
            markdownDirectoryRelativePaths.add(dirname(markdownPath));
            return resolvePath(directoryPath, markdownPath);
        }),
    );

    for (const markdownDirectoryRelativePath of markdownDirectoryRelativePaths) {
        if (
            !markdownPaths.has(
                resolvePath(directoryPath, markdownDirectoryRelativePath, "SKILL.internal.md"),
            )
        ) {
            throw new InternalError(
                quote`Missing \`SKILL.internal.md\` file in ${markdownDirectoryRelativePath}`,
            );
        }
    }

    await runAllPromises(
        mapIterable(markdownPaths, async markdownPath => {
            assert(markdownPath.endsWith(".internal.md"));

            const markdownDirectoryPath = dirname(markdownPath);

            const markdownContent = await fs.readFile(markdownPath, "utf8");
            const markdownTree = parseMarkdownTree(markdownContent);

            let charBefore: string | null = null;

            const traverse = (node: Root | RootContent) => {
                switch (node.type) {
                    case "yaml": {
                        // Parse/print YAML to a standard format without the prose wrapping from our
                        // default Prettier config.
                        node.value = Yaml.stringify(Yaml.parse(node.value), {
                            indent: 2,
                            lineWidth: 0,
                        }).trimEnd();
                        break;
                    }

                    case "heading":
                    case "paragraph":
                    case "tableCell": {
                        charBefore = null;
                        break;
                    }

                    // Replace straight quotes with proper curly quotes. Markdown, unlike
                    // `<ContentEditor>` which automatically adds curly quotes while the user is typing
                    // and unlike JavaScript code which has a lint warning when you don't use curly
                    // quotes, doesn't currently have a way to prevent us from using straight quotes.
                    // So in our build step we add curly quotes.
                    case "text": {
                        let value = node.value;

                        for (let index = 0; index < value.length; index++) {
                            const char = value[index]!;

                            // eslint-disable-next-line cyberworlds/string-quotes
                            if (char !== "'" && char !== '"') {
                                charBefore = char;
                                continue;
                            }

                            let properQuote: string;

                            // eslint-disable-next-line cyberworlds/string-quotes
                            if (char === '"') {
                                if (
                                    charBefore === null ||
                                    /(\p{White_Space}|["\u201C\u201D])/u.test(charBefore)
                                ) {
                                    properQuote = "\u201C";
                                } else {
                                    properQuote = "\u201D";
                                }
                            } else {
                                if (
                                    charBefore === null ||
                                    /(\p{White_Space}|['\u2018\u2019])/u.test(charBefore)
                                ) {
                                    properQuote = "\u2018";
                                } else {
                                    properQuote = "\u2019";
                                }
                            }

                            value = value.slice(0, index) + properQuote + value.slice(index + 1);
                            charBefore = char;
                        }

                        // Make sure prose is not wrapped in the final generated markdown. We theorize that
                        // agents are better at reading unwrapped prose so there's not a bunch of pesky
                        // `\n` tokens lying around that are less common in the training data.
                        node.value = value.replaceAll(/\n+/g, " ");
                        break;
                    }

                    case "link": {
                        // Link to the open internet, allowed.
                        if (/^https?:\/\//.test(node.url)) break;

                        const linkPath = resolvePath(markdownDirectoryPath, node.url);

                        // Make sure all links are valid.
                        if (!markdownPaths.has(linkPath)) {
                            throw new InternalError(quote`Link not found: ${node.url}`);
                        }

                        // Drop the ".internal" suffix. When open sourced these will all be plain `.md`
                        // files.
                        node.url = node.url.replace(/\.internal\.md$/, ".md");
                        break;
                    }
                }

                if ("children" in node) {
                    let nextIndex = 0;

                    while (nextIndex < node.children.length) {
                        const index = nextIndex;
                        nextIndex++;
                        const childNode = node.children[index]!;

                        traverse(childNode);

                        // Strip HTML comments from markdown. HTML comments are internal developer only
                        // notes which aren't to be shared with agents.
                        if (childNode.type === "html") {
                            const comments: Array<{start: number; end: number}> = [];

                            const tokenizer = new HtmlTokenizer(
                                {},
                                {
                                    oncomment: (start, end) => {
                                        comments.push({start: start - 4, end: end + 2});
                                    },

                                    ontext: noop,
                                    ontextentity: noop,
                                    onopentagname: noop,
                                    onopentagend: noop,
                                    onclosetag: noop,
                                    onattribname: noop,
                                    onattribdata: noop,
                                    onattribentity: noop,
                                    onattribend: noop,
                                    oncdata: noop,
                                    ondeclaration: noop,
                                    onend: noop,
                                    onprocessinginstruction: noop,
                                    onselfclosingtag: noop,
                                },
                            );

                            tokenizer.write(childNode.value);
                            tokenizer.end();

                            for (const comment of comments.reverse()) {
                                childNode.value =
                                    childNode.value.slice(0, comment.start) +
                                    childNode.value.slice(comment.end);
                            }

                            if (childNode.value.trim().length === 0) {
                                node.children.splice(index, 1);
                                nextIndex = index;
                            }
                        }
                    }
                }
            };

            traverse(markdownTree);

            const formattedMarkdownContent = printMarkdownTree(markdownTree);

            // Make sure the file size is under `agentWebBytesDefaultLimit` (20kb as of
            // 2026-07-27). Which is the default limit for `read`. We calculated
            // `agentWebBytesDefaultLimit` to be a comfortable amount to give an agent a good
            // amount of context while preventing really large documents from totally filling
            // its context window. We try to keep skill files one fourth the default `read`
            // limit! We don't want to fill an agent's context up with skills.
            //
            // Just like the `read` tool, we pretend the JavaScript string `length` is the
            // number of UTF-8 bytes. Read the documentation on
            // `truncateAgentWebReadResponse()` for more information about that decision.
            const maxLengthInKb = 5;

            if (formattedMarkdownContent.length >= maxLengthInKb * 1000) {
                throw new InternalError(
                    quote`Skill markdown file too large, expected all markdown skill files to be under ${maxLengthInKb}kb but ${relativePath(directoryPath, markdownPath)} is ${parseFloat(Math.max(maxLengthInKb + 0.1, formattedMarkdownContent.length / 1000).toFixed(1))}kb. Consider splitting the skill file into multiple smaller files?`,
                );
            }

            await fs.writeFile(
                markdownPath.slice(0, -".internal.md".length) + ".open_source.generated.md",
                formattedMarkdownContent,
            );
        }),
    );
}
