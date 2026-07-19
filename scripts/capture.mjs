// 로컬 웹 화면 캡처 — 스크린샷 + 핵심 요소의 computed style
// 사용법: node scripts/capture.mjs <url> [outPrefix=reports/web] [width=1440] [scale=1]
//
// 종료 코드: 0=성공, 1=인자/URL 오류, 2=접속 실패, 3=타임아웃, 4=기타 캡처 오류
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_ELEMENTS = 200; // JSON·토큰 폭발 방지 상한 (면적 큰 순 정렬 후 상위 200개로 충분)

const [, , url, outPrefix = 'reports/web', widthArg, scaleArg, modeArg] = process.argv;
const visualOnly = modeArg === 'visual' || scaleArg === 'visual';

if (!url) {
  console.error('usage: node scripts/capture.mjs <url> [outPrefix] [width] [scale]');
  process.exit(1);
}

// URL 유효성 검사
let parsed;
try {
  parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('http/https URL만 지원');
} catch (e) {
  console.error(`잘못된 URL: ${url} — ${e.message}`);
  process.exit(1);
}

const width = Number(widthArg) > 0 ? Number(widthArg) : 1440;
const scale = Number(scaleArg) > 0 ? Number(scaleArg) : 1;
mkdirSync(dirname(outPrefix), { recursive: true });

