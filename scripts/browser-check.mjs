import {createServer} from 'vite';
import {spawn} from 'node:child_process';
const port=Number(process.env.VELMORY_TEST_PORT||5183);
const server=await createServer({server:{host:'127.0.0.1',port,strictPort:true}});
try{
 await server.listen();
 const child=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test','--reporter=list'],{stdio:'inherit',windowsHide:true,env:{...process.env,VELMORY_TEST_URL:`http://127.0.0.1:${port}`}});
 process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve(code??1))});
}finally{await server.close()}
