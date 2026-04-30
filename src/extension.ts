import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

const exec = promisify(child_process.exec);

/**
 * Runs `git clone` for a single branch and reports the "Receiving objects" percentage
 * via callback as git emits it to stderr. Uses spawn so output streams incrementally.
 *
 * @param branch - The branch name to clone
 * @param repoUrl - The remote repository URL
 * @param branchDir - The local destination directory
 * @param onProgress - Invoked with the current received-objects percentage (0–100)
 */
function cloneWithProgress(
    branch: string,
    repoUrl: string,
    branchDir: string,
    onProgress: (receivedPercent: number) => void
): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = child_process.spawn('git', [
            'clone',
            '--branch', branch,
            '--single-branch',
            '--progress',
            repoUrl,
            branchDir,
        ]);

        let stderr = '';

        proc.stderr.on('data', (chunk: Buffer) => {
            const text = chunk.toString();

            stderr += text;

            // git uses \r to rewrite the current line in-place; scan every segment
            for (const segment of text.split(/[\r\n]/)) {
                const match = segment.match(/Receiving objects:\s+(\d+)%/);

                if (match) {
                    onProgress(parseInt(match[1], 10));
                }
            }
        });

        proc.on('close', (code: number | null) => {
            if (code === 0) {
                resolve();
            }

            else {
                const lastLine = stderr.split(/[\r\n]/).map((l: string) => l.trim()).filter(Boolean).pop() ?? 'unknown error';

                reject(new Error(lastLine));
            }
        });

        proc.on('error', reject);
    });
}

/**
 * A QuickPickItem that carries the clone URL for the selected repo.
 */
interface RepoItem extends vscode.QuickPickItem {
    cloneUrl: string;
}

/**
 * Performs a paginated GET request to the GitHub REST API and returns all results.
 *
 * @param path - The API path, e.g. `/user/repos`
 * @param token - A GitHub OAuth access token
 * @param params - Additional query string parameters
 */
async function githubGet(apiPath: string, token: string, params: Record<string, string> = {}): Promise<unknown[]> {
    const results: unknown[] = [];
    let page = 1;

    const headers = {
        'Authorization': `Bearer ${ token }`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'SuperClone-VSCode',
        'X-GitHub-Api-Version': '2022-11-28',
    };

    while (true) {
        const query = new URLSearchParams({ ...params, per_page: '100', page: String(page) }).toString();

        const batch = await new Promise<unknown[]>((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: `${ apiPath }?${ query }`,
                headers,
            };

            https.get(options, (res) => {
                let body = '';

                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });

                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body) as unknown[]);
                    }

                    catch {
                        reject(new Error(`GitHub API parse error on ${ apiPath }`));
                    }
                });
            }).on('error', reject);
        });

        results.push(...batch);

        if (batch.length < 100) {
            break;
        }

        page++;
    }

    return results;
}

/**
 * Fetches all GitHub repositories accessible to the authenticated user and maps
 * them to QuickPickItems ready for display.
 *
 * @param token - A GitHub OAuth access token with `repo` scope
 */
async function fetchRepoItems(token: string): Promise<RepoItem[]> {
    const repos = await githubGet('/user/repos', token, {
        sort: 'updated',
        affiliation: 'owner,collaborator,organization_member',
    }) as Array<Record<string, unknown>>;

    return repos.map((repo) => {
        const isPrivate = repo.private as boolean;
        const language = repo.language as string | null;
        const description = repo.description as string | null;
        const updatedAt = new Date(repo.updated_at as string);

        const details = [
            isPrivate ? '$(lock) Private' : '$(globe) Public',
            language ? `$(code) ${ language }` : null,
            `Updated ${ updatedAt.toLocaleDateString() }`,
        ].filter(Boolean).join('   ');

        return {
            label: `$(repo) ${ repo.full_name as string }`,
            description: description ?? '',
            detail: details,
            cloneUrl: repo.clone_url as string,
        };
    });
}

/**
 * Shows an interactive picker that loads the user's GitHub repos and lets them
 * search by name, or fall back to pasting a raw URL.
 */
