// MaGames IA Offline — chat de IA 100% no aparelho (wllama / llama.cpp em WebAssembly)
import { Wllama } from './vendor/wllama/index.js';

const VERSION = '1.0.1';
const HF = 'https://huggingface.co/';

// Modelos (GGUF Q4_K_M do Hugging Face). Tamanhos conferidos no HF.
const MODELS = [
  {
    id: 'leve', name: 'Leve (rápido)', model: 'Gemma 3 1B',
    url: HF + 'unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf',
    sizeMB: 769, ramGB: 3, ctx: 4096, maxTokens: 800, rec: true,
    desc: 'Recomendado. Português natural e respostas boas para o dia a dia. Roda em celulares de 4 GB de RAM.'
  },
  {
    id: 'melhor', name: 'Melhor (precisa de mais RAM)', model: 'Qwen3.5 2B',
    url: HF + 'unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
    sizeMB: 1222, ramGB: 6, ctx: 4096, maxTokens: 800,
    desc: 'O mais inteligente e o que menos erra. Mais lento; ideal com 6 GB de RAM ou mais (em 4 GB pode fechar a aba).'
  },
  {
    id: 'mini', name: 'Mini (celular fraco)', model: 'Qwen3.5 0.8B',
    url: HF + 'unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf',
    sizeMB: 508, ramGB: 2, ctx: 4096, maxTokens: 700,
    desc: 'O menor e mais rápido. Bom para textos curtos e ideias, mas erra bastante em fatos (datas, nomes, história).'
  },
];

const SYSTEM_PROMPT = 'Você é a MaGames IA, uma assistente útil que roda offline no celular do usuário. ' +
  'Responda sempre em português do Brasil, de forma clara, direta e amigável. ' +
  'Use listas curtas quando ajudar. Se não souber algo, diga que não sabe em vez de inventar.';

// ---------- utilidades ----------
const $ = (id) => document.getElementById(id);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Sem espaço para salvar o histórico.'); } },
};
const fmtMB = (b) => (b / 1048576).toFixed(0) + ' MB';
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ms = 3500) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
function stripThink(t) { return t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, ''); }

// Markdown simples e seguro
function md(src) {
  const blocks = []; let s = src.replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, l, code) => { blocks.push(code); return `\u0000${blocks.length - 1}\u0000`; });
  s = esc(s);
  const inline = (x) => x.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  const out = []; let list = null;
  for (const line of s.split('\n')) {
    const ul = line.match(/^\s*[-*•]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/), h = line.match(/^#{1,4}\s+(.*)/);
    if (ul || ol) { const tag = ul ? 'ul' : 'ol'; if (list !== tag) { if (list) out.push(`</${list}>`); out.push(`<${tag}>`); list = tag; } out.push(`<li>${inline((ul || ol)[1])}</li>`); continue; }
    if (list) { out.push(`</${list}>`); list = null; }
    if (h) out.push(`<p><b>${inline(h[1])}</b></p>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre><code>${esc(blocks[+i])}</code></pre>`).replace(/<p>(<pre>[\s\S]*?<\/pre>)<\/p>/g, '$1');
}

// ---------- estado ----------
let settings = LS.get('mio.settings', { modelId: null, gpu: false });
let convs = LS.get('mio.convs', []);
let currentId = LS.get('mio.current', null);
let wllama = null, loadedModelId = null, generating = false, abortCtl = null, dlAbort = null;
const threads = (self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - (navigator.hardwareConcurrency > 4 ? 2 : 0))) : 1);
const hasGPU = !!navigator.gpu;
const saveSettings = () => LS.set('mio.settings', settings);
const saveConvs = () => { LS.set('mio.convs', convs); LS.set('mio.current', currentId); };
const curConv = () => convs.find((c) => c.id === currentId);

