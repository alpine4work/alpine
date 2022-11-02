"""
Helper function for getting a glob of TypeScript files.
"""

def ts_glob(include):
    """
    `glob()` but with all the supported TypeScript file extensions.

    Also excludes test files.

    Args:
        include: Globs paths to include. Don't add a file extension, file
        extensions will be added by the macro.

    Returns:
        A list of files matching the glob.
    """

    actual_include = []
    actual_exclude = []

    for path in include:
        actual_include.append("{}.js".format(path))
        actual_include.append("{}.jsx".format(path))
        actual_include.append("{}.ts".format(path))
        actual_include.append("{}.tsx".format(path))
        actual_include.append("{}.mjs".format(path))

        actual_exclude.append("{}.test.js".format(path))
        actual_exclude.append("{}.test.jsx".format(path))
        actual_exclude.append("{}.test.ts".format(path))
        actual_exclude.append("{}.test.tsx".format(path))
        actual_exclude.append("{}.test.mjs".format(path))

    return native.glob(actual_include, exclude = actual_exclude)
