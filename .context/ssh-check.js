const { Client } = require('ssh2');

const conn = new Client();

const commands = [
  'node -v',
  'dir "D:\\Proma-dev\\resources" /b',
  'type "D:\\Proma-dev\\resources\\app.asar.unpacked\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\package.json"',
  'dir "D:\\Proma-dev\\resources\\app.asar.unpacked\\node_modules\\@anthropic-ai" /b',
  'dir "D:\\Proma-dev\\resources\\app.asar.unpacked" /b',
  'dir "D:\\Proma-dev\\resources\\app" /b /s 2>&1 | findstr /i "sdk\|anthropic\|version"',
  'ver',
  'dir "D:\\Proma-dev\\resources\\app.asar.unpacked\\node_modules" /b',
  'wmic os get Caption,Version,OSArchitecture /value',
];

let current = 0;

function runNext(stream) {
  if (current >= commands.length) {
    conn.end();
    return;
  }
  const cmd = commands[current];
  console.log(`\n=== [${current}] ${cmd} ===`);
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error('exec err:', err); conn.end(); return; }
    let out = '';
    stream.on('data', (d) => { out += d.toString(); });
    stream.stderr.on('data', (d) => { out += d.toString(); });
    stream.on('close', () => {
      console.log(out.trim());
      current++;
      runNext();
    });
  });
}

conn.on('ready', () => {
  console.log('Connected to LAN');
  runNext();
});

conn.on('error', (err) => { console.error('Connection error:', err); });

conn.connect({
  host: '192.168.3.25',
  port: 22,
  username: 'user',
  password: 'Abc!123',
  readyTimeout: 10000,
});
