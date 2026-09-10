import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
export default defineConfig({root:'frontend',envDir:process.cwd(),plugins:[vue()],server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':'http://127.0.0.1:3001'}},build:{outDir:'../dist',emptyOutDir:true},resolve:{alias:{'@':path.resolve('frontend/src')}}});
