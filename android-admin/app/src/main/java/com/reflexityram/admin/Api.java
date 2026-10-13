package com.reflexityram.admin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** The shop server's phone API (backend/src/routes/device.js). Plain HttpURLConnection: no libraries to keep up to date. */
final class Api {
    private Api() {}

    /** The server said no. `revoked` means this phone is no longer paired (removed on the Security page, or the admin changed). */
    static final class ApiException extends IOException {
        private static final long serialVersionUID = 1L;
        final int status;
        final String code;

        ApiException(int status, String code, String message) {
            super(message);
            this.status = status;
            this.code = code;
        }

        boolean revoked() {
            return status == 401 && "DEVICE_REVOKED".equals(code);
        }
    }

    static JSONObject pair(String code, String label) throws IOException, JSONException {
        JSONObject body = new JSONObject().put("code", code).put("label", label).put("appVersion", Config.APP_VERSION);
        return call("POST", "/device/pair", null, body, 20_000);
    }

    static JSONObject session(String deviceToken) throws IOException, JSONException {
        return call("POST", "/device/session", deviceToken, new JSONObject(), 20_000);
    }

    /** Without a cursor the server only hands back "now"; with one it answers when something is newer (or after the wait). */
    static JSONObject events(String deviceToken, String cursor, int waitSeconds) throws IOException, JSONException {
        String path = "/device/events" + (cursor == null ? "" : "?after=" + cursor + "&wait=" + waitSeconds);
        return call("GET", path, deviceToken, null, (waitSeconds + 20) * 1000);
    }

    private static JSONObject call(String method, String path, String bearer, JSONObject body, int readTimeoutMs) throws IOException, JSONException {
        HttpURLConnection connection = (HttpURLConnection) new URL(Config.API + path).openConnection();
        try {
            connection.setRequestMethod(method);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(readTimeoutMs);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "ReflexityAdmin/" + Config.APP_VERSION + " (Android)");
            if (bearer != null) connection.setRequestProperty("Authorization", "Bearer " + bearer);
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String text = stream == null ? "" : read(stream);
            JSONObject json;
            try {
                json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
            } catch (JSONException e) {
                // A proxy error page or a half-awake server: not our JSON, so treat it like any other bad answer.
                throw new ApiException(status, null, "Unreadable answer from the server (HTTP " + status + ")");
            }
            if (status >= 400) throw new ApiException(status, json.optString("code", null), json.optString("error", "HTTP " + status));
            return json;
        } finally {
            connection.disconnect();
        }
    }

    private static String read(InputStream stream) throws IOException {
        try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            return out.toString("UTF-8");
        }
    }
}
