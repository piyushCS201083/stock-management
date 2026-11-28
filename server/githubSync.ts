export interface GitHubSyncConfigStatus {
  configured: boolean;
  repo?: string;
  branch: string;
}

export interface GitHubCommitResult {
  configured: boolean;
  synced: boolean;
  repo?: string;
  branch: string;
  commitSha?: string;
  commitUrl?: string;
  message: string;
}

function cleanEnv(raw?: string): string {
  if (!raw) return '';
  return raw.replace(/[\r\n\u200B-\u200D\uFEFF]+/g, '').trim().replace(/^["'`]|["'`]$/g, '').trim();
}

export function getGitHubSyncConfig(): {
  configured: boolean;
  token: string;
  repo: string;
  branch: string;
} {
  const token = cleanEnv(process.env.GITHUB_TOKEN);
  const rawRepo = cleanEnv(process.env.GITHUB_REPO);
  const rawBranch = cleanEnv(process.env.GITHUB_BRANCH) || 'main';

  const validRepo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(rawRepo) ? rawRepo : '';
  const validBranch = /^[A-Za-z0-9_.\-/]+$/.test(rawBranch) && !rawBranch.includes('..') ? rawBranch : 'main';

  const configured = Boolean(token && validRepo);
  return {
    configured,
    token: configured ? token : '',
    repo: validRepo,
    branch: validBranch,
  };
}

export function getGitHubSyncStatus(): GitHubSyncConfigStatus {
  const cfg = getGitHubSyncConfig();
  return {
    configured: cfg.configured,
    repo: cfg.repo || undefined,
    branch: cfg.branch,
  };
}

export async function commitHashedCredentialsToGitHub(
  fileRelativePath: string,
  contentUtf8: string,
  commitMessage: string
): Promise<GitHubCommitResult> {
  const cfg = getGitHubSyncConfig();
  if (!cfg.configured) {
    return {
      configured: false,
      synced: false,
      repo: cfg.repo || undefined,
      branch: cfg.branch,
      message:
        'Updated live in database & local codebase file (set GITHUB_TOKEN and GITHUB_REPO in server Secrets to auto-push commits to GitHub).',
    };
  }

  const safePath = fileRelativePath.replace(/^\/+/, '');
  if (!safePath || safePath.includes('..') || !/^[A-Za-z0-9_.\-/]+$/.test(safePath)) {
    return {
      configured: true,
      synced: false,
      repo: cfg.repo,
      branch: cfg.branch,
      message: 'Invalid repository file path for GitHub sync.',
    };
  }

  const [owner, repo] = cfg.repo.split('/');
  const encodedPath = safePath.split('/').map(encodeURIComponent).join('/');
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'stock-management-password-manager',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  try {
    let existingSha: string | undefined;
    const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(cfg.branch)}`, {
      method: 'GET',
      headers,
    });
    if (getRes.ok) {
      const existingJson: any = await getRes.json();
      if (typeof existingJson?.sha === 'string') {
        existingSha = existingJson.sha;
      }
    } else if (getRes.status !== 404) {
      const errText = await getRes.text();
      return {
        configured: true,
        synced: false,
        repo: cfg.repo,
        branch: cfg.branch,
        message: `GitHub read failed (HTTP ${getRes.status}): ${errText.slice(0, 140)}`,
      };
    }

    const putBody: Record<string, string> = {
      message: commitMessage,
      content: Buffer.from(contentUtf8, 'utf-8').toString('base64'),
      branch: cfg.branch,
    };
    if (existingSha) {
      putBody.sha = existingSha;
    }

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(putBody),
    });

    const putText = await putRes.text();
    let putJson: any = null;
    try {
      putJson = JSON.parse(putText);
    } catch {}

    if (!putRes.ok) {
      return {
        configured: true,
        synced: false,
        repo: cfg.repo,
        branch: cfg.branch,
        message: `GitHub commit failed (HTTP ${putRes.status}): ${putJson?.message || putText.slice(0, 140)}`,
      };
    }

    return {
      configured: true,
      synced: true,
      repo: cfg.repo,
      branch: cfg.branch,
      commitSha: putJson?.commit?.sha,
      commitUrl: putJson?.commit?.html_url,
      message: `Live in DB & committed hashed credentials to GitHub (${cfg.repo}@${cfg.branch}).`,
    };
  } catch (err: any) {
    return {
      configured: true,
      synced: false,
      repo: cfg.repo,
      branch: cfg.branch,
      message: `GitHub sync error: ${err?.message || 'Network request failed'}`,
    };
  }
}
