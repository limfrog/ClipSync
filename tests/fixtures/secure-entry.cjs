// Playwright's Electron loader forces --password-store=basic for its normal tests.
// Override that test-only default before ready to exercise the real Secret Service.
const { app } = require('electron');
if (process.platform === 'linux') app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
require('../../dist/main.cjs');
