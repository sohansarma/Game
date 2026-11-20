// Connects the web app to the Android wrapper (Capacitor). On the website this file does nothing.
//
// It gives the rest of the app two small, plugin-independent doors:
//   window.TidepopNative.ads            → used by ads.js
//   window.TidepopNative.googleIdToken  → used by google.js
// so swapping a plugin later only means changing this file.
//
// Plugins expected in android-app/ (see android-app/README.md):
//   @capacitor-community/admob    – rewarded ads + Google's consent form (UMP)
//   @capgo/capacitor-social-login – Sign in with Google (Credential Manager)
//
// NOTE: method, event and option names were checked against the published
// type definitions of @capacitor-community/admob 8.4 and
// @capgo/capacitor-social-login 8.7, but this has not been run on a device
// yet – test with AdMob test ads and a test Google account before release.
(function () {
  var C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return;
  var P = C.Plugins || {};
  var N = (window.TidepopNative = {});
  var IDS = window.TIDEPOP_ADMOB || {};

  var RATING = { G: 'General', PG: 'ParentalGuidance', T: 'Teen', MA: 'MatureAudience' };
  var AdMob = P.AdMob;
  if (AdMob) {
    var cfg = { mode: 'child' };
    N.ads = {
      // Tell the SDK who it is serving. Must run before any ad is requested.
      configure: async function (c) {
        cfg = c;
        await AdMob.initialize({
          initializeForTesting: !!IDS.testing,
          tagForChildDirectedTreatment: !!c.childDirected,
          tagForUnderAgeOfConsent: !!c.underAge,
          maxAdContentRating: RATING[c.maxRating] || 'General', // the plugin wants the words, not the letters
        });
      },
      // Google's consent form (UMP). The SDK itself then limits ads to what the person agreed to.
      requestConsent: async function () {
        var info = await AdMob.requestConsentInfo();
        if (info.status === 'NOT_REQUIRED') return 'notrequired';
        if (info.status === 'REQUIRED' && info.isConsentFormAvailable) {
          await AdMob.showConsentForm();
          info = await AdMob.requestConsentInfo();
        }
        return info.canRequestAds && info.status === 'OBTAINED' ? 'granted' : info.status === 'NOT_REQUIRED' ? 'notrequired' : 'denied';
      },
      showPrivacyOptions: async function () {
        if (typeof AdMob.showPrivacyOptionsForm === 'function') await AdMob.showPrivacyOptionsForm();
      },
      // Load and show one rewarded ad. Resolves 'rewarded' | 'closed' | 'noad' | 'failed'.
      showRewarded: function () {
        return new Promise(function (resolve) {
          var handles = [], rewarded = false, done = false;
          function finish(v) {
            if (done) return;
            done = true;
            handles.forEach(function (h) { try { h.remove(); } catch (e) { /* ignore */ } });
            resolve(v);
          }
          Promise.all([
            AdMob.addListener('onRewardedVideoAdReward', function () { rewarded = true; }),
            AdMob.addListener('onRewardedVideoAdDismissed', function () { finish(rewarded ? 'rewarded' : 'closed'); }),
            AdMob.addListener('onRewardedVideoAdFailedToLoad', function () { finish('noad'); }),
            AdMob.addListener('onRewardedVideoAdFailedToShow', function () { finish('failed'); }),
          ]).then(function (hs) {
            handles = hs;
            return AdMob.prepareRewardVideoAd({ adId: IDS.rewarded, isTesting: !!IDS.testing, npa: cfg.mode !== 'personalized' });
          }).then(function () { return AdMob.showRewardVideoAd(); }).catch(function () { finish('failed'); });
          setTimeout(function () { finish('failed'); }, 45000); // never leave the player waiting
        });
      },
    };
  }

  var Social = P.SocialLogin;
  if (Social) {
    N.googleIdToken = async function (webClientId) {
      await Social.initialize({ google: { webClientId: webClientId } });
      var r = await Social.login({ provider: 'google', options: {} });
      var token = r && r.result && r.result.idToken;
      if (!token) throw new Error('Google sign-in was cancelled');
      return token;
    };
  }
})();
