import {registerClassName} from "@vanilla-extract/css/adapter";
import {endFileScope, getFileScope, setFileScope} from "@vanilla-extract/css/fileScope";
import * as constantClassNames from "~/shared/design/core/constant_class_names.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";

// Register all of our shared content class names with `@vanilla-extract/css` so
// that we can use them in CSS selectors without needing to add a `.`. For example,
// `${paragraphClassName} &` should work whereas without registering class names
// you'd need to write `.${paragraphClassName} &` (notice the `.` in the second
// example).
setFileScope("shared/design/core/constant_class_names.js");
for (const className of filterIterable(
    concatIterables(
        Object.values(omitObject(constantClassNames, ["highlightClassNameByColor"])),
        Object.values(constantClassNames.highlightClassNameByColor),
    ),
    isIdentifier,
)) {
    registerClassName(className, getFileScope());
}
endFileScope();