function setStatus(t) { $('statusLine').textContent = t; }
function readyStatus() {
  const m = MODELS.find((x) => x.id === loadedModelId);
  if (!m) return;
  setStatus(`${navigator.onLine ? 'Pronto' : 'Offline ✓'} · ${m.model} · ${settings.gpu && hasGPU ? 'GPU' : 'CPU ' + threads + (threads > 1 ? ' núcleos' : ' núcleo')}`);
  $('drawerModel').textContent = `${m.name}: ${m.model} (${m.sizeMB} MB). Motor: llama.cpp WebAssembly${self.crossOriginIsolated ? ' multi-thread' : ' (1 thread)'}${NEED_COMPAT ? ' (modo compatível: atualize o Chrome para ficar mais rápido)' : ''}.`;
}
addEventListener('online', readyStatus); addEventListener('offline', readyStatus);

// ---------- service worker (offline + cross-origin isolation p/ multi-thread) ----------
async function setupSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
    // Primeira visita: o SW ainda não controla a página → recarrega 1x para ativar offline + multi-thread
    if (!navigator.serviceWorker.controller) {
      if (!sessionStorage.getItem('mio.reloaded')) {
        const ok = await Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 15000))]);
        if (!ok) { toast('Não deu para ativar o modo offline (pouco espaço livre?). O app funciona, mas precisa de internet para abrir.', 7000); return; }
        sessionStorage.setItem('mio.reloaded', '1');
        if (navigator.serviceWorker.controller) location.reload();
        else navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
        return 'reloading';
      }
    }
    reg.addEventListener?.('updatefound', () => {});
  } catch (e) { console.warn('SW falhou', e); }
}

// ---------- modelos ----------
// Chrome novo (JSPI + Memory64) usa o build principal; Chrome antigo usa o build "compat" (mais lento) — ambos ficam no app, sem CDN.
const NEED_COMPAT = (() => {
  if (!WebAssembly.Suspending) return true;
  try { new WebAssembly.Memory({ address: 'i64', initial: BigInt(1) }); return false; } catch { return true; }
})();
const WASM_URL = NEED_COMPAT ? 'vendor/wllama-compat/wllama.wasm' : 'vendor/wllama/wllama.wasm';
let wasmBlobUrl = null;
// O .wasm é lido pela página (passa pelo cache do service worker) e entregue ao worker como blob → funciona offline
async function getWasmUrl() {
  if (wasmBlobUrl) return wasmBlobUrl;
  try {
    const r = await fetch(WASM_URL); if (!r.ok) throw new Error(r.status);
    wasmBlobUrl = URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: 'application/wasm' }));
  } catch (e) { console.warn('wasm blob falhou, usando URL', e); wasmBlobUrl = new URL(WASM_URL, location.href).href; }
  return wasmBlobUrl;
}
function newWllama(wasmUrl) {
  const w = new Wllama({ default: wasmUrl || WASM_URL }, {
    allowOffline: true, parallelDownloads: 3, suppressNativeLog: false,
    logger: { debug() {}, log: console.log, warn: console.warn, error: console.error },
  });
  if (NEED_COMPAT) w.setCompat({ worker: new URL('vendor/wllama-compat/wllama.js', location.href).href, wasm: wasmUrl || WASM_URL });
  else w.setCompat(null);
  return w;
}
async function cachedModels() {
  try { const w = wllama || newWllama(); return await w.modelManager.getModels(); } catch (e) { console.warn(e); return []; }
}
function findCached(list, m) { return list.find((x) => x.url === m.url || (x.files && x.files.some((f) => f.metadata?.originalURL === m.url))); }

