// Bonus scenes share only source poses; each has its own semantic pixel prop.
// All positions are continuous periodic functions. Pixel rounding adds no blur.
const blue = [116,161,245], pale = [229,240,255], mint = [126,232,188], pink = [247,139,153], gold = [248,207,116], dark = [44,62,103];
export function drawBonusScene({state,phase,turn,rect,glyph,spark,card}) {
  const wave = Math.sin(phase), pulse = (1 - Math.cos(phase)) / 2;
  const line = (x,y,tx,ty,color=blue) => {
    const steps = Math.max(Math.abs(tx-x),Math.abs(ty-y));
    for(let i=0;i<=steps;i++)rect(x+(tx-x)*i/steps,y+(ty-y)*i/steps,2,2,color);
  };
  const ring = (x,y,r,color=pale) => {
    for(let i=0;i<32;i++){const a=i/32*Math.PI*2;rect(x+Math.cos(a)*r,y+Math.sin(a)*r,2,2,color);}
  };
  if(state==='reading') {
    const y=6+wave*2;
    rect(5,y,32,20,dark);rect(7,y+2,12,16,pale);rect(21,y+2,14,16,pale);rect(19,y+1,2,19,blue);
    for(let i=0;i<3;i++){rect(9,y+5+i*4,7,1,blue);rect(24,y+5+i*4,8,1,blue);}
    rect(21-pulse*8,y+2,2,16,mint);rect(33,y+15,2,8,pink);
  } else if(state==='searching') {
    rect(150,3,34,25,dark);
    for(let i=0;i<3;i++)for(let j=0;j<4;j++)rect(154+j*7,7+i*6,4,3,pale);
    rect(153+pulse*22,5,5,21,mint);
    const x=15+wave*3,y=23+Math.cos(phase)*3;ring(x,y,7);line(x+5,y+5,x+11,y+11,blue);
  } else if(state==='terminal') {
    rect(4,5,35,23,dark);rect(6,7,31,3,blue);
    glyph(['#..','.#.','..#','.#.','#..'],8,13,1,mint);
    rect(15,17,4+pulse*17,2,pale);rect(15,22,7+Math.sin(phase+1)*3,1,blue);
    rect(175,63+wave*8,8,2,mint);
  } else if(state==='testing') {
    rect(3,4,37,26,dark);
    for(let y=0;y<2;y++)for(let x=0;x<3;x++) {
      const pass=pulse>(x+y*3)/7;
      rect(6+x*11,7+y*11,9,9,pass?mint:blue);
      if(pass)glyph(['..#','#.#','.#.'],8+x*11,10+y*11,1,dark);
    }
    spark(174,15+wave*3,mint);
  } else if(state==='building') {
    for(let i=0;i<5;i++) {
      const x=i<3?5+i*10:10+(i-3)*10,y=26-(i<3?0:9)-pulse*(i<3?2:7);
      rect(x,y,9,7,i%2?blue:mint);rect(x+2,y-2,5,2,pale);
    }
    rect(155,18-pulse*10,23,7,blue);rect(160,8-pulse*5,13,8,mint);
  } else if(state==='installing') {
    const y=5+wave*2;
    rect(150,y+15,36,10,dark);rect(153,y+18,30*pulse,4,mint);
    glyph(['..##..','..##..','######','.####.','..##..'],7,8+wave*3,2,blue);
    rect(7,23,12,2,pale);
  } else if(state==='reviewing') {
    rect(4,3,34,27,dark);rect(6,5,30,23,pale);
    for(let i=0;i<4;i++){
      rect(9,8+i*5,10,2,i%2?pink:mint);rect(22,8+i*5,10,2,i%2?mint:pink);
    }
    rect(6,6+pulse*18,30,2,blue);
    glyph(['....#','...#.','#.#..','.#...'],170,10+wave*3,2,mint);
  } else if(state==='debugging') {
    const x=18+wave*3,y=17+Math.cos(phase)*2;
    ring(x,y,10);line(x+7,y+7,x+15,y+15,blue);
    rect(x-2,y-4,5,8,pink);rect(x-5,y-2,11,2,pink);rect(x-4,y+3,9,1,pink);
    rect(154,5,29,21,dark);for(let i=0;i<3;i++)rect(158,9+i*5,11+pulse*8,2,i===1?pink:blue);
  } else if(state==='connecting') {
    const nodes=[[8,8],[34,10],[20,30]];
    line(...nodes[0],...nodes[1]);line(...nodes[1],...nodes[2]);line(...nodes[2],...nodes[0]);
    for(const[x,y]of nodes){rect(x-3,y-3,8,8,dark);rect(x-1,y-1,4,4,mint);}
    rect(8+pulse*26,8+pulse*2,4,4,pale);
    for(let i=0;i<3;i++)rect(158+i*8,14+Math.sin(phase+i)*5,4,4,i===1?mint:blue);
  } else if(state==='focus') {
    for(let i=0;i<12;i++) {
      const a=phase/1+i*Math.PI/6;rect(96+Math.cos(a)*86,82+Math.sin(a)*70,2,2,i%3?blue:pale);
    }
    glyph(['..#..','.###.','#####','.###.','..#..'],9,12+wave*2,1,mint);
  } else if(state==='celebrating') {
    spark(14,12+wave*4,gold);spark(172,16-wave*4,gold);
    for(let i=0;i<5;i++){const a=phase+i*Math.PI*2/5;rect(96+Math.cos(a)*83,76+Math.sin(a)*55,2,3,[mint,gold,pink][i%3]);}
  } else if(state==='idle-cozy') {
    const y=6+wave*2;
    glyph(['..####.','.###...','###....','###....','###....','.###...','..####.'],157,y,2,gold);
    for(let i=0;i<3;i++){const size=1+Math.round((1+Math.sin(phase+i*2))/2);rect(7+i*11,7+i*6,size,size,pale);}
    rect(181,38+wave*2,2,2,blue);
  } else return false;
  return true;
}
