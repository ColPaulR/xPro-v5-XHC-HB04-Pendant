const fs = require('fs');
const path = require('path');
var config;

try {
    config = JSON.parse(fs.readFileSync('./.xhcrc', 'utf8'));
} catch (err) {
    console.error(err);
    process.exit(1);
}

// Set defaults
if (!config.JogRate) {
    config.JogRate = 2500;
}

if (config.DryRun) {
    // Dry run everything
    config.DryRunButtons = 1;
    config.DryRunJog = 1;
    config.DruRunProbeZ = 1;
}

module.exports = config;