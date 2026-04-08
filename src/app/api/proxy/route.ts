import { NextRequest, NextResponse } from 'next/server';

/** fetch/XHR 요청을 프록시 경유로 리라이트 (CORS·404 방지) - 최상단 head에 주입 */
function buildFetchProxyScript(proxyOrigin: string, targetOrigin: string, baseHref: string) {
  return `<script data-geo-injected="true">
(function(){
  var PROXY_ORIGIN=${JSON.stringify(proxyOrigin)};
  var TARGET_ORIGIN=${JSON.stringify(targetOrigin)};
  var BASE_HREF=${JSON.stringify(baseHref)};
  function toProxy(u){
    if(!u||/^(javascript:|mailto:|tel:|#|data:|blob:)/.test(String(u).trim()))return null;
    if(String(u).indexOf('/api/proxy?url=')!==-1)return null;
    try{
      var abs=new URL(u,BASE_HREF).href;
      if(abs.indexOf(TARGET_ORIGIN)!==0&&abs.indexOf(PROXY_ORIGIN)!==0)return null;
      if(abs.indexOf(PROXY_ORIGIN)===0&&abs.indexOf('/api/proxy')===-1){
        abs=TARGET_ORIGIN+(new URL(abs).pathname||'');
      }
      return abs.indexOf(TARGET_ORIGIN)===0?PROXY_ORIGIN+'/api/proxy?url='+encodeURIComponent(abs):null;
    }catch(e){return null;}
  }
  var _f=window.fetch;
  if(_f){
    function looksLikeJsonRequest(url){
      try{
        var path=(typeof url==='string'?url:(url&&url.url)||'').toLowerCase();
        return /\\/(api|config|json|webpush|firebase|manifest|sw\\.js|vapid)/.test(path)||path.indexOf('config')!==-1;
      }catch(e){return false;}
    }
    window.fetch=function(u,o){
      var p=toProxy(u);
      var url=p||u;
      return _f.call(this,url,o).then(function(r){
        if(!looksLikeJsonRequest(u))return r;
        var ct=(r.headers.get('Content-Type')||'').toLowerCase();
        if(ct.indexOf('application/json')!==-1)return r;
        if(ct.indexOf('text/html')!==-1||r.status===404){
          return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});
        }
        return r;
      });
    };
  }
  var Xhr=window.XMLHttpRequest;
  if(Xhr){
    var _open=Xhr.prototype.open;
    Xhr.prototype.open=function(m,u){
      var p=toProxy(u);
      return _open.apply(this,[m,p||u].concat([].slice.call(arguments,2)));
    };
  }
  // history.replaceState/pushState: 크로스 오리진 URL 시 SecurityError 방지 (iframe sandbox)
  var _rs=history.replaceState,_ps=history.pushState;
  function safeHistory(fn){
    return function(){
      try{
        var u=arguments[2];
        if(u&&typeof u==='string'){
          try{
            var parsed=new URL(u,location.origin);
            if(parsed.origin!==location.origin)return;
          }catch(e){}
        }
        fn.apply(history,arguments);
      }catch(e){}
    };
  }
  if(_rs)history.replaceState=safeHistory(_rs);
  if(_ps)history.pushState=safeHistory(_ps);
})();
</script>`;
}

