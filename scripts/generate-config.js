const fs = require('fs');
const path = require('path');

// Parse only simple KEY=VALUE lines so configuration adds no dependency.
function parseEnv(text) {
    const values = {};
    String(text || '').split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return;
        }
        const separator = trimmed.indexOf('=');
        if (separator === -1) {
            return;
        }
        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    });
    return values;
}

// Generate an ignored browser configuration file from local environment values.
function generateConfig(rootDirectory = path.join(__dirname, '..')) {
    const envPath = path.join(rootDirectory, '.env');
    const fileValues = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {};
    const googleClientId = process.env.GOOGLE_CLIENT_ID || fileValues.GOOGLE_CLIENT_ID || '';
    const output = `window.GENMIX_CONFIG = Object.freeze(${JSON.stringify({ googleClientId })});\n`;
    fs.writeFileSync(path.join(rootDirectory, 'config.local.js'), output, 'utf8');
    return { googleClientIdConfigured: Boolean(googleClientId) };
}

if (require.main === module) {
    const result = generateConfig();
    console.log(result.googleClientIdConfigured
        ? 'Generated local GenMix configuration.'
        : 'Generated local GenMix configuration without a Google Client ID.');
}

module.exports = { parseEnv, generateConfig };
