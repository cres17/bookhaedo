import {readFile} from 'node:fs/promises';
import {Parser} from '@dbml/core';
const model=Parser.parseDBMLToJSONv2(await readFile('docs/erd.dbml','utf8'));
const day=model.tables.find(t=>t.name==='trip_day'&&t.schemaName==='planner');
if(!day?.fields.some(f=>f.name==='revision'))throw Error('Missing day revision in DBML');
console.log('DBML valid:',model.tables.length,'tables');
