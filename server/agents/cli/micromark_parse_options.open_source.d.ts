import "micromark-util-types";

declare module "micromark-util-types" {
    /** Alpine's public source accepts these optional Markdown recovery controls. */
    interface ParseOptions {
        allowUndefinedLinkReferenceIdentifiers?: boolean;
        allowAttentionWithoutClose?: boolean;
        allowCodeTextWithoutClose?: boolean;
        allowLabelWithoutClose?: boolean;
        allowResourceWithoutClose?: boolean;
    }
}
