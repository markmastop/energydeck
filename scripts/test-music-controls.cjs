// Compile the production Sonos model without issuing any network writes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'energydeck-sonos-'));
try {
  const binary = path.join(temp, 'test');
  execFileSync('c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror',
    path.join(__dirname, 'test-sonos-local.cpp'), '-o', binary], {stdio: 'inherit'});
  execFileSync(binary, [], {stdio: 'inherit'});
  const music = fs.readFileSync(path.join(__dirname, '../esphome/packages/music.yaml'), 'utf8');
  const image = music.split('\nimage:')[1].split('\nscript:')[0];
  if (/Authorization:/.test(image)) throw new Error('Homey credentials must never be sent to Sonos artwork');
  if (!music.includes('advancedflow/${homey_radio_flow_id}/trigger')) throw new Error('Radio must retain its Homey Flow');
} finally { fs.rmSync(temp, {recursive: true, force: true}); }
