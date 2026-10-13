package com.reflexityram.admin;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.IBinder;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;

/**
 * Holds one request open to the shop server ("long poll"). The server answers the moment something happens (a paid
 * order, an e-Transfer to watch for, a failed payment ...), and the answer becomes a notification. No Google push service
 * is involved, so nothing about the shop passes through anyone else.
 */
public final class EventService extends Service {
    private static final String TAG = "RfxAlerts";

    private Store store;
    private Thread worker;
    private volatile boolean running;
    private volatile boolean online = true;
    private boolean revokedNoticeShown = false;
    private final Object wake = new Object();
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;

    static void start(Context context) {
        context.startForegroundService(new Intent(context, EventService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        store = new Store(this);
        Notifier.createChannels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Android demands the notice within seconds of startForegroundService, even if we are about to stop again.
        startForeground(Notifier.SERVICE_NOTIFICATION_ID, Notifier.serviceNotification(this, online), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        if (!store.isPaired()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (worker == null || !worker.isAlive()) {
            running = true;
            worker = new Thread(this::loop, "rfx-events");
            worker.start();
            watchNetwork();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        if (connectivity != null && networkCallback != null) {
            try { connectivity.unregisterNetworkCallback(networkCallback); } catch (RuntimeException ignored) { /* already gone */ }
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void loop() {
        long backoffMs = 2_000;
        while (running) {
            String token = store.deviceToken();
            if (token == null) {
                if (!store.hasSavedToken()) break;                        // forgotten (removed, or its key is gone): stop
                setOnline(false);                                         // saved but unreadable for the moment (just after a restart): wait
                backoffMs = pause(backoffMs);
                continue;
            }
            try {
                String cursor = store.cursor();
                JSONObject answer = Api.events(token, cursor, Config.LONG_POLL_SECONDS);
                if (cursor == null) {
                    store.saveCursor(answer.getString("cursor"));          // first contact: from now on, no history
                } else {
                    JSONArray events = answer.getJSONArray("events");
                    for (int i = 0; i < events.length(); i++) {
                        JSONObject event = events.getJSONObject(i);
                        Notifier.show(this, event);
                        store.saveCursor(event.getString("id"));            // after showing: a crash repeats one, never loses one
                    }
                }
                setOnline(true);
                backoffMs = 2_000;
            } catch (Api.ApiException e) {
                if (e.revoked()) {
                    Log.i(TAG, "this phone is no longer paired");
                    store.forgetDevice();
                    Notifier.notice(this, 2, "This phone was removed", "It no longer gets shop alerts. Pair it again from the Security page in the admin.");
                    revokedNoticeShown = true;
                    break;
                }
                Log.w(TAG, "server said " + e.status + "; retrying");
                setOnline(false);
                backoffMs = pause(backoffMs);
            } catch (IOException | JSONException e) {
                Log.w(TAG, "connection problem (" + e.getClass().getSimpleName() + "); retrying");
                setOnline(false);
                backoffMs = pause(backoffMs);
            } catch (RuntimeException e) {
                Log.e(TAG, "unexpected " + e.getClass().getSimpleName(), e);
                setOnline(false);
                backoffMs = pause(backoffMs);
            }
        }
        if (running) {
            if (!store.hasSavedToken() && !revokedNoticeShown) {
                Notifier.notice(this, 3, "Alerts stopped", "This phone is no longer paired with the shop. Open the app to pair it again.");
            }
            stopSelf();
        }
    }

    /** Waits `ms` (cut short when a network comes back), and returns the next, longer wait. */
    private long pause(long ms) {
        try {
            synchronized (wake) {
                wake.wait(ms + (long) (Math.random() * 1000));
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return Math.min(ms * 2, 60_000);
    }

    private void setOnline(boolean value) {
        if (online == value) return;
        online = value;
        getSystemService(android.app.NotificationManager.class).notify(Notifier.SERVICE_NOTIFICATION_ID, Notifier.serviceNotification(this, value));
    }

    private void watchNetwork() {
        if (networkCallback != null) return;
        connectivity = getSystemService(ConnectivityManager.class);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                synchronized (wake) {
                    wake.notifyAll();                                       // reconnect now instead of after the wait
                }
            }
        };
        connectivity.registerDefaultNetworkCallback(networkCallback);
    }
}