async function renderSetup(msg) {
  $('setup').classList.remove('hidden'); $('chat').classList.add('hidden'); $('composer').classList.add('hidden');
  setStatus(msg || 'Escolha um modelo');
  const mem = navigator.deviceMemory;
  $('deviceInfo').innerHTML = `📱 Seu aparelho: ${mem ? '~' + mem + ' GB de RAM (estimado pelo navegador)' : 'RAM desconhecida'} · ${navigator.hardwareConcurrency || '?'} núcleos · ` +
    `${self.crossOriginIsolated ? 'multi-thread ✓' : 'modo 1 thread'} · ${hasGPU ? 'WebGPU disponível' : 'sem WebGPU (usa CPU)'}`;
  const list = await cachedModels();
  $('modelList').innerHTML = '';
  for (const m of MODELS) {
    const c = findCached(list, m);
    const el = document.createElement('div');
    el.className = 'model' + (m.rec ? ' rec' : '');
    const warn = mem && mem < m.ramGB ? `<div class="tiny" style="color:#fbbf24">⚠️ Pode ficar pesado no seu aparelho.</div>` : '';
    el.innerHTML = `<h3>${m.name} ${m.rec ? '<span class="tag">recomendado</span>' : ''} ${c ? '<span class="tag ok">baixado ✓</span>' : ''}</h3>
      <p>${m.desc}</p><div class="tiny muted">${m.model} · download ${m.sizeMB} MB · RAM ideal ${m.ramGB}+ GB</div>${warn}
      <div class="actions"><button class="btn use">${c ? 'Usar' : 'Baixar e usar'}</button>${c ? '<button class="btn ghost del" style="width:auto">Apagar</button>' : ''}</div>`;
    el.querySelector('.use').onclick = () => startModel(m);
    const del = el.querySelector('.del');
    if (del) del.onclick = async () => {
      if (!confirm(`Apagar o modelo ${m.model} do aparelho? (libera ${m.sizeMB} MB)`)) return;
      if (loadedModelId === m.id && wllama) { await wllama.exit().catch(() => {}); wllama = null; loadedModelId = null; }
      await c.remove().catch((e) => toast('Erro ao apagar: ' + e.message));
      renderSetup();
    };
    $('modelList').appendChild(el);
  }
  showStorage();
}

async function showStorage() {
  try {
    const e = await navigator.storage.estimate();
    const p = await navigator.storage.persisted?.();
    $('storageInfo').textContent = `Armazenamento usado: ${fmtMB(e.usage || 0)} de ${fmtMB(e.quota || 0)} disponíveis${p ? ' · protegido ✓' : ''}`;
  } catch {}
}

async function startModel(m) {
  if (generating) return;
  if (navigator.deviceMemory && navigator.deviceMemory < m.ramGB && m.id === 'melhor' &&
      !confirm('Este modelo precisa de mais memória do que seu aparelho parece ter. Ele pode travar ou fechar a aba. Tentar mesmo assim?')) return;
  document.querySelectorAll('.model .btn').forEach((b) => (b.disabled = true));
  try {
    navigator.storage?.persist?.().catch(() => {});
    if (wllama) { await wllama.exit().catch(() => {}); wllama = null; loadedModelId = null; }
    wllama = newWllama(await getWasmUrl());
    let model = findCached(await wllama.modelManager.getModels(), m);
    if (!model) {
      if (!navigator.onLine) throw new Error('Sem internet: conecte-se (de preferência no Wi-Fi) para baixar o modelo uma vez.');
      model = await download(m);
    }
    setStatus('Carregando o modelo na memória…');
    $('dlBox').classList.remove('hidden'); $('dlTitle').textContent = 'Carregando na memória… (alguns segundos)'; $('dlBar').style.width = '100%';
    $('dlPct').textContent = ''; $('dlInfo').textContent = ''; $('btnCancelDl').classList.add('hidden');
    const t0 = performance.now();
    await wllama.loadModel(model, {
      n_ctx: m.ctx, n_batch: 512, n_threads: threads, n_gpu_layers: settings.gpu && hasGPU ? 999 : 0,
      jinja: true, log_level: 3,
    });
    console.log('[mio] modelo carregado em', Math.round(performance.now() - t0), 'ms; threads', wllama.getNumThreads(), 'multithread', wllama.isMultithread());
    loadedModelId = m.id; settings.modelId = m.id; saveSettings();
    $('dlBox').classList.add('hidden'); $('btnCancelDl').classList.remove('hidden');
    showChat();
  } catch (e) {
    console.error(e);
    $('dlBox').classList.add('hidden'); $('btnCancelDl').classList.remove('hidden');
    if (wllama) { await wllama.exit().catch(() => {}); wllama = null; }
    const msg = e?.name === 'AbortError' || /abort/i.test(e?.message) ? 'Download cancelado.' :
      /quota|space|storage/i.test(String(e?.name) + String(e?.message)) ? 'Pouco espaço livre no celular para guardar o modelo. Libere espaço e tente de novo.' :
      (/memory|alloc|OOM|RangeError/i.test(String(e?.message)) ? 'Memória insuficiente para este modelo. Use o modelo Leve.' : 'Erro: ' + (e?.message || e));
    toast(msg, 6000);
    renderSetup(msg);
  }
}

