import {preview} from 'vite';
import {spawn} from 'node:child_process';

const server=await preview({preview:{host:'127.0.0.1',port:5184,strictPort:true}});
try{
 const child=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test','tests/browser/offline.spec.ts','--reporter=list'],{
  stdio:'inherit',windowsHide:true,
  env:{...process.env,VELMORY_TEST_URL:'http://127.0.0.1:5184',VELMORY_OFFLINE_TEST:'1'},
 });
 process.exitCode=await new Promise((resolve,reject)=>{
  child.on('error',reject);child.on('exit',code=>resolve(code??1));
 });
}finally{await new Promise(resolve=>server.httpServer.close(resolve))}