function buildPositionScript(proxyOrigin: string) {
  return `
<script data-geo-injected="true">
(function() {
  var PROXY_ORIGIN = ${JSON.stringify(proxyOrigin)};

  // iframe 탈출 방지
  try {
    if (window.top !== window.self) {
      Object.defineProperty(window, 'top', { get: function() { return window.self; } });
    }
  } catch(e) {}

  function toProxyUrl(rawUrl) {
    if (!rawUrl || /^(javascript:|mailto:|tel:|data:|#|blob:)/.test(rawUrl)) return null;
    if (rawUrl.indexOf('/api/proxy?url=') !== -1) return null;
    try {
      var abs = new URL(rawUrl, document.baseURI || window.location.href).href;
      if (abs.indexOf(PROXY_ORIGIN) === 0) return null;
      return PROXY_ORIGIN + '/api/proxy?url=' + encodeURIComponent(abs);
    } catch(e) { return null; }
  }

  // 링크 클릭 인터셉트 (폴백)
  document.addEventListener('click', function(e) {
    var anchor = e.target;
    while (anchor && anchor.tagName !== 'A') {
      anchor = anchor.parentElement;
    }
    if (!anchor || !anchor.href) return;
    var proxy = toProxyUrl(anchor.href);
    if (!proxy) return;
    e.preventDefault();
    e.stopPropagation();
    window.location.href = proxy;
  }, true);

  // form submit 인터셉트
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    if ((form.method || 'GET').toUpperCase() !== 'GET') return;
    e.preventDefault();
    var params = new URLSearchParams(new FormData(form)).toString();
    var action = form.action || window.location.href;
    var proxy = toProxyUrl(action);
    if (!proxy) return;
    var sep = proxy.indexOf('?') === -1 ? '?' : '&';
    window.location.href = proxy + (params ? sep + params : '');
  }, true);

  // window.open 오버라이드
  var _origOpen = window.open;
  window.open = function(url) {
    var proxy = toProxyUrl(url);
    if (proxy) { window.location.href = proxy; return window; }
    return _origOpen.apply(window, arguments);
  };

  // JS 기반 location 이동 인터셉트
  var _origAssign = window.location.assign;
  var _origReplace = window.location.replace;
  if (_origAssign) {
    window.location.assign = function(url) {
      var proxy = toProxyUrl(url);
      _origAssign.call(window.location, proxy || url);
    };
  }
  if (_origReplace) {
    window.location.replace = function(url) {
      var proxy = toProxyUrl(url);
      _origReplace.call(window.location, proxy || url);
    };
  }

  function sendPositions() {
    var elements = [];
    var selectors = ['h1','h2','h3','h4'];
    for (var s = 0; s < selectors.length; s++) {
      var sel = selectors[s];
      var nodes = document.querySelectorAll(sel);
      for (var i = 0; i < nodes.length; i++) {
        var rect = nodes[i].getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        elements.push({
          selector: sel,
          index: i,
          text: (nodes[i].textContent || '').substring(0, 80).trim(),
          rect: {
            top: rect.top + window.scrollY,
            left: rect.left + window.scrollX,
            width: rect.width,
            height: rect.height
          }
        });
      }
    }

    var titleEl = document.querySelector('title');
    var descEl = document.querySelector('meta[name="description"]');
    var canonEl = document.querySelector('link[rel="canonical"]');
    var ogTitleEl = document.querySelector('meta[property="og:title"]');
    var ogDescEl = document.querySelector('meta[property="og:description"]');

    window.parent.postMessage({
      type: 'GEO_ELEMENT_POSITIONS',
      elements: elements,
      hasTitle: !!(titleEl && titleEl.textContent && titleEl.textContent.trim()),
      hasDescription: !!(descEl && descEl.getAttribute('content')),
      hasCanonical: !!(canonEl && canonEl.getAttribute('href')),
      hasOgTitle: !!(ogTitleEl && ogTitleEl.getAttribute('content')),
      hasOgDescription: !!(ogDescEl && ogDescEl.getAttribute('content')),
      scrollHeight: document.documentElement.scrollHeight || document.body.scrollHeight || 3000
    }, '*');
  }

  function notifyNavigation() {
    try {
      var params = new URLSearchParams(window.location.search);
      var realUrl = params.get('url');
      if (realUrl) {
        window.parent.postMessage({
          type: 'GEO_PAGE_NAVIGATED',
          url: realUrl
        }, '*');
      }
    } catch(e) {}
  }

  function highlightGoldenParagraphs() {
    var golden = typeof window.__GEO_GOLDEN_CHUNKS !== 'undefined' ? window.__GEO_GOLDEN_CHUNKS : [];
    var reasons = typeof window.__GEO_GOLDEN_REASONS !== 'undefined' ? window.__GEO_GOLDEN_REASONS : [];
    if (!Array.isArray(golden) || golden.length === 0) return;
    var sel = 'main p, article p, .content p, #content p, [role="main"] p';
    var paras = document.querySelectorAll(sel);
    if (paras.length < 3) paras = document.querySelectorAll('body p');
    for (var i = 0; i < golden.length; i++) {
      var idx = golden[i];
      if (idx >= 0 && idx < paras.length) {
        var el = paras[idx];
        el.classList.add('geo-golden-paragraph');
        var reason = (reasons[i] && String(reasons[i]).trim()) ? String(reasons[i]).trim() : 'AI 분석 기반 고품질 문단';
        el.setAttribute('data-geo-reason', reason);
      }
    }
    attachGoldenTooltips();
  }

  function attachGoldenTooltips() {
    var paras = document.querySelectorAll('.geo-golden-paragraph');
    var tooltip = null;
    function createTooltip() {
      if (tooltip) return tooltip;
      tooltip = document.createElement('div');
      tooltip.className = 'geo-tooltip';
      tooltip.style.display = 'none';
      document.body.appendChild(tooltip);
      return tooltip;
    }
    function showTooltip(text, x, y) {
      var t = createTooltip();
      t.textContent = text;
      t.style.left = (x + 12) + 'px';
      t.style.top = (y + 12) + 'px';
      t.style.display = 'block';
    }
    function hideTooltip() {
      if (tooltip) tooltip.style.display = 'none';
    }
    for (var i = 0; i < paras.length; i++) {
      (function(el) {
        var reason = el.getAttribute('data-geo-reason') || 'AI 분석 기반 고품질 문단';
        el.addEventListener('mouseenter', function(e) {
          showTooltip(reason, e.clientX, e.clientY);
        });
        el.addEventListener('mousemove', function(e) {
          if (tooltip && tooltip.style.display === 'block') {
            tooltip.style.left = (e.clientX + 12) + 'px';
            tooltip.style.top = (e.clientY + 12) + 'px';
          }
        });
        el.addEventListener('mouseleave', hideTooltip);
      })(paras[i]);
    }
  }

  function init() {
    highlightGoldenParagraphs();
    notifyNavigation();
    setTimeout(sendPositions, 800);
    setTimeout(sendPositions, 2000);
    setTimeout(sendPositions, 4000);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }

  var scrollTimer;
  window.addEventListener('scroll', function() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(sendPositions, 100);
  }, { passive: true });

  window.addEventListener('resize', function() {
    setTimeout(sendPositions, 200);
  });
})();
</script>
<style data-geo-injected="true">
.geo-golden-paragraph {
  border-left: 4px solid #fbbf24 !important;
  background: rgba(251,191,36,0.08) !important;
  padding-left: 12px !important;
  margin-left: -12px !important;
  box-shadow: 0 0 20px rgba(251,191,36,0.15) !important;
  cursor: help !important;
}
.geo-tooltip {
  position: fixed;
  z-index: 10000;
  max-width: 320px;
  padding: 8px 12px;
  background: #000;
  color: #fff;
  font-size: 12px;
  line-height: 1.5;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  pointer-events: none;
}
</style>
`;
}

