// Compile and exercise the price model used by the production display.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'energydeck-price-day-'));
try {
  const binary = path.join(dir, 'test');
  execFileSync('c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', path.join(__dirname, 'test-price-day.cpp'), '-o', binary]);
  process.stdout.write(execFileSync(binary));
} finally { fs.rmSync(dir, {recursive: true, force: true}); }
