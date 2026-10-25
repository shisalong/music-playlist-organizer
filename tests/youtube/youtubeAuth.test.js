const { YouTubeAuth } = require('../../src/integrations/youtube/youtubeAuth.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function runTest(name, test) {
    try {
        await test();
        passed++;
        console.log(`PASS: ${name}`);
    } catch (error) {
        failed++;
        console.error(`FAIL: ${name} — ${error.message}`);
    }
}

function mockGoogle(action) {
    return {
        accounts: {
            oauth2: {
                hasGrantedAllScopes: () => true,
                initTokenClient(configuration) {
                    return {
                        requestAccessToken() {
                            action(configuration);
                        }
                    };
                }
            }
        }
    };
}

(async () => {
    await runTest('missing Client ID produces a clear setup error', async () => {
        const auth = new YouTubeAuth({ clientId: '', google: mockGoogle(() => {}) });
        try {
            await auth.getAccessToken();
            throw new Error('Expected authorization failure');
        } catch (error) {
            assert(error.code === 'missing_client_id', 'Missing configuration code should be preserved');
            assert(error.message.includes('GOOGLE_CLIENT_ID'), 'Setup message should name the required setting');
        }
    });

    await runTest('denied consent produces a clear authorization error', async () => {
        const auth = new YouTubeAuth({
            clientId: 'test.apps.googleusercontent.com',
            google: mockGoogle((configuration) => configuration.callback({ error: 'access_denied' }))
        });
        try {
            await auth.getAccessToken();
            throw new Error('Expected denial');
        } catch (error) {
            assert(error.code === 'access_denied', 'Denial code should be retained');
        }
    });

    await runTest('blocked popup produces a clear browser instruction', async () => {
        const auth = new YouTubeAuth({
            clientId: 'test.apps.googleusercontent.com',
            google: mockGoogle((configuration) => configuration.error_callback({ type: 'popup_failed_to_open' }))
        });
        try {
            await auth.getAccessToken();
            throw new Error('Expected popup failure');
        } catch (error) {
            assert(error.code === 'popup_failed_to_open', 'Popup code should be retained');
            assert(error.message.includes('Allow popups'), 'Message should explain recovery');
        }
    });

    await runTest('successful tokens remain in memory and are reused before expiry', async () => {
        let requests = 0;
        const auth = new YouTubeAuth({
            clientId: 'test.apps.googleusercontent.com',
            now: () => 1000,
            google: mockGoogle((configuration) => {
                requests++;
                configuration.callback({ access_token: 'memory-only', expires_in: 3600 });
            })
        });
        assert(await auth.getAccessToken() === 'memory-only', 'Token should be returned');
        assert(await auth.getAccessToken() === 'memory-only', 'Valid token should be reused');
        assert(requests === 1, 'Only one authorization request should occur');
    });

    console.log(`\nTest summary: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
})();
