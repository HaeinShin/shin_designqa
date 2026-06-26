// 디자인 QA 런처 서버 — 새 의존성 없이 Node 내장 http만 사용.
// 브라우저에서 Figma URL·웹 URL을 입력받아 일감 파일(reports/_qa_request.json)을 쓰고,
// 인터랙티브 Claude 세션의 감시 루프가 그 일감을 집어 design-qa를 돌린다.
// 완료되면 감시 루프가 reports/_qa_result.json을 남기고, 런처가 그 결과를 받아 리포트를 연다.
//
// 사용법: node scripts/qa-server.mjs [port=4567]
//   서버는 figma를 직접 읽지 않는다(헤드리스는 OAuth 미인증). figma 읽기는 세션이 담당.

import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORTS = join(ROOT, 'reports');
const REQ_FILE = join(REPORTS, '_qa_request.json');
const RES_FILE = join(REPORTS, '_qa_result.json');
const LAUNCHER = join(__dirname, 'launcher.html');

const PORT = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 4567;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf-8');
}

// reports/ 밖으로 나가는 경로 접근 차단
function safeReportPath(rel) {
  const p = normalize(join(REPORTS, rel));
  return p.startsWith(REPORTS) ? p : null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    // 런처 페이지
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      return send(res, 200, await readFile(LAUNCHER), MIME['.html']);
    }

    // 일감 등록: 버튼이 호출
    if (req.method === 'POST' && path === '/run') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const figmaUrl = String(body.figmaUrl || '').trim();
      const webUrl = String(body.webUrl || '').trim();
      if (!/^https?:\/\//.test(figmaUrl) || !/^https?:\/\//.test(webUrl)) {
        return send(res, 400, JSON.stringify({ error: 'figmaUrl·webUrl 둘 다 http(s) URL이어야 해요.' }), MIME['.json']);
      }
      const id = `qa_${Date.now()}`;
      const request = {
        id,
        figmaUrl,
        webUrl,
        width: Number(body.width) > 0 ? Number(body.width) : null,
        scale: Number(body.scale) > 0 ? Number(body.scale) : null,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      await writeFile(REQ_FILE, JSON.stringify(request, null, 2));
      // 이전 결과는 비워서 폴링이 옛 결과를 집지 않게
      await writeFile(RES_FILE, JSON.stringify({ id, status: 'pending' }, null, 2));
      return send(res, 200, JSON.stringify({ id }), MIME['.json']);
    }

    // 결과 폴링: 런처가 호출. 요청/결과 파일을 합쳐 현재 상태를 돌려줌.
    if (req.method === 'GET' && path === '/result') {
      const id = url.searchParams.get('id');
      let request = null, result = null;
      try { if (existsSync(REQ_FILE)) request = JSON.parse(await readFile(REQ_FILE, 'utf-8')); } catch {}
      try { if (existsSync(RES_FILE)) result = JSON.parse(await readFile(RES_FILE, 'utf-8')); } catch {}
      // request가 비워졌고 result가 done이면 완료
      const reqStat = existsSync(REQ_FILE) ? await stat(REQ_FILE) : null;
      const out = {
        id,
        requestStatus: request?.status ?? 'none',
        result: result && result.id === id ? result : null,
        requestAgeSec: reqStat ? Math.round((Date.now() - reqStat.mtimeMs) / 1000) : null,
      };
      return send(res, 200, JSON.stringify(out), MIME['.json']);
    }

    // 리포트 및 산출물 정적 제공: /reports/<file>
    if (req.method === 'GET' && path.startsWith('/reports/')) {
      const rel = decodeURIComponent(path.slice('/reports/'.length));
      const file = safeReportPath(rel);
      if (!file || !existsSync(file)) return send(res, 404, '없음');
      const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
      return send(res, 200, await readFile(file), type);
    }

    return send(res, 404, '없음');
  } catch (e) {
    send(res, 500, JSON.stringify({ error: String(e?.message || e) }), MIME['.json']);
  }
});

server.listen(PORT, () => {
  const addr = `http://localhost:${PORT}`;
  console.log(`디자인 QA 런처: ${addr}`);
  console.log(`Claude 창에서  /loop 30s /qa-watch  를 한 번 켜 두세요 (그래야 버튼이 동작해요).`);
  // macOS: 런처 페이지 자동 열기 (한 단계 줄이기)
  if (process.platform === 'darwin') spawn('open', [addr], { stdio: 'ignore', detached: true }).unref();
});
