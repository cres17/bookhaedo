import {readFile} from 'node:fs/promises';
import {pool,migrate} from '../server/db.js';
try{await pool.query(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));await migrate();console.log('Database schema ready (catalog data not imported).');}finally{await pool.end();}
