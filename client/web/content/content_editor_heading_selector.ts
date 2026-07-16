import {
    headingLevel1ClassName,
    headingLevel2ClassName,
    headingLevel3ClassName,
} from "~/shared/design/core/constant_class_names.js";

/**
 * DOM selector matching the heading elements rendered by the content schema's
 * heading node, at any level. With the heading node view
 * (`createContentEditorHeadingNodeViewConstructor()`) the heading element is also
 * the node view's outermost DOM node.
 */
export const contentEditorHeadingSelector = `.${headingLevel1ClassName}, .${headingLevel2ClassName}, .${headingLevel3ClassName}`;
