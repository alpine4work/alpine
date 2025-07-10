import * as path from "path";
import * as vscode from "vscode";

export async function findBazelTestTargetForVscode(uri: vscode.Uri): Promise<string | null> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) return null;

    const relativePath = vscode.workspace.asRelativePath(uri);
    const dir = path.dirname(relativePath);

    // Get the filename without extension
    const fileName = path.basename(uri.fsPath);

    // Check if this is a test file
    if (!/\.(test)\.(ts|js|tsx|jsx)$/.test(fileName)) {
        return null;
    }

    // Look for BUILD file in the current directory and parent directories
    let buildFileDir = dir;

    while (buildFileDir) {
        const buildFilePath = vscode.Uri.joinPath(workspaceFolder.uri, buildFileDir, "BUILD");

        try {
            await vscode.workspace.fs.stat(buildFilePath);
            break;
        } catch {
            // Continue searching in parent directory
            const parentDir = path.dirname(buildFileDir);
            if (parentDir === buildFileDir || parentDir === ".") {
                break;
            }
            buildFileDir = parentDir;
        }
    }

    if (!buildFileDir) {
        return null;
    }

    // // Calculate the package path (where the BUILD file is located)
    // const packagePath = path.dirname(path.relative(workspaceFolder.uri.fsPath, buildFile.fsPath));

    // // Calculate the relative path from the BUILD file directory to the test file
    // const buildFileDir = path.dirname(buildFile.fsPath);
    const buildFileDirAbsolutePath = vscode.Uri.joinPath(workspaceFolder.uri, buildFileDir).fsPath;
    const relativeFromBuildFile = path.relative(buildFileDirAbsolutePath, uri.fsPath);

    // Convert the test file path to the target name
    // e.g., "internal/content_file_task_collection_entity_preview.test.ts"
    // becomes "internal/content_file_task_collection_entity_preview_test"
    const targetName = relativeFromBuildFile
        .replace(/\.(test|spec)\.(ts|js|tsx|jsx)$/, "_test")
        .replace(/\\/g, "/"); // Normalize path separators

    return `//${buildFileDir}:${targetName}`;
}