async function download(m) {
  $('dlBox').classList.remove('hidden');
  $('dlTitle').textContent = `Baixando ${m.model} (${m.sizeMB} MB)…`;
  setStatus('Baixando o modelo (só desta vez)…');
  let wake = null; try { wake = await navigator.wakeLock?.request('screen'); } catch {}
  dlAbort = new AbortController();
  const t0 = performance.now();
  try {
    return await wllama.modelManager.downloadModel(m.url, {
      signal: dlAbort.signal,
      progressCallback: ({ loaded, total }) => {
        const pct = total ? (loaded / total) * 100 : 0;
        $('dlBar').style.width = pct.toFixed(1) + '%';
        $('dlPct').textContent = pct.toFixed(0) + '%';
        const secs = (performance.now() - t0) / 1000, sp = loaded / Math.max(secs, 0.1);
        const eta = sp > 0 && total ? Math.max(0, (total - loaded) / sp) : 0;
        $('dlInfo').textContent = `${fmtMB(loaded)} / ${fmtMB(total)} · ${(sp / 1048576).toFixed(1)} MB/s · falta ${eta > 90 ? Math.round(eta / 60) + ' min' : Math.round(eta) + ' s'}`;
      },
    });
  } finally { dlAbort = null; wake?.release?.().catch(() => {}); }
}
$('btnCancelDl').onclick = () => dlAbort?.abort();

// ---------- conversas ----------
function newConv() {
  const c = { id: Date.now().toString(36), title: 'Nova conversa', messages: [], updated: Date.now() };
  convs.unshift(c); currentId = c.id; saveConvs(); return c;
}
function renderConvList() {
  const box = $('convList'); box.innerHTML = '';
  if (!convs.length) { box.innerHTML = '<div class="tiny muted" style="padding:10px">Nenhuma conversa ainda.</div>'; return; }
  for (const c of convs) {
    const el = document.createElement('div'); el.className = 'conv' + (c.id === currentId ? ' active' : '');
    el.innerHTML = `<span>${esc(c.title)}</span><button aria-label="Apagar">🗑</button>`;
    el.querySelector('span').onclick = () => { if (generating) return; currentId = c.id; saveConvs(); renderMessages(); closeDrawer(); };
    el.querySelector('button').onclick = (ev) => {
      ev.stopPropagation(); if (generating) return;
      if (!confirm('Apagar esta conversa?')) return;
      convs = convs.filter((x) => x.id !== c.id); if (currentId === c.id) currentId = convs[0]?.id || null;
      saveConvs(); renderConvList(); renderMessages();
    };
    box.appendChild(el);
  }
}

