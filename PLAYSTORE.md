# 📲 Publishing StaySathi to the Google Play Store

StaySathi ships to Android as a **Trusted Web Activity (TWA)** — a thin native
wrapper (in [`android/`](./android)) that opens the live PWA full-screen, with
no browser toolbar. To the user it's a normal app; under the hood it's your
website. This is Google's recommended way to put a PWA on Play, and it keeps a
single codebase: **you ship a web update and every installed app updates too.**

> Why not bundle the site into the app (Capacitor/Cordova)? StaySathi's frontend
> calls the API with **same-origin relative paths** (`/api/...`). A TWA keeps the
> app on your real domain, so those calls just work. Bundling would force a
> rewrite to absolute URLs + CORS. TWA is the right tool here.

---

## What you need (one-time)

| Thing | Cost | Notes |
|-------|------|-------|
| A domain | ~₹800/yr | **`staysathi.app` recommended.** `.app` is always-HTTPS (required). |
| HTTPS hosting for the PWA | from free | Render / Fly / Railway — see [README](./README.md#-deployment--devops). |
| Google Play Developer account | **$25 once** | https://play.google.com/console/signup |
| A signing keystore | free | You create it below. **Back it up.** |
| Android Studio *or* GitHub Actions | free | To build the `.aab`. CI is already wired up. |

The whole domain lives in **one place** in the app:
[`android/app/src/main/res/values/strings.xml`](./android/app/src/main/res/values/strings.xml)
(`hostName` + `launchUrl`). If you pick a domain other than `staysathi.app`,
change it there, in that file's `assetStatements`, and in the manifest's
`app.staysathi.twa` package if you rebrand the id.

---

## Step 1 — Put the PWA online at your domain (HTTPS)

Deploy the app (Express serves both API and the built frontend) and point your
domain at it. Follow [README → Deployment](./README.md#-deployment--devops).
Confirm all of these load over **https://staysathi.app**:

- `https://staysathi.app/` — the app opens
- `https://staysathi.app/health` — `{"status":"ok",...}`
- `https://staysathi.app/manifest.webmanifest` — the PWA manifest

Leave `TWA_SHA256_FINGERPRINTS` unset for now; you'll fill it in at Step 5.

## Step 2 — Create your upload keystore (once, keep it forever)

```bash
keytool -genkey -v -keystore staysathi-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias staysathi
```

You'll be asked for a password and your name/org. **Save the file and both
passwords in a password manager.** With Play App Signing (Step 4) a lost upload
key can be reset by Google, but treat it as precious anyway.

## Step 3 — Build the Android App Bundle (`.aab`)

You need the `.aab` to upload to Play. Two ways — pick one.

### Option A — GitHub Actions (no local Android tooling)

1. In GitHub: **Settings → Secrets and variables → Actions → New secret**, add:
   - `ANDROID_KEYSTORE_BASE64` → `base64 -w0 staysathi-upload.jks` (the output)
   - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`staysathi`), `ANDROID_KEY_PASSWORD`
2. Run the **“Android (Play Store bundle)”** workflow (Actions tab → Run
   workflow), or push a tag: `git tag v1.0.0 && git push --tags`.
3. Download the **`staysathi-release-aab`** artifact — that's your upload file.

### Option B — Local, with Android Studio or the CLI

```bash
cd android
cp keystore.properties.example keystore.properties   # then edit real values
./gradlew bundleRelease        # → app/build/outputs/bundle/release/app-release.aab
./gradlew assembleRelease      # → a .apk you can sideload to test first
```

(Opening the `android/` folder in Android Studio and choosing **Build → Generate
Signed Bundle / APK** works too — it uses the same Gradle config.)

> **Test on a real phone first** (recommended): install the `.apk` via
> `adb install app-release.apk`. Until Step 5 is done and live, the app shows a
> Chrome address bar — that's the asset-links check failing, and it disappears
> once verification passes.

## Step 4 — Create the app in Play Console & enroll in Play App Signing

1. https://play.google.com/console → **Create app**. Name **StaySathi**, app,
   free, accept the declarations.
2. **Test and release → Setup → App signing** — **use Play App Signing**
   (default, strongly recommended). Google holds the real signing key; your
   keystore is just the *upload* key.
3. Create a release (start with **Internal testing** so only you see it):
   **Testing → Internal testing → Create new release**, upload your `.aab`.

## Step 5 — Verify Digital Asset Links (removes the browser bar)

The app and the website must vouch for each other or the app opens with a Chrome
address bar showing.

1. In Play Console → **Setup → App signing**, copy the **SHA-256 certificate
   fingerprint** under *App signing key certificate* (and also the *Upload key
   certificate* — add both).
2. Set it on your **server** so `/.well-known/assetlinks.json` serves it. On
   Render/Fly, add an env var (comma-separate multiple fingerprints):
   ```
   TWA_SHA256_FINGERPRINTS=AB:CD:...:12,34:56:...:78
   TWA_PACKAGE_NAME=app.staysathi.twa
   ```
   Redeploy, then confirm:
   ```
   curl https://staysathi.app/.well-known/assetlinks.json
   ```
   It should list your package and fingerprint(s).
3. Sanity-check with Google's tester:
   https://developers.google.com/digital-asset-links/tools/generator
4. Reopen the app — the address bar should be gone. (May take a reinstall.)

## Step 6 — Fill the store listing & submit for review

In Play Console, complete each section (it shows a checklist):

- **Store listing:** short + full description, app icon (512×512 — use
  `client/public/icons/icon-512.png`), a feature graphic (1024×500), and at
  least 2 phone screenshots (grab them from the running app).
- **Content rating** questionnaire, **Data safety** form (StaySathi stores
  tenant names/phones you enter — declare that), **Privacy policy** URL,
  **Target audience**, **App category:** *Business* or *Productivity*.
- Promote the release from Internal testing → **Production** when ready and
  **Submit for review**. First review typically takes a few days.

---

## Shipping updates later

- **Web/content change:** just deploy the site. Installed apps show it instantly
  (the TWA loads your live URL). No Play upload needed.
- **Native shell change** (name, icon, new Android features): bump **both**
  `versionCode` (integer, +1) and `versionName` in
  [`android/app/build.gradle`](./android/app/build.gradle), rebuild the `.aab`
  (Step 3), and upload a new release.

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| App opens with a URL/address bar | Asset links not verified — recheck Step 5 (fingerprint matches Play **App signing** key, file is live over HTTPS, exact host). |
| `Package appears to be invalid` on upload | `versionCode` must be higher than any previous upload; the `.aab` must be signed (secrets set). |
| Gradle can't find the SDK locally | Open `android/` in Android Studio once (it writes `local.properties`), or set `ANDROID_HOME`. |
| Blank screen in the app | The `launchUrl` isn't reachable over HTTPS, or the site is down — test the URL in Chrome. |
