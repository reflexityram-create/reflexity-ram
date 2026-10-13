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
    /**
     * The decrypted device token, or null when it cannot be had RIGHT NOW. Null does not always mean "not paired": just after a
     * restart the Keystore can be slow to answer, and a pairing must never be thrown away because of that. It is only forgotten
     * when the key it was sealed with no longer exists (a reset or a restore), which can never come back.
     */
    synchronized String deviceToken() {
        String stored = prefs.getString(K_TOKEN, null);
        if (stored == null) return null;
        try {
            byte[] all = Base64.decode(stored, Base64.NO_WRAP);
            byte[] iv = new byte[12];
            System.arraycopy(all, 0, iv, 0, 12);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
        } catch (KeyGoneException e) {
            prefs.edit().remove(K_TOKEN).apply();
            return null;
        } catch (Exception e) {
            return null;                                              // unreadable for now: keep it, the caller retries
        }
    }

    /** A token is saved (whether or not the Keystore is answering at this moment). */
    boolean hasSavedToken() {
        return prefs.contains(K_TOKEN);
    }

    synchronized void saveDeviceToken(String token) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
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

    /** Paired = a token is saved. (Reading it is a separate step that can fail for a moment.) */
    boolean isPaired() {
        return hasSavedToken();
    }

    private static final class KeyGoneException extends Exception {
        private static final long serialVersionUID = 1L;
    }

    /** The Keystore key. Only pairing (`create`) may make a new one; reading with a missing key means the token is lost for good. */
    private static SecretKey key(boolean create) throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        if (!create) throw new KeyGoneException();
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
