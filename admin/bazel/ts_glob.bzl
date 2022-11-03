"""
Helper function for getting a glob of TypeScript files.
"""

def ts_glob(include, exclude = []):
    """
    `glob()` but with all the supported TypeScript file extensions.

    Also excludes test files.

    Args:
        include: Globs paths to include. Don't add a file extension, file
        extensions will be added by the macro.
        exclude: Glob paths to exclude. This list will not be modified,
        include file extensions.

    Returns:
        A list of files matching the glob.
    """

    actual_include = []
    actual_exclude = [path for path in exclude]

    for path in include:
        actual_include.append("{}.ts".format(path))
        actual_include.append("{}.tsx".format(path))

        actual_exclude.append("{}.test.ts".format(path))
        actual_exclude.append("{}.test.tsx".format(path))

    return native.glob(actual_include, exclude = actual_exclude)
