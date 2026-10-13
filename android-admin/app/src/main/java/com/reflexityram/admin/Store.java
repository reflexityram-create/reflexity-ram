package com.reflexityram.admin;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * What the app remembers. The device token (the one long-lived secret) is encrypted with a key that lives in the Android
 * Keystore and never leaves it, so a copy of the app's files is useless on its own. Backups are switched off as well.
 */
final class Store {
    private static final String KEY_ALIAS = "rfx_device_token_key";
    private static final String PREFS = "rfx";
    private static final String K_TOKEN = "device_token";
    private static final String K_CURSOR = "cursor";
    private static final String K_SESSION = "session_jwt";
    private static final String K_SESSION_UNTIL = "session_until";

    private final SharedPreferences prefs;

    Store(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── device token ──────────────────────────────────────────────────────────
    synchronized String deviceToken() {
        String stored = prefs.getString(K_TOKEN, null);
        if (stored == null) return null;
        try {
            byte[] all = Base64.decode(stored, Base64.NO_WRAP);
            byte[] iv = new byte[12];
            System.arraycopy(all, 0, iv, 0, 12);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
        } catch (Exception e) {
            // The key is gone (a reset, a restore): the token cannot be read, so the phone has to be paired again.
            prefs.edit().remove(K_TOKEN).apply();
            return null;
        }
    }

    synchronized void saveDeviceToken(String token) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        byte[] sealed = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
        byte[] all = new byte[iv.length + sealed.length];
        System.arraycopy(iv, 0, all, 0, iv.length);
        System.arraycopy(sealed, 0, all, iv.length, sealed.length);
        prefs.edit().putString(K_TOKEN, Base64.encodeToString(all, Base64.NO_WRAP)).apply();
    }

    synchronized void forgetDevice() {
        prefs.edit().remove(K_TOKEN).remove(K_CURSOR).remove(K_SESSION).remove(K_SESSION_UNTIL).apply();
    }

    boolean isPaired() {
        return deviceToken() != null;
    }

    private static SecretKey key() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    // ── where the alert feed has got to ───────────────────────────────────────
    synchronized String cursor() {
        return prefs.getString(K_CURSOR, null);
    }

    synchronized void saveCursor(String cursor) {
        prefs.edit().putString(K_CURSOR, cursor).apply();
    }

    // ── the web view's admin session (24 h, renewed from the device token) ────
    synchronized String sessionJwt() {
        return prefs.getString(K_SESSION, null);
    }

    synchronized long sessionValidUntilMs() {
        return prefs.getLong(K_SESSION_UNTIL, 0L);
    }

    synchronized void saveSession(String jwt, long validUntilMs) {
        prefs.edit().putString(K_SESSION, jwt).putLong(K_SESSION_UNTIL, validUntilMs).apply();
    }
}
