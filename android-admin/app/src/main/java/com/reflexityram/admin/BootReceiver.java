package com.reflexityram.admin;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Starts listening again after the phone restarts or the app is updated, if it was paired. */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (new Store(context).isPaired()) EventService.start(context);
    }
}
