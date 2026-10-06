import http from 'node:http';
// mode: invalid-tree (400 like the CI incident) | unavailable (503) 
const mode = process.argv[2], port = Number(process.argv[3]);
http.createServer((req, res) => {
  let n = 0; req.on('data', () => n++); req.on('end', () => {
    console.error(mode, req.method, req.url);
    if (mode === 'invalid-tree') { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ statusCode: 400, error: 'Bad Request', message: 'Invalid package tree, run  npm install  to rebuild your package-lock.json' })); }
    else { res.writeHead(503, { 'content-type': 'text/plain' }); res.end('Service Unavailable'); }
  });
}).listen(port, '127.0.0.1');
