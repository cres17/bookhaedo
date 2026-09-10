import {chromium} from '@playwright/test';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{const page=await browser.newPage({viewport:{width:1720,height:1430},deviceScaleFactor:1});await page.goto(pathToFileURL(path.resolve('docs/api-flow.svg')).href);await page.screenshot({path:'docs/api-flow.png'});console.log('API diagram rendered at 1720 × 1430.');}finally{await browser.close();}
