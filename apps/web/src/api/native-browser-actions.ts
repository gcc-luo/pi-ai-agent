import {
  navigateNativeBrowser,
  reloadNativeBrowser,
  runNativeBrowserScript,
} from "./native-browser.js";

type BrowserParams = Record<string, unknown>;

function quote(value: unknown): string {
  return JSON.stringify(String(value));
}

function pageScript<T>(sessionId: string, instanceId: string, body: string): Promise<T> {
  return runNativeBrowserScript<T>(sessionId, instanceId, `(() => { ${body} })()`);
}

function locatorScript(params: BrowserParams, action: string): string {
  const selector = typeof params.selector === "string" ? params.selector : undefined;
  const locator = typeof params.locator === "string" ? params.locator : undefined;
  const value = typeof params.value === "string" ? params.value : undefined;
  const name = typeof params.name === "string" ? params.name : undefined;
  const role = typeof params.role === "string" ? params.role : undefined;
  const text = typeof params.text === "string" ? params.text : undefined;
  const values = Array.isArray(params.values) ? params.values.filter((item): item is string => typeof item === "string") : [];
  const textArg = text ?? value ?? name ?? "";
  const selectorArg = selector ? quote(selector) : "null";
  const locatorArg = locator ? quote(locator) : "null";
  return `
    const selector = ${selectorArg};
    const locator = ${locatorArg};
    const value = ${quote(textArg)};
    const role = ${role ? quote(role) : "null"};
    const name = ${name ? quote(name) : "null"};
    const values = ${JSON.stringify(values)};
    const candidates = [...document.querySelectorAll('button,a,input,textarea,select,[role],[tabindex]')];
    const bySelector = (raw) => {
      if (!raw) return null;
      if (/^@[a-z]+\\d+$/i.test(raw)) return document.querySelector('[data-agent-ref="' + CSS.escape(raw.slice(1)) + '"]');
      try { return document.querySelector(raw); } catch { return null; }
    };
    const accessibleName = (el) => el.getAttribute('aria-label') || el.getAttribute('title') || el.labels?.[0]?.innerText || el.innerText || el.value || '';
    let element = bySelector(selector);
    if (!element && locator === 'label') element = candidates.find((el) => accessibleName(el).trim() === (value || name || '').trim()) || null;
    if (!element && locator === 'text') element = candidates.find((el) => (el.innerText || '').trim() === (value || name || '').trim()) || null;
    if (!element && locator === 'role') element = candidates.find((el) => (el.getAttribute('role') || ({button: el.matches('button') ? 'button' : '', link: el.matches('a') ? 'link' : '', textbox: el.matches('input,textarea') ? 'textbox' : '', checkbox: el.matches('input[type=checkbox]') ? 'checkbox' : ''})[el.tagName.toLowerCase()] || '').toLowerCase() === (role || '').toLowerCase() && (!name || accessibleName(el).trim() === name.trim())) || null;
    if (!element) throw new Error('未找到匹配的页面元素，请重新获取快照并检查定位器。');
    element.scrollIntoView({block:'center',inline:'center'});
    if (${quote(action)} === 'click') { element.click(); return {ok:true, tag:element.tagName.toLowerCase(), text:(element.innerText || '').trim().slice(0,500)}; }
    if (${quote(action)} === 'fill' || ${quote(action)} === 'type') {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) throw new Error('目标元素不可输入文本。');
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
        setter?.call(element, value);
      } else element.textContent = value;
      element.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:value}));
      element.dispatchEvent(new Event('change', {bubbles:true}));
      return {ok:true};
    }
    if (${quote(action)} === 'check' || ${quote(action)} === 'uncheck') {
      if (!(element instanceof HTMLInputElement) || element.type !== 'checkbox') throw new Error('目标元素不是复选框。');
      element.checked = ${action === "check" ? "true" : "false"};
      element.dispatchEvent(new Event('input', {bubbles:true})); element.dispatchEvent(new Event('change', {bubbles:true}));
      return {ok:true, checked:element.checked};
    }
    if (${quote(action)} === 'select') {
      if (!(element instanceof HTMLSelectElement)) throw new Error('目标元素不是下拉选择框。');
      const requested = values.length ? values : [value];
      const selected = [...element.options].filter((option) => requested.includes(option.value) || requested.includes(option.label));
      if (selected.length !== requested.length) throw new Error('下拉框中不存在请求的选项。');
      for (const option of element.options) option.selected = selected.includes(option);
      element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true}));
      return {ok:true, selected:selected.map((option)=>({value:option.value,label:option.label}))};
    }
    return {text:(element.innerText || element.value || '').trim()};
  `;
}

