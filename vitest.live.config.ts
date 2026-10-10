import {defineConfig} from 'vitest/config';
export default defineConfig({resolve:{preserveSymlinks:true},test:{include:['tests/live/*.test.ts'],pool:'threads',isolate:false,fileParallelism:false,maxWorkers:1,testTimeout:120000,hookTimeout:120000}});
