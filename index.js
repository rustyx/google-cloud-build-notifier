// google-cloud-build-notifier

const APP_ID = ;
const APP_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
-----END RSA PRIVATE KEY-----`;

const { App } = require("@octokit/app");
const { request } = require("@octokit/request");
const LRU = require('lru-cache');
const cache = new LRU({ max: 1000, maxAge: 1000 * 60 * 59 });
const app = new App({ id: APP_ID, privateKey: APP_PRIVATE_KEY, cache: cache });

/* GCB repoName looks like "github-<owner>-<repo>" */
function parseRepoName(repoName) {
  const m = repoName.match(/^github-([^-]+)-(.+)/);
  if (!m) {
    throw `Unable to determine GitHub repo name from '${repoName}'`;
  }
  return { owner: m[1], repo: m[2] };
}

async function getInstallationId(path) {
  const key = "inst-" + path.owner + "/" + path.repo;
  var id = cache.get(key);
  if (!id) {
    const jwt = app.getSignedJsonWebToken();
    try {
      const { data } = await request("GET /repos/:owner/:repo/installation", {
        owner: path.owner,
        repo: path.repo,
        headers: {
          authorization: `Bearer ${jwt}`,
          accept: "application/vnd.github.machine-man-preview+json"
        }
      });
      // console.log(`GET installation: ${data}`);
      cache.set(key, id = data.id);
    } catch (e) {
      e.message = `Unable to get installation ID. Is the app installed in org '${path.owner}'?`;
      throw e;
    }
  }
  return id;
}

const statusMap = {
  QUEUED: "queued",
  WORKING: "in_progress",
  SUCCESS: "completed",
  FAILURE: "completed",
  INTERNAL_ERROR: "completed",
  TIMEOUT: "completed",
  CANCELLED: "completed",
};
const conclusionMap = {
  SUCCESS: "success",
  FAILURE: "failure",
  INTERNAL_ERROR: "action_required",
  TIMEOUT: "timed_out",
  CANCELLED: "cancelled",
};
function transformMsg(msg) {
  var res = {
    head_sha: msg.sourceProvenance.resolvedRepoSource.commitSha,
    external_id: msg.id,
    details_url: msg.logUrl,
    status: statusMap[msg.status],
    conclusion: conclusionMap[msg.status],
    name: "Build " + msg.id,
    started_at: msg.startTime,
    completed_at: msg.finishTime,
  };
  Object.keys(res).forEach((key) => res[key] || delete res[key]);
  res.conclusion || delete res.completed_at;
  if (msg.steps && msg.steps.length) {
    res.output = { title: "Summary", summary: msg.steps.map(s => s.name + ": " + (s.status || "...")).join("\n") };
  }
  return res;
}

async function processMsg(msg) {
  if (!msg.sourceProvenance || !msg.sourceProvenance.resolvedRepoSource || !msg.sourceProvenance.resolvedRepoSource.commitSha
     || !msg.source || !msg.source.repoSource || !msg.source.repoSource.repoName) {
    console.log(`Request missing data, ignored`);
    return;
  }
  const path = parseRepoName(msg.source.repoSource.repoName);
  const installationId = await getInstallationId(path);
  const installationAccessToken = await app.getInstallationAccessToken({installationId});
  // console.log(`installationAccessToken: ${installationAccessToken}`);
  var last = cache.get(msg.id);
  var ghmsg = transformMsg(msg);
  // console.log(`GitHub msg: ${JSON.stringify(ghmsg)}`);
  if (!last) {
    const { data } = await request("GET /repos/:owner/:repo/commits/:ref/check-runs", {
      owner: path.owner,
      repo: path.repo,
      ref: ghmsg.head_sha,
      headers: {
        authorization: `token ${installationAccessToken}`,
        accept: "application/vnd.github.antiope-preview+json"
      }
    });
    if (data.total_count) {
      for (var r of data.check_runs) {
        if (r.external_id == ghmsg.external_id) {
          last = r;
          break;
        }
      }
    }
  }
  if (!last) {
    console.log(`Adding build ${msg.id}, status ${ghmsg.status}, conclusion ${ghmsg.conclusion || '-'}`);
    const { data } = await request("POST /repos/:owner/:repo/check-runs", Object.assign(ghmsg, {
      owner: path.owner,
      repo: path.repo,
      headers: {
        authorization: `token ${installationAccessToken}`,
        accept: "application/vnd.github.antiope-preview+json"
      }
    }));
    // console.log(`POST check-runs: ${JSON.stringify(data)}`);
    cache.set(msg.id, data);
  } else {
    console.log(`Updating build ${msg.id} (check ${last.id}), status ${ghmsg.status}, conclusion ${ghmsg.conclusion || '-'}`);
    const { data } = await request("PATCH /repos/:owner/:repo/check-runs/:id", Object.assign(ghmsg, {
      id: last.id,
      owner: path.owner,
      repo: path.repo,
      headers: {
        authorization: `token ${installationAccessToken}`,
        accept: "application/vnd.github.antiope-preview+json"
      }
    }));
    // console.log(`PATCH check-runs/${last.id}: ${JSON.stringify(data)}`);
    cache.set(msg.id, data);
  }
}

exports.handleEvent = async (event) => {
  try {
    event.data = JSON.parse(Buffer.from(event.data, 'base64').toString());
    console.log(`incoming event: ${JSON.stringify(event)}`);
    await processMsg(event.data);
  } catch (e) {
    console.error(e);
  }
};
