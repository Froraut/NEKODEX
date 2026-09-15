// Deterministic PNG cutout of the approved artwork; no image regeneration.
const fs = require('node:fs');
const { PNG } = require(process.env.PNGJS_PATH || 'pngjs');
const path = require('node:path');
const dir = path.resolve(__dirname, '../../launcher/src/assets');
const source = PNG.sync.read(fs.readFileSync(path.join(dir, 'cat-workspace.png')));
const base = PNG.sync.read(fs.readFileSync(path.join(dir, 'cat-workspace-base.png')));
const out = new PNG({width:160,height:330});
const pixel = (image,x,y,c=0) => image.data[(y*image.width+x)*4+c];
const delta = (x,y) => pixel(source,x,y)-pixel(base,x,y);
for(let y=0;y<out.height;y++) for(let x=0;x<out.width;x++) {
  const sx=x+380, sy=y+420, i=(y*out.width+x)*4;
  if(sx>510 || delta(sx,sy)<5) continue;
  const core = [[-1,0],[1,0],[0,-1],[0,1]].every(([dx,dy])=>delta(sx+dx,sy+dy)>20);
  const a=core ? 1 : Math.min(1,Math.max(0,delta(sx,sy)/(73-pixel(base,sx,sy))));
  for(let c=0;c<3;c++) out.data[i+c]=Math.max(0,Math.min(255,(pixel(source,sx,sy,c)-pixel(base,sx,sy,c)*(1-a))/Math.max(.01,a)));
  out.data[i+3]=Math.round(a*255);
}
// Extend only the hidden root underneath the laptop, excluding its bright border.
for(let y=625;y<749;y++) {
  const sample=((y-420)*out.width+(508-380))*4;
  if(out.data[sample+3]<200) continue;
  for(let x=509;x<540;x++) for(let c=0;c<4;c++) out.data[((y-420)*out.width+x-380)*4+c]=out.data[sample+c];
}
fs.writeFileSync(path.join(dir,'cat-tail.png'),PNG.sync.write(out));
