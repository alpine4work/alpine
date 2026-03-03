"use strict";

const baseNoRestrictedImports = {
    paths: [
        {
            name: "assert",
            message: "Import `assert()` from `~/shared/helpers/control/assert.js`",
        },
        {
            name: "react-router",
            importNames: ["useNavigate"],
            message: "Import `useNavigate()` from `~/client/remix/use_navigate.js`",
        },
        {
            name: "react-router-dom",
            importNames: ["useNavigate"],
            message: "Import `useNavigate()` from `~/client/remix/use_navigate.js`",
        },
        {
            name: "@remix-run/react",
            importNames: ["useNavigate"],
            message: "Import `useNavigate()` from `~/client/remix/use_navigate.js`",
        },
        {
            name: "react-router",
            importNames: ["Link"],
            message: "Import `<Link>` from `~/client/design/link.js`",
        },
        {
            name: "react-router-dom",
            importNames: ["Link"],
            message: "Import `<Link>` from `~/client/design/link.js`",
        },
        {
            name: "@remix-run/react",
            importNames: ["Link"],
            message: "Import `<Link>` from `~/client/design/link.js`",
        },
        {
            name: "react-router",
            importNames: ["useRevalidator"],
            message: "Import `useRevalidator()` from `~/client/remix/use_revalidator.js`",
        },
        {
            name: "react-router-dom",
            importNames: ["useRevalidator"],
            message: "Import `useRevalidator()` from `~/client/remix/use_revalidator.js`",
        },
        {
            name: "@remix-run/react",
            importNames: ["useRevalidator"],
            message: "Import `useRevalidator()` from `~/client/remix/use_revalidator.js`",
        },
        {
            name: "react-aria",
            importNames: ["FocusRing"],
            message: "Import `<FocusRing>` from `~/client/design/focus_ring.js`",
        },
        {
            name: "@react-aria/focus",
            importNames: ["FocusRing"],
            message: "Import `<FocusRing>` from `~/client/design/focus_ring.js`",
        },
    ],
    patterns: [],
};

// All the TypeScript ESLint rules that require type checking. We have them in
// their own separate config to turn them off individually.
const typeCheckingConfigOverride = {
    files: ["**/*.{ts,tsx}"],
    parserOptions: {
        tsconfigRootDir: __dirname,
        project: ["./tsconfig.json"],
    },
    extends: ["plugin:@typescript-eslint/recommended-type-checked-only"],
    rules: {
        // We trust our developers to use `any` appropriately. So we disable eslint rules
        // surrounding `any`.
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-return": "off",

        // There are reasonable code style reasons to have an async function with no
        // awaits.
        "@typescript-eslint/require-await": "off",

        // Error is too loud. An unnecessary type assertion is a noop.
        "@typescript-eslint/no-unnecessary-type-assertion": "warn",

        // We want to warn when you're coercing a value to a string but allow booleans and
        // numbers which have reasonable string semantics. Also allow any since we trust
        // developers to use it appropriately.
        "@typescript-eslint/restrict-plus-operands": ["warn", {allowAny: true}],
        "@typescript-eslint/restrict-template-expressions": [
            "warn",
            {allowAny: true, allowBoolean: true, allowNumber: true},
        ],

        // This is catching stringification of `Id`. It's perfectly fine to stringify an
        // `Id` or any other opaque string type.
        "@typescript-eslint/no-base-to-string": "off",

        // If a function returns a promise, the developer must await it! Otherwise they may
        // miss important errors.
        "@typescript-eslint/no-floating-promises": [
            "error",
            {
                checkThenables: true,
                // We define a promise type that doesn't have to be awaited since in some cases
                // that's ok.
                allowForKnownSafePromises: ["SafeFloatingPromise", "SafeFloatingPromiseLike"],
            },
        ],

        // We may rethrow `unknown` typed errors, in Remix we throw `Response` objects, and
        // this rule also warns on `retry()` calls from `retryWithExponentialBackoff()`
        // which is incorrect. Our developers are perfectly capable of throwing values of
        // the right type.
        "@typescript-eslint/only-throw-error": "off",
        "@typescript-eslint/prefer-promise-reject-errors": "off",

        // The recommended type checking rules upgrade this to an error.
        "prefer-const": "warn",
    },
};

