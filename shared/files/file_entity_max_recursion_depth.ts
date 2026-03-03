/**
 * The maximum recursion depth we use for loading and rendering file entities.
 * Since file entities can recursively reference themselves we can't load all
 * referenced file entities. So we make a practical choice to stop loading after a
 * certain depth.
 *
 * This is also a performance optimization. You may have deep file entity nesting
 * even if the file's don't recursively reference each other. We need to cut off
 * loading at some point since file entity previews get so small that you can't
 * practically read them anyway.
 */
export const fileEntityMaxRecursionDepth = 3;