function msgEl(role, content, meta) {
  const el = document.createElement('div'); el.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  if (role === 'user') el.textContent = content;
  else {
    el.innerHTML = `<div class="body">${md(content)}</div><div class="meta"><span class="tps">${meta || ''}</span><button class="copy">copiar</button></div>`;
    el.querySelector('.copy').onclick = () => { navigator.clipboard?.writeText(el._raw || content).then(() => toast('Copiado!')).catch(() => {}); };
    el._raw = content;
  }
  return el;
}
function renderMessages() {
  const box = $('messages'); box.innerHTML = '';
  const c = curConv();
  if (!c || !c.messages.length) {
    box.innerHTML = `<div class="welcome"><img src="icons/icon-192.png" width="64" height="64" alt="" style="border-radius:16px"><h2>Olá! Como posso ajudar?</h2>
      <div>Tudo roda no seu celular. Funciona sem internet.</div><div class="chips">
      <button class="chip">Me dê 5 ideias de nome para uma loja de doces</button>
      <button class="chip">Explique o que é inflação de um jeito simples</button>
      <button class="chip">Escreva uma mensagem de bom dia para clientes</button>
      <button class="chip">Crie um roteiro curto para vídeo de 30 segundos</button></div></div>`;
    box.querySelectorAll('.chip').forEach((b) => (b.onclick = () => { $('input').value = b.textContent; send(); }));
  } else for (const m of c.messages) box.appendChild(msgEl(m.role, m.content, m.meta));
  scrollDown(true);
  renderConvList();
}
function scrollDown(force) {
  const ch = $('chat');
  if (force || ch.scrollHeight - ch.scrollTop - ch.clientHeight < 160) ch.scrollTop = ch.scrollHeight;
}

function showChat() {
  $('setup').classList.add('hidden'); $('chat').classList.remove('hidden'); $('composer').classList.remove('hidden');
  if (!curConv()) { if (convs[0]) currentId = convs[0].id; else newConv(); }
  renderMessages(); readyStatus(); showStorage();
}

// Mantém o histórico dentro do contexto (estimativa ~3 caracteres por token)
function buildMessages(c, m) {
  // Limite curto de histórico: no celular, reler um histórico longo deixa a 1ª palavra lenta
  const budget = Math.min((m.ctx - m.maxTokens - 120) * 3, 4000);
  const out = []; let used = SYSTEM_PROMPT.length;
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const x = c.messages[i]; const len = x.content.length;
    if (used + len > budget && out.length) break;
    out.unshift({ role: x.role, content: x.content.slice(-budget) }); used += len;
  }
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...out];
}

async function send() {
  if (generating) { abortCtl?.abort(); return; }
  const text = $('input').value.trim(); if (!text) return;
  if (!wllama || !loadedModelId) { toast('Carregue um modelo primeiro.'); return; }
  const m = MODELS.find((x) => x.id === loadedModelId);
  let c = curConv() || newConv();
  if (!c.messages.length) c.title = text.slice(0, 48);
  c.messages.push({ role: 'user', content: text }); c.updated = Date.now();
  convs = [c, ...convs.filter((x) => x.id !== c.id)]; saveConvs();
  $('input').value = ''; autosize();
  if (c.messages.length === 1) renderMessages(); else { $('messages').appendChild(msgEl('user', text)); }
  await generate(c, m);
}