/** HTML 엔티티가 섞인 URL을 올바른 URL로 복원 (예: &amp; → &) */
function decodeUrlHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export async function GET(req: NextRequest) {
  let url = req.nextUrl.searchParams.get('url');
  const goldenParam = req.nextUrl.searchParams.get('golden') ?? '';
  const reasonsParam = req.nextUrl.searchParams.get('reasons') ?? '';
  const goldenIndices = goldenParam
    ? goldenParam.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n >= 0)
    : [];
  const reasons = reasonsParam ? reasonsParam.split('||').map((s) => s.trim()) : [];

  if (!url) {
    return NextResponse.json({ error: 'url 파라미터가 필요합니다.' }, { status: 400 });
  }
  url = decodeUrlHtmlEntities(url);

  // 템플릿 플레이스홀더(%src%, %url% 등) 거부 — %EA%, %EB 등 퍼센트 인코딩(앞 1자+뒤 1자)은 허용
  if (/%[a-zA-Z_][a-zA-Z0-9_]{2,}%/.test(url)) {
    return NextResponse.json({ error: '유효하지 않은 URL입니다.' }, { status: 400 });
  }

  try {
    const proxyOrigin = req.nextUrl.origin;
    const parsedUrl = new URL(url);
    const targetOrigin = parsedUrl.origin;
    const baseHref = parsedUrl.origin + parsedUrl.pathname.replace(/\/[^/]*$/, '/');

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.google.com/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      // Gather upstream metadata
      const finalUrl = response.url || url;
      const upstreamStatus = response.status;
      const upstreamStatusText = response.statusText || '';
      const upstreamHeaders: Record<string, string | null> = {
        'content-type': response.headers.get('content-type'),
        server: response.headers.get('server'),
        via: response.headers.get('via'),
        'x-amz-cf-id': response.headers.get('x-amz-cf-id'),
        'x-amz-cf-pop': response.headers.get('x-amz-cf-pop'),
        'x-reference-error': response.headers.get('x-reference-error'),
      };

      // Read a safe snippet of the body for diagnostics (first 500 chars)
      let bodySnippet = '';
      try {
        const text = await response.text();
        bodySnippet = text ? text.substring(0, 500) : '';
      } catch (e) {
        bodySnippet = '';
      }

      // Classify error type
      let errorType: 'WAF_BLOCK' | 'CLOUDFRONT_ERROR' | 'INTERSTITIAL' | 'NOT_FOUND' | 'UNKNOWN' = 'UNKNOWN';
      const bodyLower = (bodySnippet || '').toLowerCase();
      const serverHeader = (upstreamHeaders.server || '')?.toLowerCase() ?? '';
      if (upstreamStatus === 404) {
        errorType = 'NOT_FOUND';
      } else if (/akamai|akamaighost|AkamaiGHost/i.test(String(upstreamHeaders.server || '')) || upstreamHeaders['x-reference-error']) {
        errorType = 'WAF_BLOCK';
      } else if (upstreamHeaders['x-amz-cf-id' as keyof typeof upstreamHeaders] || (upstreamHeaders.via && String(upstreamHeaders.via).toLowerCase().includes('cloudfront')) || upstreamStatus >= 500) {
        errorType = 'CLOUDFRONT_ERROR';
      }
      if (/(access denied|forbidden|waf|captcha|interstitial|robot or human|please enable javascript)/i.test(bodyLower)) {
        errorType = 'INTERSTITIAL';
      }

      // Server-side debug log
      console.error('[Proxy Error]');
      console.error('  URL:', url);
      console.error('  Final URL:', finalUrl);
      console.error('  Status:', upstreamStatus, upstreamStatusText);
      console.error('  ErrorType:', errorType);
      console.error('  Key headers:', JSON.stringify(upstreamHeaders, null, 2));
      console.error('  Body snippet:', bodySnippet.replace(/\n/g, '\\n').slice(0, 500));

      // Structured JSON response for diagnostics (do not mask upstream info)
      return NextResponse.json(
        {
          ok: false,
          upstreamStatus,
          upstreamStatusText,
          finalUrl,
          errorType,
          upstreamHeaders,
          errorSnippet: bodySnippet,
        },
        { status: 502 }
      );
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    // HTML이 아닌 리소스(CSS, JS, 이미지, JSON 등)는 그대로 전달 (HTML 치환 시 깨짐 방지)
    const isNonHtml =
      contentType.includes('text/css') ||
      contentType.includes('application/javascript') ||
      contentType.includes('application/json') ||
      contentType.includes('text/json') ||
      contentType.includes('application/xml') ||
      contentType.includes('text/xml') ||
      contentType.includes('image/') ||
      contentType.includes('font/') ||
      contentType.includes('application/font') ||
      /\.(css|js|json|xml|jpg|jpeg|png|gif|webp|svg|ico|woff2?|ttf|eot)(\?|$)/i.test(pathname);
    if (isNonHtml) {
      const blob = await response.blob();
      return new NextResponse(blob, {
        status: 200,
        headers: {
          'Content-Type': contentType.split(';')[0].trim() || 'application/octet-stream',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    let html = await response.text();

    // HTML만 아래 치환 수행
    // 기존 <base> 태그 제거 후 새로 삽입
    html = html.replace(/<base[^>]*>/gi, '');

    // CSP 메타 태그 제거
    html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, '');

    // iframe 탈출 스크립트 무력화
    html = html.replace(
      /if\s*\(\s*(?:window\.)?top\s*!==?\s*(?:window\.)?self\s*\)/gi,
      'if(false)'
    );
    html = html.replace(
      /(?:window\.)?top\.location\s*[!=]/gi,
      'void(0)//'
    );

    // Google Cast / Presentation API 스크립트 제거 (iframe sandbox에서 SecurityError 유발, 사이트 깨짐 방지)
    html = html.replace(/<script[^>]*src\s*=\s*["'][^"']*cast_sender[^"']*["'][^>]*>\s*<\/script>/gi, '');
    html = html.replace(/<script[^>]*src\s*=\s*["'][^"']*remote\.js[^"']*["'][^>]*>\s*<\/script>/gi, '');

    // Cloudflare rocket-loader 제거 (프록시 환경에서 에러 유발)
    html = html.replace(/<script[^>]*rocket-loader[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/type\s*=\s*["']text\/rocketscript["']/gi, 'type="text/javascript"');

    // <base> + fetch/XHR 프록시 리라이트 (최우선) + 위치 스크립트 삽입
    const fetchProxyScript = buildFetchProxyScript(proxyOrigin, targetOrigin, baseHref);
    if (html.includes('<head')) {
      html = html.replace(
        /<head([^>]*)>/i,
        `<head$1><base href="${baseHref}" target="_self">${fetchProxyScript}`
      );
    } else if (html.includes('<html')) {
      html = html.replace(
        /<html([^>]*)>/i,
        `<html$1><head><base href="${baseHref}" target="_self"></head>`
      );
    } else {
      html = `<base href="${baseHref}" target="_self">` + html;
    }

    // 상대/동일 오리진 URL을 프록시 URL로 변환
    function toProxyUrlIfSameOrigin(href: string): string | null {
      if (!href || /^(javascript:|mailto:|tel:|#|data:|blob:)/.test(href.trim())) return null;
      try {
        const abs = new URL(href, targetOrigin + '/').href;
        if (!abs.startsWith(targetOrigin)) return null;
        return `${proxyOrigin}/api/proxy?url=${encodeURIComponent(abs)}`;
      } catch {
        return null;
      }
    }

    // <script> 블록을 보호한 뒤 URL 리라이팅, 이후 복원
    const scriptPlaceholders: string[] = [];
    html = html.replace(/<script[\s\S]*?<\/script>/gi, (match) => {
      const idx = scriptPlaceholders.length;
      scriptPlaceholders.push(match);
      return `<!--__GEO_SCRIPT_${idx}__-->`;
    });

    // <link href="..."> (CSS 등) 동일 오리진 → 프록시
    html = html.replace(
      /<link(\s[^>]*?)href\s*=\s*["']([^"']*?)["']([^>]*?)>/gi,
      (_match, before, href, after) => {
        const proxyHref = toProxyUrlIfSameOrigin(href);
        if (proxyHref) return `<link${before}href="${proxyHref}"${after}>`;
        return _match;
      }
    );

    // <script src="..."> 동일 오리진 → 프록시
    html = html.replace(
      /<script(\s[^>]*?)src\s*=\s*["']([^"']*?)["']([^>]*)>/gi,
      (_match, before, src, after) => {
        const proxySrc = toProxyUrlIfSameOrigin(src);
        if (proxySrc) return `<script${before}src="${proxySrc}"${after}>`;
        return _match;
      }
    );

    // @import url(...) in inline style - 복잡하므로 스킵

    // 모든 <a href="...">를 프록시 절대 URL로 서버 사이드 리라이트
    html = html.replace(
      /<a(\s[^>]*?)href\s*=\s*["']([^"']*?)["']([^>]*?)>/gi,
      (_match, before, href, after) => {
        if (/^(javascript:|mailto:|tel:|#|data:)/.test(href.trim())) {
          return `<a${before}href="${href}"${after}>`;
        }
        try {
          const absoluteUrl = new URL(href, baseHref).href;
          const proxyHref = `${proxyOrigin}/api/proxy?url=${encodeURIComponent(absoluteUrl)}`;
          return `<a${before}href="${proxyHref}"${after}>`;
        } catch {
          return `<a${before}href="${href}"${after}>`;
        }
      }
    );

    // <form action="...">도 프록시 절대 URL로 리라이트
    html = html.replace(
      /<form(\s[^>]*?)action\s*=\s*["']([^"']*?)["']([^>]*?)>/gi,
      (_match, before, action, after) => {
        try {
          const absoluteUrl = new URL(action, baseHref).href;
          const proxyAction = `${proxyOrigin}/api/proxy?url=${encodeURIComponent(absoluteUrl)}`;
          return `<form${before}action="${proxyAction}"${after}>`;
        } catch {
          return `<form${before}action="${action}"${after}>`;
        }
      }
    );

    // <img src="...">, <use xlink:href="...">, <use href="..."> → 대상 사이트 URL을 프록시로 (same-origin 위반 방지)
    const rewriteToProxy = (url: string): string | null => {
      if (!url || /^(javascript:|mailto:|tel:|#|data:|blob:)/.test(url.trim())) return null;
      try {
        const abs = new URL(url, baseHref).href;
        if (!abs.startsWith(targetOrigin)) return null;
        return `${proxyOrigin}/api/proxy?url=${encodeURIComponent(abs)}`;
      } catch {
        return null;
      }
    };
    html = html.replace(/<img(\s[^>]*?)src\s*=\s*["']([^"']*?)["']([^>]*?)>/gi, (_m, b, src, a) => {
      const proxy = rewriteToProxy(src);
      return proxy ? `<img${b}src="${proxy}"${a}>` : _m;
    });
    html = html.replace(/<use(\s[^>]*?)xlink:href\s*=\s*["']([^"']*?)["']([^>]*?)>/gi, (_m, b, href, a) => {
      const proxy = rewriteToProxy(href);
      return proxy ? `<use${b}xlink:href="${proxy}"${a}>` : _m;
    });
    html = html.replace(/<use(\s[^>]*?)href\s*=\s*["']([^"']*?)["']([^>]*?)>/gi, (_m, b, href, a) => {
      const proxy = rewriteToProxy(href);
      return proxy ? `<use${b}href="${proxy}"${a}>` : _m;
    });

    // <script> 블록 복원
    html = html.replace(/<!--__GEO_SCRIPT_(\d+)__-->/g, (_m, idx) => {
      return scriptPlaceholders[parseInt(idx, 10)] ?? '';
    });

    const goldenScript = goldenIndices.length > 0
      ? `<script data-geo-injected="true">window.__GEO_GOLDEN_CHUNKS=${JSON.stringify(goldenIndices)};window.__GEO_GOLDEN_REASONS=${JSON.stringify(reasons)};</script>`
      : '';
    const posScript = buildPositionScript(proxyOrigin);
    if (html.includes('</body>')) {
      html = html.replace('</body>', `${goldenScript}${posScript}</body>`);
    } else if (html.includes('</html>')) {
      html = html.replace('</html>', `${posScript}</html>`);
    } else {
      html += posScript;
    }

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const errorHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0a0f1a;color:#6b7d96;font-family:system-ui;text-align:center">
<div>
<p style="font-size:14px;margin-bottom:8px">사이트를 불러올 수 없습니다</p>
<p style="font-size:11px;color:#374357">${err instanceof Error ? err.message : String(err)}</p>
</div>
</body></html>`;

    return new NextResponse(errorHtml, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

/** POST 요청 전달 (AJAX/XHR용) */
export async function POST(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url 파라미터가 필요합니다.' }, { status: 400 });

  const targetUrl = decodeUrlHtmlEntities(url);
  if (/%[a-zA-Z_][a-zA-Z0-9_]*%/.test(targetUrl)) {
    return NextResponse.json({ error: '유효하지 않은 URL입니다.' }, { status: 400 });
  }

  try {
    const contentType = req.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await req.json()
      : contentType.includes('application/x-www-form-urlencoded')
        ? await req.text()
        : await req.arrayBuffer();

    const headers: HeadersInit = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
    };
    if (contentType) headers['Content-Type'] = contentType;

    const init: RequestInit = {
      method: 'POST',
      headers,
      redirect: 'follow',
    };
    if (body && (typeof body === 'string' || body instanceof ArrayBuffer || (body && typeof body === 'object'))) {
      init.body = body as BodyInit;
    }

    const res = await fetch(targetUrl, init);
    const data = await res.arrayBuffer();
    return new NextResponse(data, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
