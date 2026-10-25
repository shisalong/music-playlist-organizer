(function (global, factory) {
    const exported = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exported;
    }
    global.YouTubeAuth = exported.YouTubeAuth;
    global.YouTubeAuthError = exported.YouTubeAuthError;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

    class YouTubeAuthError extends Error {
        constructor(code, message) {
            super(message);
            this.name = 'YouTubeAuthError';
            this.code = code;
        }
    }

    class YouTubeAuth {
        // Keep the short-lived token only on this in-memory instance.
        constructor(options = {}) {
            this.clientId = String(options.clientId || '').trim();
            this.google = options.google || null;
            this.scope = options.scope || YOUTUBE_SCOPE;
            this.now = options.now || (() => Date.now());
            this.accessToken = '';
            this.expiresAt = 0;
        }

        // Report setup errors before opening an OAuth popup.
        validateConfiguration() {
            if (!this.clientId) {
                throw new YouTubeAuthError(
                    'missing_client_id',
                    'YouTube export is not configured. Add GOOGLE_CLIENT_ID to your local .env file and restart GenMix.'
                );
            }
            if (!this.google || !this.google.accounts || !this.google.accounts.oauth2) {
                throw new YouTubeAuthError(
                    'identity_unavailable',
                    'Google authorization could not load. Check your network connection and try again.'
                );
            }
        }

        // Return true while the in-memory token has at least one minute remaining.
        hasUsableToken() {
            return Boolean(this.accessToken && this.expiresAt - this.now() > 60000);
        }

        // Request a fresh token and normalize popup and consent failures.
        requestToken(interactive = true) {
            this.validateConfiguration();
            return new Promise((resolve, reject) => {
                let settled = false;
                const finishWithError = (code, message) => {
                    if (!settled) {
                        settled = true;
                        reject(new YouTubeAuthError(code, message));
                    }
                };
                const client = this.google.accounts.oauth2.initTokenClient({
                    client_id: this.clientId,
                    scope: this.scope,
                    callback: (response) => {
                        if (settled) {
                            return;
                        }
                        if (!response || response.error) {
                            finishWithError(
                                response && response.error || 'access_denied',
                                'Google authorization was denied or did not finish.'
                            );
                            return;
                        }
                        const hasScope = typeof this.google.accounts.oauth2.hasGrantedAllScopes !== 'function' ||
                            this.google.accounts.oauth2.hasGrantedAllScopes(response, this.scope);
                        if (!hasScope) {
                            finishWithError('scope_not_granted', 'YouTube playlist permission was not granted.');
                            return;
                        }
                        settled = true;
                        this.accessToken = response.access_token;
                        this.expiresAt = this.now() + Number(response.expires_in || 3600) * 1000;
                        resolve(this.accessToken);
                    },
                    error_callback: (error) => {
                        const code = error && error.type || 'popup_error';
                        const messages = {
                            popup_failed_to_open: 'The Google authorization popup was blocked. Allow popups and try again.',
                            popup_closed: 'The Google authorization popup was closed before access was granted.'
                        };
                        finishWithError(code, messages[code] || 'Google authorization could not start.');
                    }
                });
                try {
                    client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
                } catch (error) {
                    finishWithError('authorization_failed', 'Google authorization could not start.');
                }
            });
        }

        // Reuse a valid token or request permission at the user's export action.
        async getAccessToken() {
            return this.hasUsableToken() ? this.accessToken : this.requestToken(true);
        }

        // Try a quiet renewal first, then fall back to an account/consent prompt.
        async refreshAccessToken() {
            this.accessToken = '';
            this.expiresAt = 0;
            try {
                return await this.requestToken(false);
            } catch (error) {
                return this.requestToken(true);
            }
        }
    }

    return { YOUTUBE_SCOPE, YouTubeAuth, YouTubeAuthError };
});
