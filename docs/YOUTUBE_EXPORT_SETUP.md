# YouTube Playlist Export Setup

GenMix uses Google Identity Services in the browser and the YouTube Data API v3. The OAuth access token stays in memory and is sent only to Google. GenMix never stores it in localStorage.

## 1. Create a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project for GenMix or select an existing development project.
3. Keep each teammate on a project they are authorized to use. YouTube quota is shared by every user of one Cloud project.

## 2. Enable the YouTube Data API

1. Open **APIs & Services → Library**.
2. Find **YouTube Data API v3**.
3. Choose **Enable**.

## 3. Configure OAuth consent

1. Open **Google Auth Platform → Branding/Audience**.
2. Select the **External** audience for ordinary Google accounts.
3. Keep the app in **Testing** while developing.
4. Add every teammate's Google email as a test user.
5. Complete the required app name and contact fields.

Google may show an unverified-app warning to listed test users. In Testing mode, authorization for YouTube scopes can expire after seven days, so a teammate may need to authorize again.

## 4. Create the browser OAuth client

1. Open **Google Auth Platform → Clients**.
2. Create an OAuth client with application type **Web application**.
3. Add `http://localhost:3010` under **Authorized JavaScript origins**.
4. Add the deployed HTTPS origin when GenMix is hosted elsewhere.
5. Copy the generated Client ID. A browser client does not use a client secret.

The current integration uses the Google Identity Services token model because GenMix is a static browser application with no backend. It requests `https://www.googleapis.com/auth/youtube.force-ssl` only after the user starts an export.

## 5. Configure and run GenMix

Copy `.env.example` to `.env`, then replace the placeholder:

```text
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Never commit `.env` or `config.local.js`. Start the app and let the configuration script generate the ignored browser file:

```bash
npm install
npm start
```

Restart the server after changing `.env`.

## 6. Export a playlist

1. Generate a playlist or open a saved playlist card.
2. Choose **Export to YouTube**.
3. Review the playlist name, privacy, song count, uncached search count, and estimated general quota.
4. Choose **Authorize and Export** and grant access with a configured test-user account.
5. Wait while GenMix matches songs and inserts videos in order.
6. Open the returned YouTube playlist link and review any unmatched or failed songs.

The default privacy is **Private**. Public and Unlisted are available in the confirmation panel.

## 7. Quota behavior

Current default YouTube allocation separates searches from other Data API methods:

- `search.list`: one search request from the project's default 100 daily searches.
- `playlists.insert`: 50 general quota units.
- `playlistItems.insert`: 50 general quota units per inserted video.

Therefore, a 20-song uncached export estimates 20 search requests and up to 1,050 general units. Cached matches skip searches. Quotas reset at midnight Pacific Time. When quota is exhausted, wait for the reset or request a quota increase in Google Cloud Console.

## 8. Troubleshooting

- **origin_mismatch / redirect_uri_mismatch:** add the exact running origin, normally `http://localhost:3010`, to the Web client's Authorized JavaScript origins. Restart after Cloud changes propagate.
- **access_denied:** confirm the Google email is listed as a test user and that the user accepted the YouTube permission.
- **Popup blocked:** allow popups for the GenMix origin and start Export again.
- **Missing Client ID:** confirm `.env` contains `GOOGLE_CLIENT_ID`, then restart `npm start`.
- **quotaExceeded / rateLimitExceeded:** stop retrying until quota resets at midnight Pacific Time or the project receives more quota.
- **401 after authorization:** start the export again so GenMix can request a fresh short-lived token.

## 9. Failure testing

- Deny or close the Google prompt to verify the authorization message.
- Temporarily use an invalid Client ID to verify the configuration error page/message.
- Automated tests mock quota, 401, popup, denial, matching, caching, and partial-add failures without contacting Google.

No audio or video is downloaded or streamed through GenMix. The feature only searches YouTube, creates a playlist in the authorized account, inserts matched video IDs, and links to the result.
