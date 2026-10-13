package com.reflexityram.admin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import org.json.JSONObject;

/** Turns the server's alerts into Android notifications. The server already keeps customer details out of the text. */
final class Notifier {
    static final String CH_ORDERS = "orders";
    static final String CH_UPDATES = "updates";
    static final String CH_QUIET = "quiet";
    static final String CH_SERVICE = "service";
    static final int SERVICE_NOTIFICATION_ID = 1;

    private Notifier() {}

    static void createChannels(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        make(manager, CH_ORDERS, context.getString(R.string.channel_orders), context.getString(R.string.channel_orders_desc), NotificationManager.IMPORTANCE_HIGH);
        make(manager, CH_UPDATES, context.getString(R.string.channel_updates), context.getString(R.string.channel_updates_desc), NotificationManager.IMPORTANCE_DEFAULT);
        make(manager, CH_QUIET, context.getString(R.string.channel_quiet), context.getString(R.string.channel_quiet_desc), NotificationManager.IMPORTANCE_LOW);
        make(manager, CH_SERVICE, context.getString(R.string.channel_service), context.getString(R.string.channel_service_desc), NotificationManager.IMPORTANCE_MIN);
    }

    private static void make(NotificationManager manager, String id, String name, String description, int importance) {
        NotificationChannel channel = new NotificationChannel(id, name, importance);
        channel.setDescription(description);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        if (importance == NotificationManager.IMPORTANCE_MIN) channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    /** The small, quiet notice Android requires while the app holds its connection open. */
    static Notification serviceNotification(Context context, boolean online) {
        return new Notification.Builder(context, CH_SERVICE)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(context.getString(online ? R.string.service_listening : R.string.service_offline))
                .setOngoing(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setContentIntent(open(context, Config.HOME_PATH, 0))
                .build();
    }

    static void show(Context context, JSONObject event) {
        String priority = event.optString("priority", "normal");
        String channel = "high".equals(priority) ? CH_ORDERS : "low".equals(priority) ? CH_QUIET : CH_UPDATES;
        String id = event.optString("id", String.valueOf(System.nanoTime()));
        String path = event.optString("path", Config.HOME_PATH);
        int notificationId = 1000 + (id.hashCode() & 0x0FFFFFFF) % 1_000_000;

        // On a locked screen: the headline only. The amounts and items appear once the phone is unlocked.
        Notification publicVersion = new Notification.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(event.optString("title", context.getString(R.string.public_title)))
                .setContentText(context.getString(R.string.public_text))
                .build();

        Notification.Builder builder = new Notification.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(event.optString("title", context.getString(R.string.public_title)))
                .setContentText(event.optString("body", ""))
                .setStyle(new Notification.BigTextStyle().bigText(event.optString("body", "")))
                .setWhen(parseTime(event.optString("createdAt", null)))
                .setShowWhen(true)
                .setAutoCancel(true)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setPublicVersion(publicVersion)
                .setGroup("shop-alerts")
                .setContentIntent(open(context, path, notificationId));
        context.getSystemService(NotificationManager.class).notify(notificationId, builder.build());
    }

    /** One-off notice, e.g. "this phone was removed". */
    static void notice(Context context, int id, String title, String text) {
        Notification notification = new Notification.Builder(context, CH_ORDERS)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(open(context, Config.HOME_PATH, id))
                .build();
        context.getSystemService(NotificationManager.class).notify(id, notification);
    }

    static PendingIntent open(Context context, String path, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(Config.SITE + path))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static long parseTime(String iso) {
        if (iso == null) return System.currentTimeMillis();
        try {
            // 2026-10-13T12:00:00.000Z
            java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US);
            format.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            return format.parse(iso.substring(0, 19)).getTime();
        } catch (Exception e) {
            return System.currentTimeMillis();
        }
    }
}
