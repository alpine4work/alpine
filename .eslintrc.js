"use strict";

module.exports = {
    extends: ["react-app", "next/core-web-vitals"],
    plugins: ["@typescript-eslint", "jest", "jest-dom", "testing-library"],
    reportUnusedDisableDirectives: true,
    rules: {
        // Custom eslint rules from `admin/eslint/rules`:
        //
        // TODO(calebmer): Consider putting these in a plugin instead of a custom
        // rules directory to simplify things.
        "sort-imports-by-source": "warn",

        // Sort imports within an import declaration alphabetically. We want to sort
        // import declarations by their module specifier.
        "sort-imports": ["warn", {ignoreDeclarationSort: true}],

        // Console is useful in development, but in production you should use our
        // observability tooling.
        "no-console": "warn",

        // Debugger statements are useful in development but should be removed
        // before production.
        "no-debugger": "warn",

        // If you want to use `alert()` then we'd appreciate a comment
        // explaining why.
        "no-alert": "warn",

        // If you want to use `eval()` then we'd appreciate a comment
        // explaining why.
        "no-eval": "warn",
        "no-implied-eval": "warn",
        "no-script-url": "warn",

        // Throw an error to get a stack.
        "no-throw-literal": "error",
        "prefer-promise-reject-errors": "error",

        // Make it obvious when scanning a function call that it is an IIFE. This
        // also turns off V8 lazy function parsing which can be good for
        // performance.
        "wrap-iife": ["warn", "inside"],

        // All files must be in strict mode. TypeScript files are considered to be
        // modules and so they are implicitly strict, but JavaScript files are
        // considered to be scripts.
        strict: ["error", "global"],

        // Empty object patterns are fine as a way of saying "ignore this".
        "no-empty-pattern": "off",

        // Blocks can be helpful for organizing code.
        "no-lone-blocks": "off",

        // Allow re-declaring types and values. For example `type Foo` and
        // `const Foo` in the same file should be ok.
        "no-redeclare": "off",
        "@typescript-eslint/no-redeclare": "off",

        // Warn for all unused variables. Including those that begin with an
        // underscore. Instead use the underscore naming convention for denoting
        // private things.
        "@typescript-eslint/no-unused-vars": "warn",

        // Consistent use of generics when writing array types. This also makes it
        // much easier to see if a type is wrapped in array since the other array
        // syntax is postfix.
        "@typescript-eslint/array-type": ["warn", {default: "generic"}],

        // `x as T` is unsound as we perform no runtime check that `x` is actually
        // `T`. You can use it but provide a comment explaining why.
        "@typescript-eslint/consistent-type-assertions": ["warn", {assertionStyle: "as"}],

        // `void` is kind of like `unknown` for convenience in function return
        // types. However, if you want to use `void` in a type then what you
        // actually want is probably `undefined`.
        "@typescript-eslint/no-invalid-void-type": "warn",

        // Use `// @ts-expect-error` instead of `// @ts-ignore` since the former
        // will error if there is no error on the line underneath.
        "@typescript-eslint/prefer-ts-expect-error": "error",

        // Sometimes code is more readable when functions come before classes or
        // enums or values they depend on.
        "@typescript-eslint/no-use-before-define": "off",

        // Remove `{}` and `object` from the ban types rule. The default lint rule
        // is too picky.
        //
        // Default can be found at:
        // https://github.com/typescript-eslint/typescript-eslint/blob/v3.0.2/packages/eslint-plugin/docs/rules/ban-types.md
        "@typescript-eslint/ban-types": [
            "error",
            {
                extendDefaults: false,
                types: {
                    String: {
                        message: "Use string instead",
                        fixWith: "string",
                    },
                    Boolean: {
                        message: "Use boolean instead",
                        fixWith: "boolean",
                    },
                    Number: {
                        message: "Use number instead",
                        fixWith: "number",
                    },
                    Symbol: {
                        message: "Use symbol instead",
                        fixWith: "symbol",
                    },
                    Object: {
                        message: "Use object instead",
                        fixWith: "object",
                    },
                    Function: {
                        message:
                            "The `Function` type accepts any function-like value. " +
                            "It provides no type safety when calling the function, which can be a common source of bugs. " +
                            "It also accepts things like class declarations, which will throw at runtime as they will not be called with `new`. " +
                            "If you are expecting the function to accept certain arguments, you should explicitly define the function shape.",
                    },
                },
            },
        ],

        // This is a pretty important lint rule. It defines the module boundaries of
        // our system. We treat top level directories as different execution
        // environments. We don't want code in `client` to be evaluated in
        // `server` for instance since `client` code might depend on the DOM and
        // vice-versa. The Next.js `pages` directory is where we bring `client`
        // and `server` code together to render pages.
        "import/no-restricted-paths": [
            "error",
            {
                zones: [
                    {
                        target: "./shared",
                        from: "./",
                        except: ["./node_modules", "./shared"],
                    },
                    {
                        target: "./client",
                        from: "./",
                        except: ["./node_modules", "./client", "./shared"],
                    },
                    {
                        target: "./server",
                        from: "./",
                        except: ["./node_modules", "./server", "./shared"],
                    },
                    {
                        target: "./pages",
                        from: "./",
                        // NOTE: `./pages` is not configured to import from itself. The
                        // design here is only Next.js should import pages since adding
                        // files to the pages directory may influence routing.
                        except: ["./node_modules", "./shared", "./client", "./server"],
                    },
                    {
                        target: "./integration",
                        from: "./",
                        except: ["./node_modules", "./integration", "./shared"],
                    },
                ],
            },
        ],

        // Prefer named exports so we have consistent names for the import
        // across files.
        "import/no-default-export": "warn",

        // Always add an extension to your import if you aren't importing a
        // JavaScript file.
        "import/extensions": [
            "warn",
            "always",
            {js: "never", jsx: "never", ts: "never", tsx: "never"},
        ],

        // Don't allow importing packages that aren't explicitly declared in our
        // `package.json`. While technically possible to import a transitive
        // dependency at runtime, we don't want to implicitly depend on this
        // behavior since we don't control the versions of those transitive
        // dependencies.
        "import/no-extraneous-dependencies": "error",

        // Don't import files outside of the repository.
        "import/no-absolute-path": "warn",

        // Only Webpack can interpret the Webpack loader syntax, but we have many
        // other tools that need to follow the module graph.
        "import/no-webpack-loader-syntax": "warn",

        // No CommonJS or AMD imports/exports in a module file!
        "import/no-commonjs": "error",
        "import/no-amd": "error",

        // Imports are hoisted to the top of a file during evaluation, so always
        // write them at the top of the file.
        "import/first": "warn",

        // Require a line to deliniate import declarations from the code which will
        // actually be evaluated.
        "import/newline-after-import": "warn",

        // Conflicts with the Next.js `<Link><a>...</a></Link>` component style.
        // Could we have a better eslint rule or a custom link component and
        // re-enable this?
        "jsx-a11y/anchor-is-valid": "off",

        // Use the exhaustive deps lint rule on some custom hooks.
        //
        // Please use this sparingly! Prefer patterns where you pass in a
        // `useCallback()` or `useMemo()` into a custom hook like
        // (e.g. `useMyCustomHook(useCallback(() => { ... }, [...]))`) most of the
        // time.
        "react-hooks/exhaustive-deps": [
            "warn",
            {
                additionalHooks: "^useLayoutEffectWithoutServerSideWarning$",
            },
        ],
    },
    overrides: [
        {
            files: ["!**/*.{ts,tsx}"],
            // Assume plain JS files are scripts and not modules.
            parserOptions: {sourceType: "script"},

            rules: {
                // `require()` is ok in a JS file.
                "@typescript-eslint/no-var-requires": "off",
                "import/no-commonjs": "off",
            },
        },
        {
            files: ["**/*.test.*"],
            extends: [
                "plugin:jest/recommended",
                "plugin:jest-dom/recommended",
                "plugin:testing-library/react",
            ],
            rules: {
                // Avoid the describe/it style which creates a lot of indentation and is
                // a little too prescriptive when it comes to test names.
                "jest/consistent-test-it": ["warn", {fn: "test"}],

                // It doesn't make sense to return from a test.
                "jest/no-test-return-statement": "warn",

                // A todo test is much more semantically meaningful then a test with an
                // empty body.
                "jest/prefer-todo": "warn",

                // Make sure the test title isn't weird.
                "jest/valid-title": "warn",

                // A test doesn't need an `expect()` assertion to fail.
                "jest/expect-expect": "off",
                "jest/no-conditional-expect": "off",
            },
        },
        {
            files: ["**/types/**/*"],
            rules: {
                // Only TypeScript types may go in `shared/types`. We have this restriction to
                // force any code in that directory to not contribute to bundle size.
                //
                // This is a custom eslint rules from `admin/eslint/rules`.
                "only-erasable-types": "error",
            },
        },
        {
            files: ["pages/**/*.page.*"],
            rules: {
                // Next.js uses default exports in the `./pages` directory to figure out
                // what to render.
                "import/no-default-export": "off",
            },
        },
    ],
};
