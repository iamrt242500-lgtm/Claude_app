const categories=[['all','전체'],['games','게임'],['life','생활'],['work','생산성'],['money','금융'],['tools','도구'],['social','소셜'],['favorites','즐겨찾기']];
const tabs=document.getElementById('tabs'),grid=document.getElementById('grid'),search=document.getElementById('search');
const count=document.getElementById('count'),empty=document.getElementById('empty'),featured=document.getElementById('featured');
let apps=[],category='all';
const key='moaplay:favorites';
const favorites=()=>{try{return new Set(JSON.parse(localStorage.getItem(key)||'[]'))}catch{return new Set()}};
function saveFavorite(id){const set=favorites();set.has(id)?set.delete(id):set.add(id);localStorage.setItem(key,JSON.stringify([...set]));render()}
function card(app){
 const item=document.createElement('article');item.className='card';
 const top=document.createElement('div');top.className='card-top';
 const icon=document.createElement('span');icon.className='icon';icon.textContent=app.icon;
 const star=document.createElement('button');star.className='favorite';star.type='button';star.textContent=favorites().has(app.id)?'★':'☆';star.setAttribute('aria-label',`${app.name} 즐겨찾기 ${favorites().has(app.id)?'해제':'추가'}`);star.setAttribute('aria-pressed',String(favorites().has(app.id)));star.addEventListener('click',()=>saveFavorite(app.id));top.append(icon,star);
 const title=document.createElement('h3');title.textContent=app.name;
 const desc=document.createElement('p');desc.textContent=app.description;
 const link=document.createElement('a');link.className='open';link.href=app.url;link.textContent='열기 ↗';link.setAttribute('aria-label',`${app.name} 열기`);
 item.append(top,title,desc,link);return item;
}
function render(){
 tabs.replaceChildren();
 for(const [id,label] of categories){const b=document.createElement('button');b.type='button';b.textContent=label;b.className=id===category?'active':'';b.setAttribute('aria-pressed',String(id===category));b.addEventListener('click',()=>{category=id;render()});tabs.append(b)}
 const term=search.value.trim().toLocaleLowerCase(), fav=favorites();
 const shown=apps.filter(a=>(category==='all'||category===a.category||category==='favorites'&&fav.has(a.id))&&(`${a.name} ${a.description}`.toLocaleLowerCase().includes(term)));
 grid.replaceChildren(...shown.map(card));count.textContent=`${shown.length}개`;empty.hidden=shown.length>0;
 const games=apps.filter(a=>a.category==='games');featured.hidden=category!=='all'||!!term;
 if(!featured.hidden){featured.replaceChildren();const label=document.createElement('div');label.className='featured-label';label.innerHTML='<small>LET’S PLAY</small><strong>가볍게 한 판?</strong><span>지금 즐길 수 있는 게임</span>';featured.append(label,...games.slice(0,3).map(a=>{const link=document.createElement('a');link.href=a.url;link.className='featured-game';const icon=document.createElement('span');icon.textContent=a.icon;const name=document.createElement('strong');name.textContent=a.name;link.append(icon,name);return link}))}
}
search.addEventListener('input',render);
fetch('/api/apps').then(r=>{if(!r.ok)throw Error('앱 목록을 불러올 수 없습니다.');return r.json()}).then(data=>{apps=data;render()}).catch(e=>{empty.hidden=false;empty.textContent=e.message});
