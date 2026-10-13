# Reflexity Admin (Android)

The shop owner's phone app: the admin panel in a full-screen web view that is **already signed in**, plus a notification for
every new order, payment, refund and quote request. Server side: `docs/phone-app.md`.

## How it works

- **Pairing, once.** Admin > Security > *Phone app* > *Pair a phone* shows a one-time code (10 minutes, works once). The app swaps it
  for a **device token** (kept encrypted with a key in the Android Keystore, never in a backup).
- **Signed in.** On launch the app asks the server for a 24 h admin session with the device token and puts it in the site's
  `localStorage.rfx_token` (via a same-origin page, `/robots.txt`), then opens `/admin/orders`. It renews the session before it
  runs out. No password is ever typed or stored. Removing the phone on the Security page signs it out at once.
- **Alerts.** A foreground service holds one request open to `GET /api/device/events` (long poll, 25 s). The server answers the
  moment something happens, so a new order shows up in about a second, with no Google push service. The little "Listening for
  orders and payments" notice is Android's requirement for an app that keeps a connection open; it is the quietest channel and can be
  hidden in the app's notification settings without stopping the alerts.
- **Tapping an alert** opens `/admin/orders?order=<id>` (the order's panel).
- Alert text has order numbers, amounts and item names only. On a locked screen only the headline shows.

## Build and install

Needs the Android SDK command-line tools (`~/Android-Sdk`: build-tools 35, platform android-35) and a JDK. No Gradle.

```bash
cd android-admin
./build.sh --init-key        # once: makes the signing key (password goes to the GNOME keyring, never printed)
./build.sh                   # -> build/reflexity-admin.apk
adb install -r -g build/reflexity-admin.apk
```

Updates must be signed with the same key, or Android refuses them. Keep `~/.config/reflexity-android/release.keystore` and its
keyring entry (`service=reflexity-android account=keystore`) safe.

Pair without typing: make a code on the Security page, then
`adb shell am start -n com.reflexityram.admin/.MainActivity --es pair_code ABCD-EFGH`
(only honoured while the phone is unpaired).

Alerts must arrive with the screen off. The app asks once to be exempt from battery optimization; over adb:
`adb shell dumpsys deviceidle whitelist +com.reflexityram.admin`.

## Files

| | |
| --- | --- |
| `MainActivity` | pairing screen, the web view, session renewal, file chooser for uploads |
| `EventService` | the foreground long-poll loop; reconnects with back-off and when the network returns |
| `Notifier` | channels (orders / updates / quiet / connection) and notification text |
| `Api`, `Store`, `Config` | HTTP calls, encrypted storage, the two URLs |
| `BootReceiver` | restarts the service after a reboot or an app update |

Target SDK 35, min SDK 30, no third-party code.
