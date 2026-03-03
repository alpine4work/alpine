import {Lint, LintOptions, Linter, LocalLinter, WorkerLinter, binary} from "harper.js";
import {spellCheckRuleFilter} from "~/client/web/content/internal/spell_check_rule_filter/spell_check_rule_filter.js";

let cachedLinter: Linter | null = null;

// TODO(#spell-check): Is this performant or stateful? Should we initialize one per
// `<ContentEditor>`?

async function getLinter(): Promise<Linter | null> {
    if (cachedLinter === null && typeof window !== "undefined") {
        cachedLinter =
            process.env.NODE_ENV === "test"
                ? new LocalLinter({binary})
                : new WorkerLinter({binary});

        // https://writewithharper.com/docs/rules
        await cachedLinter.setLintConfig({
            ExpandMinimum: false,
            ExpandTimeShorthands: false,
            CondenseAllThe: false,
            RoadMap: false,
            Excellent: false,
            PronounKnew: false,
            AvoidCurses: false,
            LongSentences: false,
        });
    }

    return cachedLinter;
}

export async function spellCheckLint(text: string, options?: LintOptions): Promise<Array<Lint>> {
    const linter = await getLinter();
    if (!linter) return [];

    const lints = await linter.lint(text, options);

    // Harper doesn't support custom lint rules out of the box, so we have to manually
    // filter our lints after running the linter. Someday we should consider
    // contributing this feature back to Harper.
    return lints.filter(lint =>
        spellCheckRuleFilter({
            text: lint.get_problem_text(),
            breakingRuleKind: lint.lint_kind().toLowerCase(),
            suggestions: lint.suggestions().map(s => ({
                kind: (["replace", "remove", "insertafter"][s.kind()] || "replace") as
                    | "replace"
                    | "remove"
                    | "insertafter",
                text: s.get_replacement_text(),
            })),
        }),
    );
}
