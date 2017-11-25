const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');
const EOL = require('os').EOL;
const readline = require('readline');
const adapters = { 'http:': require('http'), 'https:': require('https') };
const colorCodes = { 'cyan': 36, 'red': 31, 'green': 32, 'yellow': 33};
const colorize = (msg, color) => '\x1b[' + colorCodes[color] + 'm' + msg + '\x1b[0m';
const out = console.log;
const header = `
-----------------------------------
Wordpress media library backup tool
-----------------------------------
`;

process.on('uncaughtException', err => {});

function echo(msg, color, close, url) {
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(colorize(msg.padEnd(13), color));
    if (url)    process.stdout.write(url);
    if (close)  process.stdout.write(EOL);
}

function checkLastMod(currUrl, localPath, cb) {
    let localMod = 0;
    try {
        const stats = fs.statSync(localPath);
        localMod = new Date(stats.mtime).getTime();
    }
    catch(err) {}

    const options = { method: 'HEAD', host: currUrl.hostname, path: currUrl.pathname };
    const req = adapters[currUrl.protocol].request(options, 
        res => cb((new Date(res.headers['last-modified']).getTime() || 0) < localMod));
    req.on('error', err => { throw err });
    req.end();
}

function downloadResource(currUrl, ws) {
    const req = adapters[currUrl.protocol].request({ method: 'GET', host: currUrl.hostname, path: currUrl.pathname });
    req.on('response', res => {
        if (res.statusCode === 200) res.pipe(ws);
        else {
            echo('NOT FOUND', 'red', true);
            ws.emit('error', new Error(404));
        }
    });
    req.end();
}

function download(url, dirname, cb) {
    const currUrl   = new URL(url);
    const pathname  = currUrl.pathname;
    const filename  = path.basename(pathname);
    const destdir   = path.resolve(path.join(dirname, path.dirname(pathname)));
    const localPath = path.join(destdir, filename);

    echo('DOWNLOADING', 'yellow', false, currUrl.href);

    fs.ensureDir(destdir, () => {
        checkLastMod(currUrl, localPath, skip => {
            if (skip === true) return cb(['SKIPPED', 'cyan', true]);

            const ws = fs.createWriteStream(localPath);
            ws.on('finish', () => cb(['DOWNLOADED', 'green', true]));
            ws.on('error', err => { fs.unlink(localPath); cb(); });

            downloadResource(currUrl, ws);
        });
    });
}

function backup() {
    out(header);
    
    const [xmlFile = 'export.xml', dirname = 'backup'] = process.argv.slice(2);
    const xml = fs.readFileSync(xmlFile).toString();
    const re = /<wp:attachment_url>(.+)<\/wp:attachment_url>/g;
    let match, urls = [];
    while (match = re.exec(xml)) urls.push(match[1]);
    if (!urls.length) return echo('No URLs found', 'red', true);

    const iterator = function*() { let idx = 0; while (idx < urls.length) yield urls[idx++]; }();
    const start = processUrl = msg => {
        const url = iterator.next();
        if (msg) echo(...msg);
        if (url.done) {
            out('---');
            console.timeEnd('Total download time');
            process.exit(0);
        }
        download(url.value, dirname, processUrl);
    };

    console.time('Total download time');
    start();
}

backup();