async function generate(c, m) {
  const el = msgEl('assistant', ''); const body = el.querySelector('.body');
  body.classList.add('cursor'); body.innerHTML = '<span class="muted">pensando…</span>';
  $('messages').appendChild(el); scrollDown(true);
  generating = true; abortCtl = new AbortController();
  $('btnSend').textContent = '■'; $('btnSend').classList.add('stop'); $('btnSend').setAttribute('aria-label', 'Parar');
  let raw = '', nTok = 0, tFirst = 0, timings = null, lastPaint = 0;
  const tStart = performance.now();
  try {
    const stream = await wllama.createChatCompletion({
      messages: buildMessages(c, m), stream: true, max_tokens: m.maxTokens,
      temperature: 0.5, top_p: 0.8, top_k: 20, min_p: 0.05,
      chat_template_kwargs: { enable_thinking: false }, abortSignal: abortCtl.signal, timings_per_token: true,
    });
    for await (const ch of stream) {
      if (ch.timings) timings = ch.timings;
      const d = ch.choices?.[0]?.delta?.content;
      if (d) {
        if (!tFirst) tFirst = performance.now();
        raw += d; nTok++;
        const now = performance.now();
        if (now - lastPaint > 60) {
          lastPaint = now; body.innerHTML = md(stripThink(raw)) || '<span class="muted">pensando…</span>'; scrollDown();
          const tps = nTok > 1 ? (nTok - 1) / ((now - tFirst) / 1000) : 0;
          $('speed').textContent = `gerando… ${tps.toFixed(1)} tokens/s`;
        }
      }
    }
  } catch (e) {
    if (!(e?.name === 'WllamaAbortError' || e?.name === 'AbortError' || /abort/i.test(e?.message))) {
      console.error(e); raw += (raw ? '\n\n' : '') + '⚠️ Erro ao gerar: ' + (e?.message || e);
    }
  }
  const tEnd = performance.now();
  const genTps = timings?.predicted_per_second || (nTok > 1 && tFirst ? (nTok - 1) / ((tEnd - tFirst) / 1000) : 0);
  const promptS = ((tFirst || tEnd) - tStart) / 1000;
  const text = stripThink(raw).trim() || '(sem resposta)';
  const meta = `${genTps.toFixed(1)} tokens/s · ${timings?.predicted_n || nTok} tokens · 1ª palavra em ${promptS.toFixed(1)} s`;
  body.classList.remove('cursor'); body.innerHTML = md(text); el._raw = text;
  el.querySelector('.tps').textContent = meta;
  $('speed').textContent = `última resposta: ${meta}`;
  c.messages.push({ role: 'assistant', content: text, meta }); c.updated = Date.now(); saveConvs();
  window.__mioLast = { text, genTps, nTok: timings?.predicted_n || nTok, promptS, timings };
  generating = false; abortCtl = null;
  $('btnSend').textContent = '➤'; $('btnSend').classList.remove('stop'); $('btnSend').setAttribute('aria-label', 'Enviar');
  scrollDown();
}

// ---------- UI ----------
function autosize() { const i = $('input'); i.style.height = 'auto'; i.style.height = Math.min(i.scrollHeight, 140) + 'px'; }
$('input').addEventListener('input', autosize);
$('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer:coarse)').matches) { e.preventDefault(); send(); } });
$('form').onsubmit = (e) => { e.preventDefault(); send(); };
function openDrawer() { renderConvList(); $('drawer').classList.add('open'); $('scrim').classList.add('show'); showStorage(); }
function closeDrawer() { $('drawer').classList.remove('open'); $('scrim').classList.remove('show'); }
$('btnMenu').onclick = openDrawer; $('btnCloseDrawer').onclick = closeDrawer; $('scrim').onclick = closeDrawer;
const doNew = () => { if (generating) return; const c = curConv(); if (c && !c.messages.length) { closeDrawer(); return; } newConv(); renderMessages(); closeDrawer(); if (!loadedModelId) renderSetup(); };
$('btnNew').onclick = doNew; $('btnNew2').onclick = doNew;
$('btnModels').onclick = () => { if (generating) return; closeDrawer(); renderSetup(); };
$('btnClearAll').onclick = () => { if (generating) return; if (!confirm('Apagar todas as conversas?')) return; convs = []; currentId = null; saveConvs(); newConv(); renderMessages(); closeDrawer(); };
$('optGpu').checked = !!settings.gpu; $('optGpu').disabled = !hasGPU;
$('optGpu').onchange = () => { settings.gpu = $('optGpu').checked; saveSettings(); toast(settings.gpu ? 'GPU ligada. Recarregando o modelo…' : 'Usando CPU. Recarregando o modelo…'); const m = MODELS.find((x) => x.id === loadedModelId); if (m) { closeDrawer(); renderSetup('Recarregando…'); startModel(m); } };
$('ver').textContent = VERSION;

// ---------- início ----------
(async function boot() {
  if ((await setupSW()) === 'reloading') { setStatus('Ativando modo offline…'); return; }
  const m = MODELS.find((x) => x.id === settings.modelId);
  if (m) {
    const c = findCached(await cachedModels(), m);
    if (c) { await renderSetup('Abrindo…'); return startModel(m); }
  }
  renderSetup();
})();
window.__mio = { MODELS, get loaded() { return loadedModelId; }, get generating() { return generating; }, startModel: (id) => startModel(MODELS.find((x) => x.id === id)), threads, NEED_COMPAT };