/** @type {import('eslint').Linter.Config} */
module.exports = {
    // The test `//admin/typescript/workspace:workspace_test` will only run ESLint's
    // type checking rules. So provide access to only the type checking config.
    [Symbol.for("cyberworlds.typeCheckingOverride")]: typeCheckingConfigOverride,

    extends: ["@remix-run/eslint-config", "@remix-run/eslint-config/node"],
    plugins: [
        "@typescript-eslint",
        "cyberworlds",
        "jest",
        "jest-dom",
        "testing-library",
        "react-compiler",
        "react-refresh",
    ],
    reportUnusedDisableDirectives: true,
    globals: {
        globalThis: true,
        "jest/globals": true,
    },
    rules: {
        // Custom eslint rules from `eslint-plugin-cyberworlds` (admin/eslint/rules):
        "cyberworlds/no-global-error": "error",
        "cyberworlds/no-global-fetch": "error",
        "cyberworlds/sort-imports-by-source": "warn",
        "cyberworlds/no-internal-imports": "error",
        "cyberworlds/no-commit-blockers": "warn",
        "cyberworlds/string-quotes": "warn",

        // TODO(calebmer): Write eslint rule that detects when you have `await`s that could
        // be parallelized with `Promise.all()`.

        // Sort imports within an import declaration alphabetically. We want to sort import
        // declarations by their module specifier.
        "sort-imports": ["warn", {ignoreDeclarationSort: true}],

        // Console is useful in development, but in production you should use our
        // observability tooling.
        "no-console": "warn",

        // Debugger statements are useful in development but should be removed before
        // production.
        "no-debugger": "warn",

        // If you want to use `alert()` then we'd appreciate a comment explaining why.
        "no-alert": "warn",

        // If you want to use `eval()` then we'd appreciate a comment explaining why.
        "no-eval": "warn",
        "no-implied-eval": "warn",
        "no-script-url": "warn",

        // If a variable is not assigned then use `const` instead of `let` for consistency.
        "prefer-const": "warn",

        // Throw an error to get a stack.
        "no-throw-literal": "error",
        "prefer-promise-reject-errors": "error",

        // Make it obvious when scanning a function call that it is an IIFE. This also
        // turns off V8 lazy function parsing which can be good for performance.
        "wrap-iife": ["warn", "inside"],

        // All files must be in strict mode. TypeScript files are considered to be modules
        // and so they are implicitly strict, but JavaScript files are considered to be
        // scripts.
        strict: ["error", "global"],

        // Empty object patterns are fine as a way of saying "ignore this".
        "no-empty-pattern": "off",

        // Blocks can be helpful for organizing code.
        "no-lone-blocks": "off",

        // Prettier wraps/unwraps operators as it sees fit.
        "no-mixed-operators": "off",

        // Has too many false positives. We often put functions in loops and variables may
        // not be referenced while working on the function. We trust our developers have a
        // solid knowledge of the JavaScript language and write tests.
        "no-loop-func": "off",

        // Warn for all unused variables. Including those that begin with an underscore.
        // Instead we use the underscore naming convention for denoting private things.
        //
        // We need this here and below in our `.ts` override rules to override the rule in
        // `plugin:@typescript-eslint/recommended`.
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": [
            "warn",
            {args: "after-used", ignoreRestSiblings: true},
        ],

        // Unused expressions are dead code, you may delete them.
        "no-unused-expressions": "off",
        "@typescript-eslint/no-unused-expressions": "warn",

        // When you first write a constructor it's useless. It's annoying to see a lint
        // warning while you're typing. A truly useless constructor doesn't really hurt
        // anyone.
        "no-useless-constructor": "off",
        "@typescript-eslint/no-useless-constructor": "off",

        // Allow re-declaring types and values. For example `type Foo` and `const Foo` in
        // the same file should be ok.
        "no-redeclare": "off",
        "@typescript-eslint/no-redeclare": "off",

        // Prefer named exports so we have consistent names for the import across files.
        "import/no-default-export": "warn",

        // Don't import files outside of the repository.
        "import/no-absolute-path": "warn",

        // Only Webpack can interpret the Webpack loader syntax, but we have many other
        // tools that need to follow the module graph.
        "import/no-webpack-loader-syntax": "warn",

        // No CommonJS or AMD imports/exports in a module file!
        "import/no-commonjs": "error",
        "import/no-amd": "error",

        // Imports are hoisted to the top of a file during evaluation, so always write them
        // at the top of the file.
        "import/first": "warn",

        // Require a line to deliniate import declarations from the code which will
        // actually be evaluated.
        "import/newline-after-import": "warn",

        // Bazel and TypeScript take care of this. Including a package in `package.json`
        // isn't enough. You need to also include it in the relevant `BUILD` file. As of
        // 2023-07-24 we need a lint that makes sure imported dependencies are in `BUILD`
        // files.
        "import/no-extraneous-dependencies": "off",

        // Restrict the use of some imports and recommend alternatives for our codebase.
        "no-restricted-imports": ["error", baseNoRestrictedImports],

        // Prefer literals directly as JSX props without wrapping in braces (e.g.
        // `<div id="foo">` not `<div id={"foo"}>`). We enable this for consistency as
        // there's absolutely no semantic difference, there's a clear preference for no
        // braces in the community, wrapping in braces may be an accidental result of a
        // refactor, and mixing the styles in one JSX element looks weird.
        "react/jsx-curly-brace-presence": ["warn", {props: "never", propElementValues: "always"}],

        // When using React, you must follow the rules of hooks. Thankfully there's a lint
        // rule (originally by [yours truly][1]) that points out when you've made a
        // mistake.
        //
        // [1]:
        //     https://github.com/facebook/react/commit/ddbfe2ed50c7a3476ceff20f5924011ac1ad6428
        "react-hooks/rules-of-hooks": "error",

        // Use the exhaustive deps lint rule on some custom hooks.
        //
        // Please use this sparingly! Prefer patterns where you pass in a `useCallback()`
        // or `useMemo()` into a custom hook like (e.g.
        // `useMyCustomHook(useCallback(() => { ... }, [...]))`) most of the time.
        "react-hooks/exhaustive-deps": [
            "warn",
            {
                additionalHooks: `^(${[
                    "useInsertionEffect",
                    "useLayoutEffectWithoutServerSideWarning",
                ].join("|")})$`,
            },
        ],
    },
    overrides: [
        {
            files: ["**/*.{ts,tsx}"],
            extends: ["plugin:@typescript-eslint/recommended"],
            rules: {
                // We trust our developers to use `any` appropriately. So we disable eslint rules
                // surrounding `any`.
                "@typescript-eslint/no-explicit-any": "off",

                // `x as T` is unsound as we perform no runtime check that `x` is actually `T`. You
                // can use it but provide a comment explaining why.
                "@typescript-eslint/consistent-type-assertions": ["warn", {assertionStyle: "as"}],

                // Warn for all unused variables. Including those that begin with an underscore.
                // Instead we use the underscore naming convention for denoting private things.
                //
                // We need this here and above in our main rules to override the rule in
                // `plugin:@typescript-eslint/recommended`.
                "no-unused-vars": "off",
                "@typescript-eslint/no-unused-vars": [
                    "warn",
                    {args: "after-used", ignoreRestSiblings: true},
                ],

                // Consistent use of generics when writing array types. This also makes it much
                // easier to see if a type is wrapped in array since the other array syntax is
                // postfix.
                "@typescript-eslint/array-type": ["warn", {default: "generic"}],

                // `void` is kind of like `unknown` for convenience in function return types.
                // However, if you want to use `void` in a type then what you actually want is
                // probably `undefined`.
                //
                // NOTE(calebmer): This lint rule gets many valid uses of `void` wrong so turning
                // it off.
                "@typescript-eslint/no-invalid-void-type": "off",

                // Use `// @ts-expect-error` instead of `// @ts-ignore` since the former will error
                // if there is no error on the line underneath.
                "@typescript-eslint/prefer-ts-expect-error": "error",

                // Trust developers to use TypeScript comments like `// @ts-expect-error` and
                // `// @ts-ignore` appropriately. Developers should also know to add descriptions
                // with their comment.
                "@typescript-eslint/ban-ts-comment": "off",

                // Sometimes code is more readable when functions come before classes or enums or
                // values they depend on.
                "@typescript-eslint/no-use-before-define": "off",

                // `this` aliasing is useful when working with immutable classes.
                "@typescript-eslint/no-this-alias": "off",

                // Namespaces can be a useful feature in certain cases. Don't disallow them. ES
                // Modules are the clear default in our codebase, let developers reach for advanced
                // tools as they need them.
                "@typescript-eslint/no-namespace": "off",

                // Ban `Function`, `Object`, `Number`, `Symbol`, etc. which as a developer you
                // should basically never use.
                "@typescript-eslint/no-unsafe-function-type": "error",
                "@typescript-eslint/no-wrapper-object-types": "error",

                // `{}` isn't hurting anybody. Yes it's a slightly confusing type but it's misuse
                // causes zero damage. See this comment from the TypeScript team:
                // https://github.com/typescript-eslint/typescript-eslint/issues/8700#issuecomment-2002627702
                "@typescript-eslint/no-empty-object-type": "off",

                // Inconvenient to annotate every type import with `import type`.
                "@typescript-eslint/consistent-type-imports": "off",

                // Error on `react-compiler` violations. This typically means we're breaking some
                // React rule.
                "react-compiler/react-compiler": "error",

                // To improve our developer experience, make sure React files only export React
                // components and constants. This way our hot reload implementation won't need to
                // trigger a full page reload since some unrelated function or object changed.
                //
                // As a workaround you can export functions and objects as properties of your React
                // component. For example `MyComponent.myFunction = myFunction`.
                "react-refresh/only-export-components": [
                    "warn",
                    {
                        allowConstantExport: true,
                    },
                ],
            },
        },
        // Check a global variable to let our ESLint test script disable lint rules that
        // require TypeScript type checking.
        ...(!globalThis.__eslintDisableTypeChecking ? [typeCheckingConfigOverride] : []),
        {
            files: ["!**/*.{ts,tsx}"],
            // Assume plain JS files are scripts and not modules.
            parserOptions: {sourceType: "script"},

            rules: {
                // `require()` is ok in a JS file.
                "@typescript-eslint/no-var-requires": "off",
                "import/no-commonjs": "off",

                // Can't import our TypeScript helpers from a JS file.
                "cyberworlds/no-global-error": "off",
            },
        },
        // Rules for all Jest test and helper files. Excludes Playwright test files or test
        // files that are shared between Jest and Playwright.
        {
            files: ["**/*.test.*", "**/test/**", "**/tests/**", "**/test_helpers/**"],
            excludedFiles: ["**/integration_tests/**", "**/test_helpers/shared/**"],
            extends: [
                "plugin:jest/recommended",
                "plugin:jest-dom/recommended",
                "plugin:testing-library/react",
            ],
            rules: {
                // Avoid the describe/it style which creates a lot of indentation and is a little
                // too prescriptive when it comes to test names.
                "jest/consistent-test-it": ["warn", {fn: "test"}],

                // It doesn't make sense to return from a test.
                "jest/no-test-return-statement": "warn",

                // A todo test is much more semantically meaningful then a test with an empty body.
                "jest/prefer-todo": "warn",

                // Make sure the test title isn't weird.
                "jest/valid-title": "warn",

                // A test doesn't need an `expect()` assertion to fail.
                "jest/expect-expect": "off",
                "jest/no-conditional-expect": "off",

                // Files in `/test/` folders can and should export things.
                "jest/no-export": "off",

                // Plenty of valid cases to call `expect()` outside of a test function. For
                // example, calling `expect()` in a helper function. Or sometimes Jest won't be
                // able to detect we're in a test block (if we're dynamically deciding between
                // `test.only` and `test` for instance). Trust developers to do the right thing.
                "jest/no-standalone-expect": "off",
            },
        },
        // Rules for just Jest test files, not helper files.
        {
            files: ["**/*.test.*"],
            excludedFiles: ["**/integration_tests/**", "**/test_helpers/shared/**"],
            extends: [],
            rules: {
                // It's fine to use `fetch()` in unit tests. We don't care about tracing in unit
                // tests.
                "cyberworlds/no-global-fetch": "off",

                // You should not export anything from test files.
                "jest/no-export": "error",
            },
        },
        // Rules for Playwright test files.
        {
            files: ["**/integration_tests/**"],
            extends: ["plugin:playwright/playwright-test"],
            rules: {
                // Conditionals are fine. Sometimes mobile needs to do something different than
                // desktop.
                "playwright/no-conditional-in-test": "off",
            },
        },
        {
            files: ["**/types/**/*"],
            rules: {
                // Only TypeScript types may go in `shared/types`. We have this restriction to
                // force any code in that directory to not contribute to bundle size.
                "cyberworlds/only-erasable-types": "error",
            },
        },
        {
            files: ["**/types/**/*.test.*"],
            rules: {
                // Tests in `types` directories may have executable code.
                "cyberworlds/only-erasable-types": "off",
            },
        },
        {
            files: ["app/**/*", "server/rpc/*_rpc_implementations.ts"],
            rules: {
                // Remix uses default exports in the `./app` directory to figure out what to
                // render.
                //
                // Our RPC implementations system also exports an RPC implementation object from
                // the default export.
                "import/no-default-export": "off",
            },
        },
        {
            files: ["app/routes/**/*", "app/root.*"],
            rules: {
                // To improve our developer experience, make sure React files only export React
                // components and constants. This way our hot reload implementation won't need to
                // trigger a full page reload since some unrelated function or object changed.
                //
                // As a workaround you can export functions and objects as properties of your React
                // component. For example `MyComponent.myFunction = myFunction`.
                "react-refresh/only-export-components": [
                    "warn",
                    {
                        allowConstantExport: true,

                        // Remix handles hot-reloading route files. Don't warn if Remix exports are
                        // exported.
                        allowExportNames: [
                            "meta",
                            "links",
                            "headers",
                            "loader",
                            "action",
                            "shouldRevalidate",
                        ],
                    },
                ],
            },
        },
        {
            files: ["client/web/styles/internal/**/*"],
            rules: {
                "no-restricted-imports": [
                    "error",
                    {
                        ...baseNoRestrictedImports,
                        paths: [
                            ...baseNoRestrictedImports.paths,
                            {
                                name: "~/client/web/styles/internal/styles.js",
                                message: "Can\u2019t import style bundle from `.css.ts` file",
                            },
                            {
                                name: "~/client/web/styles/styles.js",
                                message: "Can\u2019t import style bundle from `.css.ts` file",
                            },
                        ],
                    },
                ],
            },
        },
        {
            files: ["client/web/styles/**/*.css.ts"],
            rules: {
                // `.css.ts` files need to use quotes in strings a lot for CSS selectors and we
                // don't really create UI strings in CSS files.
                "cyberworlds/string-quotes": "off",
            },
        },
    ],
};
