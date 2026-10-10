import {defineConfig} from 'vitest/config';
export default defineConfig({resolve:{preserveSymlinks:true},test:{pool:'threads',isolate:false,fileParallelism:false,maxWorkers:1,include:['tests/*.test.ts'],testTimeout:20000}});
