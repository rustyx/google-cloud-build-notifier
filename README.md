# Google Cloud Build GitHub notifier

This is a simple Google Cloud Function that notifies GitHub of Cloud Build outcomes.

It is useful as an alternative for the official Google Cloud Build app, as it does not attempt to manage Google Cloud builds and instead relies on *existing* Google Cloud builds, so that their full potential, such as custom triggering, can be exploited.

## Installation

  1. Go to your **GitHub Organization Settings** -> Developer Options -> GitHub Apps
  2. Create a new **GitHub App**:
     * Name: `Google Cloud Build`
     * Homepage URL: `https://console.cloud.google.com/cloud-build/builds`
     * User authorization callback URL: `https://console.cloud.google.com/cloud-build/builds`
     * Permissions: **Checks** - read & write, **Commit statuses** - read & write
  3. Generate a new private key
  4. Install the newly added GitHub App in your GitHub organization
  5. Fill in `APP_ID` and `APP_PRIVATE_KEY` details in `index.js`
  6. Go to **Google Cloud Console** -> [Functions](https://console.cloud.google.com/functions)
  7. Create a new Cloud Function:
     * Trigger: Cloud Pub/Sub,
     * Topic: cloud-builds,
     * Runtime: Node 10,
     * Copy/paste `index.js` and `package.json` contents into the relevant text fields,
     * Function to execute: `handleEvent`,
     * Advanced -> select region (optional)