async function pickRepository(): Promise<string | undefined> {
    const qp = vscode.window.createQuickPick<RepoItem>();

    qp.placeholder = 'Search your GitHub repos or paste a repository URL';
    qp.matchOnDescription = true;
    qp.busy = true;
    qp.show();

    try {
        const session = await vscode.authentication.getSession('github', [ 'repo' ], { createIfNone: true });
        const items = await fetchRepoItems(session.accessToken);

        qp.items = items;
    }

    catch {
        // auth was declined or failed — user can still type a URL manually
    }

    qp.busy = false;

    return new Promise((resolve) => {
        qp.onDidAccept(() => {
            const selected = qp.selectedItems[0];

            resolve(selected ? selected.cloneUrl : qp.value.trim() || undefined);
            qp.hide();
        });

        qp.onDidHide(() => {
            resolve(undefined);
            qp.dispose();
        });
    });
}

/**
 * Activates the SuperClone extension and registers the superClone command.
 *
 * @param context - The VS Code extension context used for subscription cleanup
 */
export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('superclone.superClone', async () => {
        const repoUrl = await pickRepository();

        if (!repoUrl) {
            return;
        }

        const destUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Destination',
            title: 'Select where to clone the repository',
        });

        if (!destUri || destUri.length === 0) {
            return;
        }

        const destBase = destUri[0].fsPath;
        const repoName = path.basename(repoUrl.replace(/\.git$/, '').replace(/\/$/, ''));
        const repoRoot = path.join(destBase, repoName);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Super Clone: ${ repoName }`,
            cancellable: false,
        }, async (progress) => {
            progress.report({ message: 'Fetching branch list...' });

            let branches: string[];

            try {
                const { stdout } = await exec(`git ls-remote --heads "${ repoUrl }"`);

                branches = stdout
                    .split('\n')
                    .filter((line: string) => line.trim())
                    .map((line: string) => {
                        const match = line.match(/refs\/heads\/(.+)$/);

                        return match ? match[1].trim() : null;
                    })
                    .filter((b: string | null): b is string => Boolean(b));
            }

            catch (e: any) {
                vscode.window.showErrorMessage(`Super Clone: Failed to fetch branches — ${ e.message }`);

                return;
            }

            if (branches.length === 0) {
                vscode.window.showErrorMessage('Super Clone: No branches found in the repository.');

                return;
            }

            fs.mkdirSync(repoRoot, { recursive: true });

            const clonedFolders: string[] = [];

            const branchBudget = (1 / branches.length) * 90;

            for (let i = 0; i < branches.length; i++) {
                const branch = branches[i];
                // branch names with slashes become nested directories; flatten to avoid that
                const safeName = branch.replace(/\//g, '__');
                const branchDir = path.join(repoRoot, safeName);

                const message = `Cloning branch ${ i + 1 }/${ branches.length }: ${ branch }`;

                progress.report({ message });

                let lastPercent = 0;

                try {
                    await cloneWithProgress(branch, repoUrl, branchDir, (pct) => {
                        progress.report({ message, increment: ((pct - lastPercent) / 100) * branchBudget });
                        lastPercent = pct;
                    });

                    clonedFolders.push(safeName);
                }

                catch (e: any) {
                    vscode.window.showWarningMessage(`Super Clone: Skipped branch "${ branch }" — ${ e.message }`);
                }

                // consume any remaining budget for this branch (git may not always reach 100%)
                progress.report({ message, increment: ((100 - lastPercent) / 100) * branchBudget });
            }

            if (clonedFolders.length === 0) {
                vscode.window.showErrorMessage('Super Clone: No branches were cloned successfully.');

                return;
            }

            progress.report({ message: 'Creating workspace file...', increment: 5 });

            const workspaceData = {
                folders: clonedFolders.map(name => ({ path: name })),
                settings: {},
            };

            const workspaceFile = path.join(repoRoot, `${ repoName }.code-workspace`);

            fs.writeFileSync(workspaceFile, JSON.stringify(workspaceData, null, 2) + '\n');

            progress.report({ message: 'Opening workspace...', increment: 5 });

            await vscode.commands.executeCommand(
                'vscode.openFolder',
                vscode.Uri.file(workspaceFile)
            );
        });
    });

    context.subscriptions.push(disposable);
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate() {}
