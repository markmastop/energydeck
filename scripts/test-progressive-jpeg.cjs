// Offline synthetic fixtures exercise the production bounded stb decoder.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'energydeck-stb-'));
try {
  execFileSync(path.join(root, '.venv/bin/python'), ['-c', `
from PIL import Image
import sys
from pathlib import Path
p=Path(sys.argv[1])
for name,w,h,progressive,mode in [('baseline',300,300,False,'RGB'),('progressive300',300,300,True,'RGB'),('progressive600',600,600,True,'RGB'),('gray',64,64,True,'L'),('wide',641,20,True,'RGB'),('too-many-pixels',640,640,True,'RGB')]:
 im=Image.new(mode,(w,h))
 im.putdata([((x*7%256,y*11%256,(x+y)*3%256) if mode=='RGB' else (x+y)%256) for y in range(h) for x in range(w)])
 im.save(p/(name+'.jpg'),progressive=progressive,quality=85)
`, temp]);
  const binary = path.join(temp, 'test');
  execFileSync('c++', ['-std=c++17', '-O1', '-g', '-fsanitize=address,undefined',
    path.join(__dirname, 'test-progressive-jpeg.cpp'),
    path.join(root, 'esphome/components/online_image/progressive_jpeg.cpp'), '-o', binary], {stdio:'inherit'});
  execFileSync(binary, [temp, ...process.argv.slice(2)], {stdio:'inherit', env:{...process.env, UBSAN_OPTIONS:'halt_on_error=1'}});
  console.log('PASS: baseline routing, full progressive RGB/grayscale, size/budget limits, truncation, output failure and recovery (ASan/UBSan)');
} finally { fs.rmSync(temp, {recursive:true, force:true}); }
