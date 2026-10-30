// Articulate paws sampled from the original laptop pose. The head, torso outline,
// feet and laptop stay registered to one frame; only the keyboard/hand area moves.
export const typingRegion = { left: 67, top: 144, right: 103, bottom: 172 };
const outline = [[68,155],[74,151],[81,151],[88,155],[91,161],[85,166],[70,166]];
function inside(x,y) {
  let hit=false;
  for(let i=0,j=outline.length-1;i<outline.length;j=i++) {
    const [ax,ay]=outline[i],[bx,by]=outline[j];
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)hit=!hit;
  }
  return hit;
}
export function typingSprite(original, elapsedMs, width=192) {
  const frame=Buffer.from(original), phase=((elapsedMs%800)+800)%800;
  const stroke=(offset)=>{const t=((phase+offset)%800)/400;return t<1?-4*Math.sin(Math.PI*t)**2:0;};
  const sample=(x,y)=>original.subarray((y*width+x)*4,(y*width+x)*4+4);
  const set=(x,y,pixel)=>frame.set(pixel,(y*width+x)*4);
  const edge=y=>Math.round(139-y*.245);
  // Reveal the chest and dark keyboard deck beneath the old static paw.
  for(let y=149;y<=167;y++)for(let x=67;x<=98;x++) {
    if(x>=edge(y))continue;
    set(x,y,y>=164?sample(72,170):sample(x,144+Math.min(3,Math.floor((y-149)/4))));
  }
  const paw=(far,lift)=>{
    for(let y=151;y<=166;y++)for(let x=68;x<=91;x++) {
      if(!inside(x+.5,y+.5))continue;
      const reach=(x-68)/23;
      const px=far?Math.round(100-(x-68)*.72):x;
      const py=far?Math.round(148+(y-151)*.75+lift*reach):Math.round(y+lift*reach);
      if(px<67||px>103||py<144||py>172||px>=edge(py))continue;
      set(px,py,sample(x,y));
    }
  };
  paw(true,stroke(400));
  paw(false,stroke(0));
  // A key lights only on contact, without moving the laptop itself.
  const key=(x,pressed)=>{if(pressed)for(let dx=0;dx<3;dx++)set(x+dx,167,[126,232,188,255]);};
  key(77,phase<50||phase>750); key(89,Math.abs(phase-400)<50);
  return frame;
}
