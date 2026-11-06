import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apps } from '../catalog.js';

test('the hub serves and isolates every app on one public port', async () => {
  const dataDir=mkdtempSync(join(tmpdir(),'app-hub-'));
  process.env.DATA_DIR=dataDir;
  const { createHub, closeApps }=await import('../server.js');
  const server=createHub();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const home=await fetch(base+'/');
    assert.equal(home.status,200);
    assert.match(await home.text(),/모아플레이/);
    const list=await (await fetch(base+'/api/apps')).json();
    assert.equal(list.length,apps.length);
    assert.equal(apps.length,37);
    for(const app of apps) {
      const page=await fetch(base+app.url);
      assert.equal(page.status,200,`${app.id} page`);
      const html=await page.text();
      assert.match(html,/앱 허브/,`${app.id} return link`);
      assert.match(html,new RegExp(`/apps/${app.id}/(?:app\\.js|styles?\\.css)`),`${app.id} asset path`);
      const health=await fetch(base+app.url+'api/health');
      assert.equal(health.status,200,`${app.id} API`);
    }
    const lexijs=await (await fetch(base+'/apps/lexi/app.js')).text();
    assert.match(lexijs,/\/apps\/lexi\/api/);
    assert.match(lexijs,/\/apps\/lexi\/game\.js/);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await closeApps();
    rmSync(dataDir,{recursive:true,force:true});
  }
});
