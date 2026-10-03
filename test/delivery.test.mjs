import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const require=createRequire(import.meta.url);
for(const format of ['esm','cjs']) test(`compiler ${format} entries share reactive state and DOM tables`,async()=>{
 const load=name=>format==='esm'?import(`../dist/${name}.js`):require(`../dist/${name}.cjs`);
 const api=await load('index'),web=await load('web'),tables=await load('dom-tables');
 assert.equal(web.getOwner,api.getOwner);
 assert.equal(web.ChildProperties,tables.ChildProperties);
 assert.equal(tables.ChildProperties.has('innerHTML'),true);
 let dispose,read,set;
 api.createRoot(stop=>{dispose=stop;[read,set]=api.createSignal(1);});
 assert.equal(read(),1);set(7);api.flush();assert.equal(read(),7);
 assert.equal(typeof dispose,'function');dispose();
});
