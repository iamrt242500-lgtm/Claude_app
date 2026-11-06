import { createServer, request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { apps, appIds } from './catalog.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hubDir = join(root, 'hub', 'public');
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
const password = process.env.ACCESS_PASSWORD || '';
const instances = new Map();
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8' };
const headers = { 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY' };
const safeEq = (a,b) => { const x=Buffer.from(a), y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); };
function authorized(req) {
  if (!password) return true;
  const h=req.headers.authorization || '';
  const given=h.startsWith('Basic ') ? Buffer.from(h.slice(6),'base64').toString() : '';
  return safeEq(given,`hub:${password}`) || safeEq(given,`hindsight:${password}`);
}
function send(res,status,body,type='text/plain; charset=utf-8',extra={}) {
  res.writeHead(status,{...headers,'Content-Type':type,'Cache-Control':'no-store',...extra});
  res.end(body);
}
function start(id) {
  if (instances.has(id)) return instances.get(id);
  const pending=(async()=>{
    const path=id==='hindsight' ? './src/server.js' : `./apps/${id}/src/server.js`;
    const { createApp }=await import(new URL('../'+path.slice(2), import.meta.url));
    mkdirSync(dataDir,{recursive:true});
    const {server,db}=createApp({dbPath:join(dataDir,`${id}.db`),password:id==='hindsight' ? '' : undefined});
    await new Promise((ok,fail)=>{ server.once('error',fail); server.listen(0,'127.0.0.1',ok); });
    return {server,db,port:server.address().port};
  })().catch(e=>{instances.delete(id);throw e;});
  instances.set(id,pending);
  return pending;
}
function rewrite(body,type,prefix,id) {
  let s=body.toString('utf8');
  if(type.includes('text/html')) {
    s=s.replace(/((?:src|href|action)=["'])\/(?!\/)/gi,`$1${prefix}/`);
    const app=apps.find(item=>item.id===id);
    const bar=`<div id="hub-shell-bar" data-category="${app.category}"><a class="hub-shell-home" href="/" aria-label="모아플레이 홈"><span class="hub-shell-mark" aria-hidden="true">✦</span><span>모아플레이</span></a><span class="hub-shell-divider" aria-hidden="true"></span><span class="hub-shell-app"><span aria-hidden="true">${app.icon}</span> ${app.name}</span><a class="hub-shell-all" href="/">모든 앱 <span aria-hidden="true">↗</span></a></div>`;
    s=s.replace(/<\/head>/i,`<link rel="stylesheet" href="/hub/chrome.css"></head>`);
    s=s.replace(/<body>/i,`<body class="hub-app hub-category-${app.category}">${bar}`);
  } else if(type.includes('javascript')) {
    s=s.replace(/(['"`])\/(api(?=\/|['"`])|[a-zA-Z0-9_-]+\.js(?=['"`])|s\/)/g,(_,q,p)=>q+prefix+'/'+p);
  } else if(type.includes('text/css')) {
    s=s.replace(/url\((['"]?)\/(?!\/)/g,(_,q)=>`url(${q}${prefix}/`);
  }
  return Buffer.from(s);
}
async function proxy(req,res,id,relative) {
  const {port}=await start(id), prefix=`/apps/${id}`;
  const upstream=httpRequest({hostname:'127.0.0.1',port,method:req.method,path:relative || '/',headers:{...req.headers,host:req.headers.host,connection:'close'}},r=>{
    const type=String(r.headers['content-type'] || '');
    const transform=/text\/html|javascript|text\/css/.test(type);
    const outHeaders={...r.headers};
    delete outHeaders['content-length']; delete outHeaders['content-encoding'];
    if(transform) delete outHeaders['transfer-encoding'];
    if(outHeaders.location?.startsWith('/')) outHeaders.location=prefix+outHeaders.location;
    if(outHeaders['set-cookie']) outHeaders['set-cookie']=[].concat(outHeaders['set-cookie']).map(c=>c.replace(/Path=\//i,`Path=${prefix}/`));
    if(!transform){res.writeHead(r.statusCode || 502,outHeaders);r.pipe(res);return;}
    const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>{
      const body=rewrite(Buffer.concat(chunks),type,prefix,id);
      res.writeHead(r.statusCode || 502,{...outHeaders,'content-length':body.length});
      res.end(body);
    });
  });
  upstream.on('error',e=>{console.error(id,e);if(!res.headersSent) send(res,502,'앱을 열 수 없습니다.');else res.end();});
  req.pipe(upstream);
}
export async function closeApps() {
  const started=await Promise.allSettled([...instances.values()]);
  await Promise.all(started.filter(x=>x.status==='fulfilled').map(async ({value})=>{
    await new Promise(resolve=>value.server.close(resolve));
    value.db?.close?.();
  }));
  instances.clear();
}
export function createHub() {
  return createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost'), path=url.pathname;
      if(path==='/api/health') return send(res,200,JSON.stringify({ok:true}),'application/json; charset=utf-8');
      if(!authorized(req)) return send(res,401,'Authentication required','text/plain; charset=utf-8',{'WWW-Authenticate':'Basic realm="App Hub"'});
      if(path==='/api/apps') return send(res,200,JSON.stringify(apps),'application/json; charset=utf-8');
      if(path==='/') return send(res,200,readFileSync(join(hubDir,'index.html')),MIME['.html']);
      if(/^\/hub\/(app.js|styles.css|chrome.css)$/.test(path)) {
        const file=path.slice(5), ext=file.slice(file.lastIndexOf('.'));
        return send(res,200,readFileSync(join(hubDir,file)),MIME[ext]);
      }
      const match=/^\/apps\/([a-z0-9-]+)(\/.*)?$/.exec(path);
      if(match && appIds.has(match[1])) {
        if(!match[2]) return send(res,308,'','text/plain',{Location:`/apps/${match[1]}/${url.search}`});
        return await proxy(req,res,match[1],match[2]+url.search);
      }
      send(res,404,'페이지를 찾을 수 없습니다.');
    } catch(e) {console.error(e); if(!res.headersSent) send(res,500,'서버 오류가 발생했습니다.');else res.end();}
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const server=createHub(), port=Number(process.env.PORT)||3000;
  server.listen(port,'0.0.0.0',()=>console.log(`App Hub listening on :${port}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(async()=>{await closeApps();process.exit(0)}));
}