function textResult(text: string, data: Record<string, unknown> = {}) {
  return { text, data, isError: false };
}

async function executeArgCommand(
  sessionId: string,
  instanceId: string,
  args: string[],
) {
  if (!args.length) throw new Error("agent_browser args 不能为空。");
  const [command, ...rest] = args;
  if (command === "open" || command === "goto" || command === "navigate") {
    const rawUrl = rest.find((token) => token && !token.startsWith("-"));
    if (!rawUrl) throw new Error("open 命令需要网页地址。");
    const url = /^[a-z][a-z\d+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    if (!/^https?:\/\//i.test(url)) throw new Error("共享浏览器只允许打开 http 或 https 网页。");
    await navigateNativeBrowser(sessionId, instanceId, url);
    const deadline = Date.now() + 15_000;
    let page: { url?: string; readyState?: string; title?: string } | undefined;
    while (Date.now() < deadline) {
      try {
        page = await pageScript<{ url?: string; readyState?: string; title?: string }>(
          sessionId,
          instanceId,
          "return {url:location.href,readyState:document.readyState,title:document.title};",
        );
        if (page.url === url && (page.readyState === "interactive" || page.readyState === "complete")) break;
      } catch {
        // WebView navigation can temporarily make script evaluation unavailable.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
    return textResult(`已在共享浏览器中打开 ${url}`, {
      url: page?.url ?? url,
      title: page?.title,
      status: page?.url === url ? "loaded" : "navigating",
    });
  }
  if (command === "reload") {
    await reloadNativeBrowser(sessionId, instanceId);
    return textResult("已刷新当前页面。", { status: "reloading" });
  }
  if (command === "back" || command === "forward") {
    await pageScript(sessionId, instanceId, `history.${command}(); return {ok:true};`);
    return textResult(command === "back" ? "已返回上一页。" : "已前进到下一页。", { status: command });
  }
  if (command === "wait") {
    const duration = Math.max(0, Math.min(30_000, Number(rest[0]) || 0));
    await new Promise((resolve) => window.setTimeout(resolve, duration));
    return textResult(`已等待 ${duration} ms。`, { status: "waited" });
  }
  if (command === "get") {
    const target = rest[0];
    const data = await pageScript<Record<string, unknown>>(sessionId, instanceId, `
      const kind = ${quote(target)};
      if (kind === 'url') return {url: location.href};
      if (kind === 'title') return {title: document.title};
      if (kind === 'text') return {text: document.body?.innerText?.slice(0, 20000) || ''};
      if (kind === 'html') return {html: document.documentElement?.outerHTML?.slice(0, 20000) || ''};
      throw new Error('get 支持 url、title、text、html。');
    `);
    const value = Object.values(data)[0];
    return textResult(typeof value === "string" ? value : JSON.stringify(value), data);
  }
  if (command === "snapshot") {
    const data = await pageScript<{ url: string; title: string; snapshot: string }>(sessionId, instanceId, `
      const visible = (el) => { const r=el.getBoundingClientRect(), s=getComputedStyle(el); return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; };
      const nodes = [...document.querySelectorAll('a,button,input,textarea,select,[role],h1,h2,h3,[tabindex]')].filter(visible).slice(0,400);
      const lines = nodes.map((el, i) => {
        const ref='e'+(i+1); el.setAttribute('data-agent-ref', ref);
        const role=el.getAttribute('role') || (el.matches('button')?'button':el.matches('a')?'link':el.matches('input,textarea')?'textbox':el.matches('select')?'combobox':el.tagName.toLowerCase());
        const name=el.getAttribute('aria-label') || el.getAttribute('title') || el.labels?.[0]?.innerText || el.innerText || el.value || '';
        return '- '+role+' "'+String(name).trim().replace(/\\s+/g,' ').slice(0,180)+'" @'+ref;
      });
      return {url:location.href,title:document.title,snapshot:lines.join('\\n').slice(0,20000)};
    `);
    return textResult(`${data.title}\n${data.url}\n${data.snapshot}`, data);
  }
  if (["click", "fill", "type", "check", "uncheck", "text", "select"].includes(command!)) {
    const selectorIndex = rest.findIndex((item) => item.startsWith("@") || /[.#[]/.test(item));
    if (selectorIndex < 0) throw new Error(`${command} 命令缺少 CSS 选择器或 @ref。`);
    const selector = rest[selectorIndex]!;
    const value = rest.slice(selectorIndex + 1).join(" ");
    const data = await pageScript<Record<string, unknown>>(sessionId, instanceId, locatorScript({ selector, text: value }, command!));
    return textResult(JSON.stringify(data), data);
  }
  if (command === "keyboard" && rest[0] === "type") {
    const value = rest.slice(1).join(" ");
    const data = await pageScript<Record<string, unknown>>(sessionId, instanceId, `
      const el=document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set; setter?.call(el,el.value+${quote(value)});
      } else if (el?.isContentEditable) el.textContent=(el.textContent||'')+${quote(value)};
      else throw new Error('当前焦点不接受文本输入。');
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${quote(value)}}));
      return {ok:true};
    `);
    return textResult("已向当前焦点输入文本。", data);
  }
  if (command === "press") {
    const key = rest[0] || "";
    const data = await pageScript<Record<string, unknown>>(sessionId, instanceId, `
      const el=document.activeElement || document.body; const key=${quote(key)};
      for (const type of ['keydown','keyup']) el.dispatchEvent(new KeyboardEvent(type,{key,bubbles:true,cancelable:true}));
      return {ok:true,key};
    `);
    return textResult(`已发送按键 ${key}。`, data);
  }
  if (command === "scroll") {
    const direction = rest[0] || "down";
    const amount = Math.min(2000, Math.abs(Number(rest[1]) || 500)) * (direction === "up" || direction === "left" ? -1 : 1);
    const data = await pageScript<Record<string, unknown>>(sessionId, instanceId, `window.scrollBy(${direction === "left" || direction === "right" ? amount : 0}, ${direction === "up" || direction === "down" ? amount : 0}); return {x:scrollX,y:scrollY};`);
    return textResult(`已滚动页面。`, data);
  }
  throw new Error(`当前共享原生浏览器暂不支持 agent_browser 命令：${command}`);
}

export async function executeNativeBrowserAction(
  sessionId: string,
  instanceId: string,
  params: BrowserParams,
) {
  if (Array.isArray(params.args)) {
    if (params.args.some((arg) => typeof arg !== "string")) throw new Error("args 必须是字符串数组。");
    return executeArgCommand(sessionId, instanceId, params.args as string[]);
  }
  if (params.semanticAction && typeof params.semanticAction === "object") {
    const action = params.semanticAction as BrowserParams;
    const name = typeof action.action === "string" ? action.action : "";
    if (!["click", "fill", "check", "select"].includes(name)) throw new Error(`不支持 semanticAction：${name}`);
    const data = await pageScript<Record<string, unknown>>(
      sessionId,
      instanceId,
      locatorScript(action, name),
    );
    return textResult(JSON.stringify(data), data);
  }
  if (params.qa && typeof params.qa === "object") {
    const qa = params.qa as BrowserParams;
    if (typeof qa.url === "string") await navigateNativeBrowser(sessionId, instanceId, qa.url);
    const data = await pageScript<Record<string, unknown>>(sessionId, instanceId, `
      const expected=${JSON.stringify(qa.expectedText ?? null)};
      const selector=${JSON.stringify(typeof qa.expectedSelector === 'string' ? qa.expectedSelector : null)};
      const body=document.body?.innerText||'';
      const texts=Array.isArray(expected)?expected:expected?[expected]:[];
      const missing=texts.filter((text)=>!body.includes(String(text)));
      let selectorFound=true; if(selector){try{selectorFound=!!document.querySelector(selector)}catch{selectorFound=false}}
      return {url:location.href,title:document.title,textFound:missing.length===0,missingText:missing,selectorFound};
    `);
    const ok = data.textFound === true && data.selectorFound === true;
    return { text: JSON.stringify(data), data, isError: !ok };
  }
  throw new Error("共享原生浏览器当前支持 args、semanticAction 与基础 qa 操作；script/job/截图和下载尚未接入。");
}
