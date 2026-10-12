// Exercise actual HTTP completion and PNG/JPEG decoders against loopback fixtures.
// No Homey/Sonos credentials or physical control commands are used.
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.join(__dirname, '..');
execFileSync(path.join(root, '.venv/bin/python'), [path.join(root, 'scripts/test-ui-priority.py')], {stdio: 'inherit'});
