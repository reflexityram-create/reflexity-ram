package com.reflexityram.admin;

/** Where the shop lives, and how the app talks to it. Nothing secret belongs in this file. */
final class Config {
    private Config() {}

    /** The storefront and admin panel (Cloudflare Pages). The web view only ever stays on this host. */
    static final String SITE = "https://reflexityram.com";

    /** The shop's API (Render). */
    static final String API = "https://reflexity-ram.onrender.com/api";

    /** A plain same-origin page the app loads first, only so it can put the sign-in token in the site's storage. */
    static final String BRIDGE_PAGE = SITE + "/robots.txt";

    /** Where the app opens when nothing else is asked for. */
    static final String HOME_PATH = "/admin/orders";

    /** The server holds an events request open this long when there is nothing new (it answers earlier if something happens). */
    static final int LONG_POLL_SECONDS = 25;

    /** A web-view session is renewed when it has less than this left (the server issues 24 h). */
    static final long SESSION_RENEW_BEFORE_MS = 12L * 60 * 60 * 1000;

    static final String APP_VERSION = "1.2.0";
}
