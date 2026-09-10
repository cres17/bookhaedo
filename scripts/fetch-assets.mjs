import {mkdir,writeFile} from 'node:fs/promises';
const url='https://upload.wikimedia.org/wikipedia/commons/c/c7/Yotei-zan-from-hirafu.jpg';
const response=await fetch(url);if(!response.ok)throw new Error('Photo download failed');
await mkdir('frontend/public/images',{recursive:true});
await writeFile('frontend/public/images/yotei.jpg',Buffer.from(await response.arrayBuffer()));
console.log('Saved Mount Yotei photo. Credit: Oga, CC BY-SA 3.0; linked in UI.');
