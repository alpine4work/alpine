/**
 * Is `NODE_ENV` `test` or are we running as part of the `//admin/scenarios`
 * script? Our test helpers like `TestSpace`, `TestDocument`, `TestTask`, etc.
 * are typically gated behind this flag. These helpers can only be used in
 * tests or to set up specific scenarios in dev.
 */
export const isTestNodeEnvOrAdminScenariosScript =
    process.env.NODE_ENV === "test" ||
    (process.env.NODE_ENV === "development" &&
        typeof process !== "undefined" &&
        process.release.name === "node" &&
        process.env.ADMIN_SCRIPT === "scenarios");
