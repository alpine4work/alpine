/**
 * Commit blocker string. If an instance of this string exists in the codebase,
 * we'll fail with an ESLint warning (see the `no-commit-blocker` rule). It's
 * useful to use this type when you have a flag a developer may temporarily set but
 * should never commit.
 *
 * For example, we use this in test suites with the property `only?: CommitBlocker`
 * if `only` is non-null we only run that one test. By forcing the developer to
 * type the commit blocker string they'll be forced to cleanup the `only` property
 * when they're done testing.
 *
 * This string is constructed by concatenating the string's parts so a developer
 * can search the codebase for this string and only find instances they added.
 */
export type CommitBlocker = `${"NO"}${"COMMIT"}`;
