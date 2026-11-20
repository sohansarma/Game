# Tidepop for Android (Capacitor)

The Play Store app is the same web game in a native shell. The shell exists for two things the browser can't do:
**AdMob rewarded ads** (with Google's consent form) and **native Google sign-in**. Everything else is the website.

`public/js/native-bridge.js` is the only file that talks to the plugins; `ads.js` and `google.js` talk to that bridge.
Its method, event and option names were checked against the published type definitions of the two plugins (Capacitor 8), but **it has not been run on a device yet** – follow "Before you upload" below.

## Quick path (cloud build, no Android Studio)

The repository already contains the generated Android project. Set the GitHub variables/secrets listed at the top of
`.github/workflows/android.yml` and run **Actions → Android app**. `docs/play-store.md` has the full release order.

## One-time setup (local build)

You need Node 22+, Android Studio (SDK + a device or emulator) and a Play Console developer account.

```bash
cd android-app
npm install
TIDEPOP_API_URL=https://your-server.example npm run sync   # first run also needs: npx cap add android
```

`android/` is already generated and committed, with the AdMob app-id placeholder, the `AD_ID` permission, release signing and
launcher icons set up. To regenerate icons after changing `assets/icon-*.png`: `npx capacitor-assets generate --android`.

(Old manual step, no longer needed – the manifest already contains this:)

```xml
<!-- inside <manifest> -->
<uses-permission android:name="com.google.android.gms.permission.AD_ID"/>
<!-- inside <application> -->
<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY"/>
```

(The AdMob app ID comes from admob.google.com → Apps. The app crashes at start without it.)

## Decisions to make before the first upload (hard to change later)

- **Package name** is permanent once uploaded. `app.tidepop.arcade` is a placeholder – run `node scripts/set-package.mjs com.yourdomain.tidepop` (it updates every file), then `npm run sync`.
- **Signing key:** keep the upload keystore and passwords safe; never commit them (they are git-ignored). Raise `TIDEPOP_VERSION_CODE` for every upload (the cloud build uses the run number).
- **Google sign-in:** in Google Cloud Console create (1) a **Web** OAuth client and (2) an **Android** OAuth client (package name + the SHA-1 of your Play App Signing key). Set the Web client ID on the server as `GOOGLE_CLIENT_IDS`; the app learns it from `/api/health`.

## Build

```bash
# debug / internal testing: Google's TEST ads, safe to tap
TIDEPOP_API_URL=https://your-server.example npm run sync && npm run open

# release: your own rewarded ad unit, live ads
TIDEPOP_API_URL=https://your-server.example ADMOB_TESTING=false ADMOB_REWARDED_ID=ca-app-pub-XXXX/YYYY npm run sync
```
Then Build → Generate Signed Bundle (AAB) in Android Studio.

## Before you upload – test on a real device

1. **Child path:** choose "Under 13". In Android Studio's logcat the AdMob request must show child-directed treatment; Settings must show no "Ad choices" and no account options.
2. **Adult path:** choose "13 or older". From an EEA/UK network (or set the UMP debug geography in the plugin) Google's consent form must appear before any ad. Decline it and confirm ads are non-personalised.
3. **Reward:** finish an arcade game → "Watch a short ad". Only a fully watched ad adds shells; closing early adds none.
4. **Google sign-in:** Settings → Create account → Continue with Google. Check the dashboard (`/admin`) shows `link: google`.
5. Check `docs/play-store.md` and fill every Play Console form from it.
