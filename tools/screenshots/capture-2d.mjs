import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const b = await chromium.launch({ executablePath:'/usr/bin/google-chrome-stable', headless:true, args:['--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport:{width:1100,height:760}, deviceScaleFactor:2 });
await p.goto('http://localhost:5199/2d.html',{waitUntil:'load'});
await p.waitForFunction(()=>{const s=document.getElementById('status')?.textContent||'';return s.includes('layers');},null,{timeout:30000});
await p.waitForTimeout(300);
const url = await p.evaluate(()=>{
  const layer=document.getElementById('layer'); const ghost=document.getElementById('ghost');
  layer.value=String(Math.round(Number(layer.max)*0.5)); layer.dispatchEvent(new Event('input'));
  ghost.value='2'; ghost.dispatchEvent(new Event('input'));
  const c=document.getElementById('view');
  // lit bbox
  const s=document.createElement('canvas'); s.width=c.width; s.height=c.height;
  const sx=s.getContext('2d'); sx.drawImage(c,0,0);
  const d=sx.getImageData(0,0,c.width,c.height).data;
  let minX=c.width,minY=c.height,maxX=0,maxY=0;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(d[i]+d[i+1]+d[i+2]>40){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}}
  const pad=Math.round((maxX-minX)*0.12)+8;
  minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);maxX=Math.min(c.width,maxX+pad);maxY=Math.min(c.height,maxY+pad);
  const sw=maxX-minX, sh=maxY-minY;
  // output: fit crop into 1000x750 preserving aspect, dark bg
  const OW=1000, OH=750; const o=document.createElement('canvas'); o.width=OW;o.height=OH;
  const ox=o.getContext('2d'); ox.fillStyle='#0e1416'; ox.fillRect(0,0,OW,OH);
  const scale=Math.min(OW/sw, OH/sh); const dw=sw*scale, dh=sh*scale;
  ox.imageSmoothingEnabled=true;
  ox.drawImage(c, minX,minY,sw,sh, (OW-dw)/2,(OH-dh)/2, dw,dh);
  return o.toDataURL('image/png');
});
writeFileSync('../../docs/media/canvas-2d-fallback.png', Buffer.from(url.split(',')[1],'base64'));
await b.close(); console.log('2d saved');
