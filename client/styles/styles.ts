import * as stylesCore from "~/client/styles/core/styles_core.js";
import * as stylesOther from "~/client/styles/other/styles_other.js";
import {stringifyForDeepEqualCheck} from "~/shared/helpers/control/stringify_for_deep_equal_check.js";

export * from "~/client/styles/core/styles_core.js";
export * from "~/client/styles/other/styles_other.js";

if (import.meta.hot) {
    import.meta.hot.accept(({sprinkles: newSprinkles, ...newModule}: any) => {
        const {sprinkles: oldSprinkles, ...oldModule} = {...stylesCore, ...stylesOther};

        // If the module has changed then we can't hot reload and will instead need a
        // full page reload.
        //
        // We use `stringifyForDeepEqualCheck()` to test for equality since it'll throw
        // an error if we receive a value that can't be stringified (e.g. functions).
        if (stringifyForDeepEqualCheck(newModule) !== stringifyForDeepEqualCheck(oldModule)) {
            import.meta.hot!.invalidate();
            return;
        }

        // We don't check if the `sprinkles()` function has changed because we don't
        // have a way to check function equality across modules. However, we export a
        // `sprinklesHash` string from `sprinkles.css.ts` which will update if the
        // `sprinkles()` function changes causing our module to invalidate and reload.
    });
}
