# Tidepop for Android (Capacitor)

The Play Store app is the same web game in a native shell. The shell exists for two things the browser can't do:
**AdMob rewarded ads** (with Google's consent form) and **native Google sign-in**. Everything else is the website.

`public/js/native-bridge.js` is the only file that talks to the plugins; `ads.js` and `google.js` talk to that bridge.
Its method, event and option names were checked against the published type definitions of the two plugins (Capacitor 8), but **it has not been run on a device yet** – follow "Before you upload" below.

## One-time setup

You need Node 22+, Android Studio (SDK + a device or emulator) and a Play Console developer account.

```bash
cd android-app
npm install
TIDEPOP_API_URL=https://your-server.example npm run sync   # first run also needs: npx cap add android
```

If `android/` does not exist yet, run `npx cap add android` once, then `npm run sync`. Commit the generated `android/` folder.

Then edit `android/app/src/main/AndroidManifest.xml`:

```xml
<!-- inside <manifest> -->
<uses-permission android:name="com.google.android.gms.permission.AD_ID"/>
<!-- inside <application> -->
<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY"/>
```

(The AdMob app ID comes from admob.google.com → Apps. The app crashes at start without it.)

## Decisions to make before the first upload (hard to change later)

- **`appId`** in `capacitor.config.json` is the Play package name and is permanent. `app.tidepop.arcade` is a placeholder – use a domain you own.
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
