
const $ = (selector) => document.querySelector(selector);
const cards = [...document.querySelectorAll('.scene-card')];
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const storage = {get(key){try{return localStorage.getItem(key)}catch{return null}},set(key,value){try{localStorage.setItem(key,value)}catch{}}};
let selected = cards.find(card=>card.getAttribute('aria-pressed')==='true') || cards[0];
let paused = storage.get('codex-pet-gallery-paused')==='true';
let reduced = storage.get('codex-pet-gallery-reduced') == null ? motionPreference.matches : storage.get('codex-pet-gallery-reduced')==='true';
let filter = 'all';
function motion(){
  const still = paused || reduced;
  for(const image of document.querySelectorAll('.scene-image')){
    const path = 'codex-pet-'+image.dataset.scene+(still?'.svg':'.gif');
    if(image.getAttribute('src')!==path) image.src=path;
  }
  $('#play-toggle').textContent=reduced?'Motion reduced':paused?'Play animations':'Pause animations';
  $('#play-toggle').disabled=reduced;
  $('#play-toggle').setAttribute('aria-pressed',String(!still));
  $('#reduce-motion').checked=reduced;
  $('#motion-status').textContent=reduced?'Reduced motion · static preview':paused?'Paused · static preview':'Playing · seamless loop';
}
function choose(card){
  selected=card;
  for(const other of cards)other.setAttribute('aria-pressed',String(other===card));
  const id=card.dataset.scene;
  $('#preview-image').dataset.scene=id;
  $('#preview-image').alt='Codex Pet '+card.dataset.label;
  $('#preview-title').textContent=card.dataset.label;
  $('#preview-category').textContent=card.dataset.kind==='core'?'CANONICAL STATE':'EXTRA SCENE';
  $('#preview-description').textContent=card.dataset.description;
  $('#preview-fps').textContent=card.dataset.fps+' fps';
  $('#preview-duration').textContent=card.dataset.duration?card.dataset.duration+'s':'Not recorded';
  $('#preview-recommended').textContent=card.dataset.recommended;
  $('#download-gif').href='codex-pet-'+id+'.gif';
  $('#download-svg').href='codex-pet-'+id+'.svg';
  $('#asset-url').value='https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/codex-pet-'+id+'.gif?v=smooth-1';
  $('#copy-status').textContent='Use this URL in your Codex Pet asset settings.';
  motion();
}
function applyFilters(){
  const family=$('#family-filter').value, query=$('#scene-search').value.toLowerCase().trim();
  let count=0;
  for(const card of cards){
    const matches=(filter==='all'||card.dataset.kind===filter)&&(family==='all'||card.dataset.family===family)&&(!query||(card.dataset.label+' '+card.dataset.description).toLowerCase().includes(query));
    card.hidden=!matches;if(matches)count++;
  }
  for(const group of document.querySelectorAll('.scene-section'))group.hidden=![...group.querySelectorAll('.scene-card')].some(card=>!card.hidden);
  $('#scene-count').textContent=count+' '+(count===1?'scene':'scenes');
  $('#empty-scenes').hidden=count>0;
}
for(const card of cards){card.addEventListener('click',()=>choose(card));card.addEventListener('keydown',event=>{
  const shown=cards.filter(item=>!item.hidden);let index=shown.indexOf(card);
  if(event.key==='ArrowRight'||event.key==='ArrowDown')index=(index+1)%shown.length;
  else if(event.key==='ArrowLeft'||event.key==='ArrowUp')index=(index-1+shown.length)%shown.length;
  else if(event.key==='Home')index=0;else if(event.key==='End')index=shown.length-1;else return;
  event.preventDefault();shown[index]?.focus();
})}
for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>{
  filter=button.dataset.filter;
  for(const other of document.querySelectorAll('[data-filter]'))other.setAttribute('aria-pressed',String(other===button));
  applyFilters();
});
$('#family-filter').addEventListener('change',applyFilters);$('#scene-search').addEventListener('input',applyFilters);
$('#play-toggle').addEventListener('click',()=>{paused=!paused;storage.set('codex-pet-gallery-paused',String(paused));motion()});
$('#reduce-motion').addEventListener('change',()=>{reduced=$('#reduce-motion').checked;storage.set('codex-pet-gallery-reduced',String(reduced));motion()});
motionPreference.addEventListener('change',()=>{if(storage.get('codex-pet-gallery-reduced')==null){reduced=motionPreference.matches;motion()}});
function background(value){document.body.dataset.background=value;document.documentElement.dataset.theme=value==='light'?'light':'dark';$('#background-select').value=value;storage.set('codex-pet-gallery-background',value)}
$('#background-select').addEventListener('change',()=>background($('#background-select').value));
$('#copy-url').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($('#asset-url').value);$('#copy-status').textContent='GIF URL copied. Ready for your presence settings.'}
  catch{$('#asset-url').focus();$('#asset-url').select();$('#copy-status').textContent='Select and copy the URL above.'}
});
const savedBackground=storage.get('codex-pet-gallery-background');background(['dark','light','checkerboard'].includes(savedBackground)?savedBackground:'dark');choose(selected);applyFilters();