let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    deviceScaleFactor: scale, // QA용 선명한 캡처
  });

  // load 이벤트까지 대기(이미지/CSS 포함). HMR 웹소켓이 있어도 load는 발생하므로 안 걸림.
  const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  if (response && !response.ok()) {
    const status = response.status();
    if (status === 401 || status === 403) {
      console.error(`접속 오류 (HTTP ${status}): ${url} — 서버가 인증을 요구합니다. VPN 연결 또는 로그인 후 재시도하세요.`);
    } else {
      console.error(`접속 오류 (HTTP ${status}): ${url} — 서버가 오류 응답을 반환했습니다.`);
    }
    await browser.close();
    process.exit(2);
  }
  // 네트워크가 잠잠해지면 좋지만, 안 끝나도(HMR 등) 그냥 진행
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

  // lazy-load(IntersectionObserver) 콘텐츠 유발용 자동 스크롤 후 최상단 복귀.
  // window 뿐 아니라 "내부 스크롤 컨테이너"(overflow:auto/scroll 인 div 등)도 함께 스크롤한다.
  // 모바일 웹뷰형 페이지는 body가 아니라 내부 div가 스크롤되므로 window만 굴리면 lazy 콘텐츠가 안 뜬다.
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const vh = window.innerHeight;
    // 페이지 수준 스크롤러 후보: 문서 + 뷰포트 절반 이상이며 실제로 더 긴 overflow 컨테이너.
    // 단 position:fixed/absolute 는 제외 — 고정 헤더·메뉴 서랍·모달 같은 "오버레이"지 본문 스크롤러가 아니다.
    const isInFlowScroller = (el) => {
      const cs = getComputedStyle(el);
      const inFlow = cs.position === 'static' || cs.position === 'relative' || cs.position === 'sticky';
      return (
        inFlow &&
        /(auto|scroll|overlay)/.test(cs.overflowY) &&
        el.scrollHeight > el.clientHeight + 50 &&
        el.clientHeight >= vh * 0.5
      );
    };
    const scrollers = document.scrollingElement ? [document.scrollingElement] : [];
    for (const el of document.querySelectorAll('*')) {
      if (isInFlowScroller(el)) scrollers.push(el);
    }
    // 각 스크롤러를 끝까지 굴려 lazy-load 유발 (최대 60스텝/스크롤러)
    for (const sc of scrollers) {
      let prev = -1;
      let iter = 0;
      while (sc.scrollTop !== prev && iter < 60) {
        prev = sc.scrollTop;
        sc.scrollTop += sc.clientHeight || vh;
        iter += 1;
        await sleep(60);
      }
      sc.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  });

  // 애니메이션/트랜지션 정지로 캡처 안정화
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`,
  });
  // 폰트 로딩 완료 대기 (FontFaceSet은 직렬화 불가 → boolean 반환)
  await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true));
  await page.waitForTimeout(300);

  // 내부 스크롤 컨테이너 "펼치기": fullPage가 상단만 찍는 문제 해결.
  // 모바일 웹뷰형 페이지는 내부 div가 스크롤되어 body 높이가 viewport 한 칸뿐 → fullPage가 잘린다.
  // html/body 잠금을 풀고, "흐름에 있는" 페이지 스크롤러만 펼친다.
  // ⚠️ position:fixed/absolute 요소(고정 헤더·메뉴 서랍·모달)는 건드리지 않는다.
  //    이를 흐름에 끼워 넣으면(예: fixed nav → relative) 콘텐츠와 푸터 사이에 빈 영역이 생겨 캡처가 깨진다.
  const expand = await page.evaluate(() => {
    const vh = window.innerHeight;
    const imp = (el, prop, val) => el.style.setProperty(prop, val, 'important');
    // html/body 의 높이·overflow 잠금 해제 (대부분의 웹뷰형 페이지는 이것만으로 전체가 펼쳐진다)
    for (const el of [document.documentElement, document.body]) {
      imp(el, 'height', 'auto');
      imp(el, 'min-height', '0');
      imp(el, 'max-height', 'none');
      imp(el, 'overflow', 'visible');
    }
    let count = 0;
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const inFlow = cs.position === 'static' || cs.position === 'relative' || cs.position === 'sticky';
      const isScroller =
        inFlow &&
        /(auto|scroll|overlay)/.test(cs.overflowY) &&
        el.scrollHeight > el.clientHeight + 50 &&
        el.clientHeight >= vh * 0.5;
      if (!isScroller) continue;
      imp(el, 'height', 'auto');
      imp(el, 'max-height', 'none');
      imp(el, 'overflow', 'visible');
      count += 1;
    }
    void document.body.offsetHeight; // 강제 리플로우
    return { expanded: count, height: document.documentElement.scrollHeight };
  });
  if (expand.expanded > 0) {
    await page.waitForTimeout(300); // 리플로우/지연 이미지 안정화
  }

  // 뷰포트를 페이지 전체 높이로 늘려 스크롤 라이브러리(Lenis 등) 우회.
  // fullPage:true 는 스크롤하며 이어붙이는 방식이라 scroll-hijack 사이트에서 하단이 잘린다.
  // 뷰포트 자체를 페이지 높이로 설정하면 스크롤 없이 전체가 한 번에 렌더된다.
  const fullH = Math.min(expand.height, 16000); // Chromium 캔버스 상한
  if (fullH > 900) {
    // 뷰포트 확장 전에 100vh 요소를 현재 높이로 고정.
    // setViewportSize 후 100vh가 재계산되어 hero 등이 fullH만큼 늘어나는 현상 방지.
    await page.evaluate(() => {
      const vh = window.innerHeight;
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (Math.abs(parseFloat(cs.height) - vh) < 2)
          el.style.setProperty('height', `${Math.round(vh)}px`, 'important');
        if (Math.abs(parseFloat(cs.minHeight) - vh) < 2)
          el.style.setProperty('min-height', `${Math.round(vh)}px`, 'important');
      }
    });
    await page.setViewportSize({ width, height: fullH });
    await page.waitForTimeout(200);
  }

  await page.screenshot({ path: `${outPrefix}.png`, fullPage: true });

  if (visualOnly) {
    await browser.close();
    console.log(`captured: ${outPrefix}.png (visual-only) · 전체 높이 ${expand.height}px`);
    process.exit(0);
  }

  // 비교에 의미 있는 요소만 computed style 추출
  const data = await page.evaluate((MAX) => {
    const PROPS = [
      'color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight',
      'lineHeight', 'letterSpacing', 'textAlign',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
      'borderRadius', 'borderTopWidth', 'borderColor',
      'display', 'gap', 'opacity', 'boxShadow',
    ];
    const COMPONENT = new Set([
      'button', 'a', 'input', 'select', 'textarea', 'label', 'img', 'svg',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li',
      'header', 'nav', 'footer', 'section', 'article',
    ]);
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;

      let text = '';
      for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent;
      text = text.trim().replace(/\s+/g, ' ').slice(0, 80);

      const tag = el.tagName.toLowerCase();
      const hasBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      const hasBorder = parseFloat(cs.borderTopWidth) > 0;
      if (!text && !COMPONENT.has(tag) && !hasBg && !hasBorder) continue;

      const styles = {};
      for (const p of PROPS) styles[p] = cs[p];

      out.push({
        tag,
        id: el.id || undefined,
        class: typeof el.className === 'string' && el.className ? el.className : undefined,
        text: text || undefined,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        styles,
      });
    }
    // 면적 큰 순으로 정렬 후 상한 적용 (큰 컴포넌트 우선 보존)
    out.sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h);
    const totalFound = out.length;
    const truncated = totalFound > MAX;
    return {
      url: location.href,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      page: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
      capturedAt: new Date().toISOString(),
      totalFound,
      truncated,
      elements: truncated ? out.slice(0, MAX) : out,
    };
  }, MAX_ELEMENTS);

  writeFileSync(`${outPrefix}-styles.json`, JSON.stringify(data, null, 2));
  await browser.close();

  const note = data.truncated
    ? ` (요소 ${data.totalFound}개 중 상위 ${MAX_ELEMENTS}개만 기록 — 잘림)`
    : '';
  const expandNote = expand.expanded > 0
    ? ` · 내부 스크롤 컨테이너 ${expand.expanded}개 펼침(전체 높이 ${expand.height}px)`
    : ` · 전체 높이 ${expand.height}px`;
  console.log(`captured: ${outPrefix}.png + ${outPrefix}-styles.json — ${data.elements.length} elements${note}${expandNote}`);
} catch (e) {
  await browser?.close().catch(() => {});
  const msg = String(e?.message || e);
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED|net::ERR_CONNECTION/.test(msg)) {
    console.error(`접속 실패: ${url} 에 연결할 수 없습니다. 로컬 서버가 실행 중인지 확인하세요.`);
    process.exit(2);
  }
  if (/Timeout|timeout/.test(msg)) {
    console.error(`타임아웃: ${url} 로딩이 너무 오래 걸립니다. URL/서버 상태를 확인하세요.`);
    process.exit(3);
  }
  console.error(`캡처 오류: ${msg}`);
  process.exit(4);
}
