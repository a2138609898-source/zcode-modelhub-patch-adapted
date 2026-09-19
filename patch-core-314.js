#!/usr/bin/env node
"use strict";
// model-hub ZCode patch — adapted for ZCode Desktop 3.14.0
// Anchors re-derived for 3.14.0 (render component vRt->mbn, styles hash -> 0ZAopPCa,
// model-list var W->G, save wrapper se->oe, add via je({modelId,personalConfig,useRecommendedConfig})).
// Buttons rendered as native <button> to avoid depending on renamed component symbols.
const fs = require("fs");
const path = require("path");
const asar = require(path.join(__dirname, "asar.js"));

function findResources(explicit) {
  const cands = [];
  if (explicit) cands.push(explicit);
  const lad = process.env.LOCALAPPDATA;
  if (lad) cands.push(path.join(lad, "Programs", "ZCode", "resources"));
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  cands.push(path.join(pf, "ZCode", "resources"));
  for (const c of cands) if (c && fs.existsSync(path.join(c, "app.asar"))) return c;
  return null;
}
function die(msg) { console.error("\n[x] " + msg); process.exit(1); }
function log(m) { console.log("[*] " + m); }
function atomicReplace(src, dst, expectSize) {
  const tmp = dst + ".modelhub-tmp";
  fs.rmSync(tmp, { force: true });
  fs.copyFileSync(src, tmp);
  const got = fs.statSync(tmp).size;
  if (expectSize !== undefined && got !== expectSize) die("校验失败: 临时文件 " + got + " 字节, 应为 " + expectSize + " - 已放弃, 原文件未动");
  fs.renameSync(tmp, dst);
}

const restoring = process.argv.includes("--restore");
const argPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
const resourcesDir = findResources(argPath);
if (process.argv.includes("--detect")) { console.log(resourcesDir || "NOT_FOUND"); process.exit(0); }
if (!resourcesDir) die("未找到 ZCode 安装目录。用法: node patch-core-314.js \"<resources目录>\"");
const asarPath = path.join(resourcesDir, "app.asar");
const backupPath = path.join(resourcesDir, "app.asar.modelhub-backup");
if (!fs.existsSync(asarPath)) die("未找到 " + asarPath);

if (restoring) {
  if (!fs.existsSync(backupPath)) die("未找到备份 app.asar.modelhub-backup");
  log("原子还原中...");
  atomicReplace(backupPath, asarPath, fs.statSync(backupPath).size);
  console.log("[√] 已还原备份的 app.asar");
  process.exit(0);
}

const PRELOAD_REL = "out/preload/index.cjs";
const MAIN_REL = "out/main/index.js";
const RENDER_REL = "out/renderer/assets/styles-0ZAopPCa.js";

const PRELOAD_ANCHOR = "exposeInMainWorld(\"zcode\",{connectRemote";
const PRELOAD_INJECT = "modelhubFetchModels:(e,t,n,r)=>h.ipcRenderer.invoke(\"modelhub:fetch-models\",{baseUrl:e,apiKey:t,headers:n,dialect:r}),modelhubProbeVision:(e,t,n,r,s)=>h.ipcRenderer.invoke(\"modelhub:probe-vision\",{baseUrl:e,apiKey:t,model:n,headers:r,dialect:s}),";

// preload exposes via `h` in 3.12.3; verify the ipcRenderer local name in 3.14.0 at runtime.
// 3.14.0 preload uses `_.ipcRenderer` (see connectRemote:s((t,n,i)=>_.ipcRenderer.invoke...). So use `_`.
const PRELOAD_INJECT_314 = "modelhubFetchModels:(e,t,n,r)=>_.ipcRenderer.invoke(\"modelhub:fetch-models\",{baseUrl:e,apiKey:t,headers:n,dialect:r}),modelhubProbeVision:(e,t,n,r,s)=>_.ipcRenderer.invoke(\"modelhub:probe-vision\",{baseUrl:e,apiKey:t,model:n,headers:r,dialect:s}),";

// ---- render anchor: the mbn model-list call (unique) ----
const VRT_START = "(0,$.jsx)(mbn,{providerId:e.providerId";
const VRT_END = "},e.providerId)";

const MAIN_HANDLERS = "import{ipcMain as MdlH}from\"electron\";\nMdlH.handle(\"modelhub:fetch-models\",async(e,p)=>{try{\nconst b=String(p.baseUrl||'').trim().replace(/\\/+$/,'');\nif(!b)return{ok:false,error:'baseUrl is empty'};\nconst hs=Object.assign({'Content-Type':'application/json'},p.headers&&typeof p.headers==='object'?p.headers:{});\nconst kind=String(p.dialect||'openai-compatible');\nif(p.apiKey){hs.Authorization='Bearer '+p.apiKey;if(kind==='anthropic')hs['x-api-key']=p.apiKey;if(kind==='gemini'){hs['x-goog-api-key']=p.apiKey;delete hs.Authorization}}\nlet urls;\nif(kind==='anthropic')urls=[b+'/v1/models',b+'/models'];\nelse if(kind==='gemini')urls=[b+'/v1beta/models',b+'/models'];\nelse{urls=[b+'/models'];if(!/\\/v\\d+[a-z]*$/i.test(b))urls.push(b+'/v1/models')}\n\nlet lastErr=null;\nfor(const u of urls){\nlet r;try{r=await fetch(u,{headers:hs})}catch(er){lastErr=String(er.cause&&er.cause.code||er.message||er);continue}\nif(r.status===404){lastErr='404 at '+u;continue}\nconst tx=await r.text();\nif(!r.ok){lastErr='HTTP '+r.status+': '+tx.slice(0,300);continue}\nlet j;try{j=JSON.parse(tx)}catch{lastErr='response is not JSON (HTML page?) at '+u;continue}\nconst raw=Array.isArray(j)?j:(j.data||j.models||[]);\nconst ids=raw.map(m=>typeof m==='string'?m:(m.id||m.name)).filter(Boolean);\nconst vis=/(vision|vl-|gpt-4o|gpt-4\\.1|gpt-5|claude|gemini|qwen.*vl|glm-4v|glm-5|internvl|llava|pixtral|o4-|omni|doubao.*vision|step-1v|deepseek-vision)/i;\nreturn{ok:true,models:[...new Set(ids)].sort().map(id=>({id,visionGuess:vis.test(id)}))};\n}\nreturn{ok:false,error:lastErr||'404: no /models endpoint found'};\n}catch(er){return{ok:false,error:String(er&&er.message||er)}}});\n\nimport{ipcMain as MdlP}from\"electron\";\nconst MdlPng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';\nMdlP.handle(\"modelhub:probe-vision\",async(e,p)=>{try{\nconst b=String(p.baseUrl||'').trim().replace(/\\/+$/,'');\nconst hs=Object.assign({'Content-Type':'application/json'},p.headers&&typeof p.headers==='object'?p.headers:{});\nconst kind=String(p.dialect||'openai-compatible');\nif(p.apiKey){hs.Authorization='Bearer '+p.apiKey;if(kind==='anthropic')hs['x-api-key']=p.apiKey;if(kind==='gemini'){hs['x-goog-api-key']=p.apiKey;delete hs.Authorization}}\nif(kind==='gemini')return{ok:true,vision:false,detail:'gemini probe unsupported'};\nconst body=kind==='anthropic'\n?JSON.stringify({model:p.model,max_tokens:16,messages:[{role:'user',content:[{type:'text',text:'What color is this image?'},{type:'image',source:{type:'base64',media_type:'image/png',data:MdlPng}}]}]})\n:JSON.stringify({model:p.model,max_tokens:16,messages:[{role:'user',content:[{type:'text',text:'What color is this image?'},{type:'image_url',image_url:{url:'data:image/png;base64,'+MdlPng}}]}]});\nlet urls;\nif(kind==='anthropic')urls=[b+'/v1/messages',b+'/messages'];\nelse{urls=[b+'/chat/completions'];if(!/\\/v\\d+[a-z]*$/i.test(b))urls.push(b+'/v1/chat/completions')}\n\nfor(const u of urls){\nlet r;try{r=await fetch(u,{method:'POST',headers:hs,body})}catch(er){return{ok:false,error:String(er.cause&&er.cause.code||er.message||er)}}\nif(r.status===404)continue;\nconst tx=await r.text();\nif(r.ok)return{ok:true,vision:true,detail:tx.slice(0,120)};\nif(r.status===400||r.status===422){const lo=tx.toLowerCase();\nif(/image|visual|multimodal|multi-modal|content.*type|unsupported/.test(lo)&&!/rate|quota|billing|token limit|context length|maximum/.test(lo))return{ok:true,vision:false,detail:'rejected image input'};}\nreturn{ok:false,status:r.status,error:'HTTP '+r.status+': '+tx.slice(0,200)};\n}\nreturn{ok:false,error:'404'};\n}catch(er){return{ok:false,error:String(er&&er.message||er)}}});\n";

// 拉取模型按钮 (native <button>; scope: e,t,n,je,oe,G,E,O,w). 用 je 逐个添加(自带保存+版本处理)。
const BTN_PULL = "(0,$.jsx)(`button`,{type:`button`,style:{padding:`4px 12px`,fontSize:`12px`,borderRadius:`8px`,border:`1px solid #3f3f46`,background:`#1c1c1f`,color:`#e4e4e7`,cursor:`pointer`},onClick:async eh=>{const __b=eh&&eh.currentTarget;__b&&(__b.disabled=!0,__b.textContent=`拉取中…`);try{if(!window.zcode||!window.zcode.modelhubFetchModels){window.__mhToast(`补丁未加载`,!1);return}if(!n){window.__mhToast(`当前渠道不支持添加个人模型`,!1);return}const __base=String(E||e.config.api?.baseUrl||'').trim();if(!__base){window.__mhToast(`请先填写 API 地址`,!1);return}const __ws=String(w||'');const __dia=__ws.includes(`anthropic`)?`anthropic`:(__ws.includes(`gemini`)?`gemini`:`openai-compatible`);const __hd=(e.config.api&&e.config.api.headers)||{};const rr=await window.zcode.modelhubFetchModels(__base,O,__hd,__dia);__b&&(__b.disabled=!1,__b.textContent=`拉取模型`);if(!rr||!rr.ok){window.__mhToast(`拉取失败：`+((rr&&rr.error)||`未知错误`),!1);return}if(!rr.models.length){window.__mhToast(`该端点返回 0 个模型`,!1);return}window.__mhPick(rr.models,{baseUrl:__base,apiKey:O,headers:__hd,dialect:__dia,onConfirm:async sel=>{try{const __have=new Set((G||[]).map(m=>m.modelId));const __add=sel.filter(m=>!__have.has(m.id));if(!__add.length){window.__mhToast(`所选模型均已存在`,!1);return}let __ok=0;for(const __m of __add){try{await je({modelId:__m.id,personalConfig:{},useRecommendedConfig:!0});__ok++}catch(e4){window.__mhToast(`添加 `+__m.id+` 失败：`+((e4&&e4.message)||e4),!1)}}window.__mhToast(`已添加 `+__ok+` / `+__add.length+` 个模型`)}catch(e2){window.__mhToast(`添加失败：`+((e2&&e2.message)||e2),!1)}},onCancel:()=>{}})}catch(eh2){window.__mhToast(`拉取失败：`+((eh2&&eh2.message)||eh2),!1)}finally{__b&&(__b.disabled=!1,__b.textContent=`拉取模型`)}},children:`拉取模型`})";

// 请求头模拟按钮 (native <button>; 用 oe 包 onSave t 全量保存)
const BTN_HEADERS = "(0,$.jsx)(`button`,{type:`button`,style:{padding:`4px 12px`,fontSize:`12px`,borderRadius:`8px`,border:`1px solid #3f3f46`,background:`#1c1c1f`,color:`#e4e4e7`,cursor:`pointer`},onClick:()=>{if(!window.__mhHeaders){window.__mhToast&&window.__mhToast(`请求头面板未加载`,!1);return}window.__mhHeaders((e.config.api&&e.config.api.headers)||{},async out=>{try{const np={...e,config:{...e.config,api:{...(e.config.api||{}),headers:out}}};await oe(async()=>{await t(np)});window.__mhToast(out&&Object.keys(out).length?`已应用 `+Object.keys(out).length+` 个请求头`:`已清除全部请求头`)}catch(e3){window.__mhToast(`写入失败：`+((e3&&e3.message)||e3),!1)}})},children:`请求头模拟`})";

const HELPER_BLOCK = `
;window.__mhToast=(msg,ok=true)=>{try{const d=document.createElement('div');d.textContent=msg;d.style.cssText='position:fixed;right:18px;bottom:18px;z-index:99999;max-width:420px;padding:12px 16px;border-radius:10px;font-size:13px;line-height:1.5;background:#18181b;color:#fafafa;border:1px solid '+(ok?'#3f3f46':'#b91c1c')+';box-shadow:0 8px 24px rgba(0,0,0,.45);opacity:0;transition:opacity .2s,transform .2s;transform:translateY(6px)';document.body.appendChild(d);requestAnimationFrame(()=>{d.style.opacity='1';d.style.transform='translateY(0)'});setTimeout(()=>{d.style.opacity='0';d.style.transform='translateY(6px)';setTimeout(()=>d.remove(),300)},ok?3500:6000)}catch(e){}};

;window.__mhPick=function(items,opt){try{
  const old=document.getElementById('mh-picker-root');if(old)old.remove();
  const S={items:items.map(m=>({id:m.id,vision:!!m.visionGuess,checked:true,probing:false}))};
  const root=document.createElement('div');root.id='mh-picker-root';
  root.style.cssText='position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
  const panel=document.createElement('div');
  panel.style.cssText='width:600px;max-width:92vw;max-height:76vh;display:flex;flex-direction:column;background:#131316;color:#fafafa;border:1px solid #2e2e33;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.5);font-size:13px;overflow:hidden';
  const head=document.createElement('div');
  head.style.cssText='padding:12px 16px;border-bottom:1px solid #2e2e33;display:flex;align-items:center;justify-content:space-between';
  head.innerHTML='<span style="font-weight:600">选择要添加的模型</span>';
  const x=document.createElement('button');x.textContent='×';x.style.cssText='background:none;border:none;color:#a1a1aa;font-size:18px;cursor:pointer';
  x.onclick=close;head.appendChild(x);
  const bar=document.createElement('div');
  bar.style.cssText='padding:10px 16px;display:flex;gap:8px;align-items:center;border-bottom:1px solid #2e2e33;flex-wrap:wrap';
  const search=document.createElement('input');search.placeholder='搜索模型…';
  search.style.cssText='flex:1;min-width:140px;background:#1c1c1f;border:1px solid #2e2e33;border-radius:8px;padding:6px 10px;color:#fafafa;outline:none';
  const mkBtn=(t)=>{const b=document.createElement('button');b.textContent=t;b.style.cssText='background:#1c1c1f;border:1px solid #2e2e33;border-radius:8px;padding:6px 10px;color:#e4e4e7;cursor:pointer';b.onmouseenter=()=>b.style.background='#27272a';b.onmouseleave=()=>b.style.background='#1c1c1f';return b};
  const all=mkBtn('全选'),none=mkBtn('全不选'),probe=mkBtn('探测视觉(勾选项)'),probeAll=mkBtn('探测全部');
  bar.append(search,all,none,probe,probeAll);
  const list=document.createElement('div');list.style.cssText='flex:1;overflow-y:auto;padding:6px 8px';
  const foot=document.createElement('div');
  foot.style.cssText='padding:12px 16px;border-top:1px solid #2e2e33;display:flex;align-items:center;justify-content:space-between';
  const info=document.createElement('span');info.style.color='#a1a1aa';
  const cancel=mkBtn('取消');cancel.onclick=close;
  const ok=document.createElement('button');ok.textContent='确认添加';
  ok.style.cssText='background:#3b82f6;border:none;border-radius:8px;padding:7px 16px;color:#fff;font-weight:600;cursor:pointer';
  foot.append(info,cancel,ok);
  panel.append(head,bar,list,foot);root.appendChild(panel);document.body.appendChild(root);
  root.onmousedown=e=>{if(e.target===root)close()};
  function close(){root.remove();if(opt.onCancel)opt.onCancel()}
  function esc(e){if(e.key==='Escape'){close();document.removeEventListener('keydown',esc)}}
  document.addEventListener('keydown',esc);
  function rowEl(it){
    const r=document.createElement('div');
    r.style.cssText='display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px';
    r.onmouseenter=()=>r.style.background='#1c1c1f';r.onmouseleave=()=>r.style.background='transparent';
    const c=document.createElement('input');c.type='checkbox';c.checked=it.checked;c.style.accentColor='#3b82f6';c.style.width='15px';c.style.height='15px';
    c.onchange=()=>{it.checked=c.checked;stat()};
    const id=document.createElement('span');id.textContent=it.id;id.title=it.id;
    id.style.cssText='flex:1;font-family:ui-monospace,Consolas,monospace;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    const v=document.createElement('button');
    const drawV=()=>{it.probing?(v.textContent='探测中…',v.style.color='#a1a1aa'):(v.textContent=it.vision?'视觉 ✓':'文本',v.style.color=it.vision?'#4ade80':'#a1a1aa');v.style.fontWeight=it.vision?'600':'400'};
    v.style.cssText='background:#1c1c1f;border:1px solid #2e2e33;border-radius:6px;padding:3px 10px;cursor:pointer;min-width:64px';
    v.onclick=()=>{it.vision=!it.vision;drawV()};
    drawV();it._drawV=drawV;it._row=r;
    r.append(c,id,v);return r;
  }
  function renderList(){
    list.innerHTML='';const q=search.value.trim().toLowerCase();
    S.items.forEach(it=>{
      const show=!q||it.id.toLowerCase().includes(q);
      if(it._row&&show)list.appendChild(it._row);
    });
    if(!list.children.length){const e=document.createElement('div');e.textContent='无匹配';e.style.cssText='color:#71717a;text-align:center;padding:20px';list.appendChild(e)}
  }
  function stat(){const n=S.items.filter(i=>i.checked).length;info.textContent='已选 '+n+' / '+S.items.length+' 个模型'}
  const rows=S.items.map(rowEl);renderList();stat();
  search.oninput=renderList;
  all.onclick=()=>{S.items.forEach(it=>{const q=search.value.trim().toLowerCase();if(!q||it.id.toLowerCase().includes(q))it.checked=true});rows.forEach(r=>{const c=r.querySelector('input');c.checked=true});renderList();stat()};
  none.onclick=()=>{S.items.forEach(it=>it.checked=false);rows.forEach(r=>{r.querySelector('input').checked=false});stat()};
  async function doProbe(targets){
    const base=opt.baseUrl,ak=opt.apiKey;
    const queue=targets.slice();let done=0;const total=targets.length;
    info.textContent='探测中 0/'+total;
    async function worker(){
      while(queue.length){
        const it=queue.shift();it.probing=true;it._drawV();
        let res=null;
        try{res=await window.zcode.modelhubProbeVision(base,ak,it.id,opt.headers,opt.dialect)}catch(e){res={ok:false,error:String(e)}}
        it.probing=false;
        if(res&&res.ok)it.vision=res.vision;else it.vision=false;
        it._drawV();done++;info.textContent='探测中 '+done+'/'+total;
      }
    }
    await Promise.all([worker(),worker(),worker(),worker()]);
    info.textContent='探测完成';
  }
  probe.onclick=()=>doProbe(S.items.filter(i=>i.checked));
  probeAll.onclick=()=>{S.items.forEach(i=>i.checked=true);rows.forEach(r=>{r.querySelector('input').checked=true});stat();doProbe(S.items)};
  ok.onclick=()=>{const sel=S.items.filter(i=>i.checked).map(i=>({id:i.id,vision:i.vision}));root.remove();document.removeEventListener('keydown',esc);if(sel.length&&opt.onConfirm)opt.onConfirm(sel)};
}catch(e){console.error('[modelhub] picker error',e);if(window.__mhToast)window.__mhToast('选择器异常：'+e,!1)}};

;window.__mhHeaders=function(cur,apply){try{
  const PRESETS={
    claude:[
      {k:'user-agent',v:'claude-cli/2.1.6 (external, cli)'},
      {k:'x-app',v:'cli'},
      {k:'anthropic-version',v:'2023-06-01'},
      {k:'anthropic-beta',v:'claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14'},
      {k:'accept',v:'application/json'},
      {k:'x-stainless-lang',v:'js'},
      {k:'x-stainless-runtime',v:'node'},
      {k:'x-stainless-runtime-version',v:'v24.13.0'},
      {k:'x-stainless-os',v:'Windows'},
      {k:'x-stainless-arch',v:'x64'},
      {k:'x-stainless-package-version',v:'0.60.0'},
      {k:'x-stainless-retry-count',v:'0'},
      {k:'x-stainless-timeout',v:'600000'}
    ],
    codex:[
      {k:'user-agent',v:'codex_cli_rs/0.42.0 (Windows 11.0.26100; x86_64) unknown'},
      {k:'OpenAI-Beta',v:'responses=experimental'},
      {k:'originator',v:'codex_cli_rs'},
      {k:'session_id',v:'',auto:'uuid'},
      {k:'accept',v:'text/event-stream'},
      {k:'version',v:'0.42.0'}
    ]
  };
  let tab='claude';
  const S={};
  const cur0=cur||{};
  const shared={};for(const _t in PRESETS)for(const _h of PRESETS[_t])shared[_h.k]=(shared[_h.k]||0)+1;
  const uuid=()=>crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)});
  function loadTab(t){tab=t;if(!S[t])S[t]=PRESETS[t].map(h=>({k:h.k,auto:h.auto,checked:cur0[h.k]!==undefined,value:(shared[h.k]>1)?(h.auto?uuid():h.v):(cur0[h.k]!==undefined?cur0[h.k]:(h.auto?uuid():h.v))}));S[t].forEach(h=>{if(h.auto&&!h.value)h.value=uuid()});render()}
  const root=document.createElement('div');root.id='mh-headers-root';
  root.style.cssText='position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
  const panel=document.createElement('div');
  panel.style.cssText='width:640px;max-width:92vw;max-height:76vh;display:flex;flex-direction:column;background:#131316;color:#fafafa;border:1px solid #2e2e33;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.5);font-size:13px;overflow:hidden';
  const head=document.createElement('div');
  head.style.cssText='padding:12px 16px;border-bottom:1px solid #2e2e33;display:flex;align-items:center;justify-content:space-between';
  head.innerHTML='<span style="font-weight:600">请求头模拟</span><span style="color:#a1a1aa;font-size:12px">勾选=生效 · 取消勾选=移除 · 仅影响当前渠道</span>';
  const x=document.createElement('button');x.textContent='×';x.style.cssText='background:none;border:none;color:#a1a1aa;font-size:18px;cursor:pointer';x.onclick=close;
  head.appendChild(x);
  const tabs=document.createElement('div');
  tabs.style.cssText='padding:10px 16px;display:flex;gap:8px;border-bottom:1px solid #2e2e33';
  const mkBtn=(t,st)=>{const b=document.createElement('button');b.textContent=t;b.style.cssText=(st||'')+'padding:7px 14px;border-radius:8px;border:1px solid #2e2e33;background:#1c1c1f;color:#e4e4e7;cursor:pointer';return b};
  const mkTab=t=>{const b=mkBtn(t==='claude'?'Claude (claude-cli)':'Codex (codex_cli_rs)');b.onclick=()=>{loadTab(t);[...tabs.children].forEach(c=>{c.style.background='#1c1c1f';c.style.color='#e4e4e7'});b.style.background='#3b82f6';b.style.color='#fff'};return b};
  tabs.append(mkTab('claude'),mkTab('codex'));
  const list=document.createElement('div');list.style.cssText='flex:1;overflow-y:auto;padding:8px 12px';
  const foot=document.createElement('div');
  foot.style.cssText='padding:12px 16px;border-top:1px solid #2e2e33;display:flex;align-items:center;justify-content:space-between;gap:8px';
  const info=document.createElement('span');info.style.color='#a1a1aa';
  const clear=mkBtn('清除全部模拟');
  clear.onclick=()=>{try{apply({});close();if(window.__mhToast)window.__mhToast('已清除此渠道的全部模拟请求头')}catch(e){if(window.__mhToast)window.__mhToast('清除失败：'+e,!1)}};
  const cancel=mkBtn('取消');cancel.onclick=close;
  const ok=document.createElement('button');ok.textContent='应用';ok.style.cssText='padding:7px 16px;border-radius:8px;border:none;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer';
  foot.append(info,clear,cancel,ok);
  panel.append(head,tabs,list,foot);root.appendChild(panel);document.body.appendChild(root);
  root.onmousedown=e=>{if(e.target===root)close()};
  function esc(ev){if(ev.key==='Escape'){close();document.removeEventListener('keydown',esc)}}
  document.addEventListener('keydown',esc);
  function close(){root.remove();document.removeEventListener('keydown',esc)}
  function render(){
    list.innerHTML='';stat();
    for(const h of S[tab]){
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px';
      const c=document.createElement('input');c.type='checkbox';c.checked=h.checked;c.style.accentColor='#3b82f6';c.style.width='15px';c.style.height='15px';
      c.onchange=()=>{h.checked=c.checked;if(h.auto&&h.checked&&!h.value)h.value=uuid();stat()};
      const k=document.createElement('span');k.textContent=h.k;k.title=h.k;
      k.style.cssText='width:220px;flex-shrink:0;font-family:ui-monospace,Consolas,monospace;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      const v=document.createElement('input');v.value=h.value;
      v.style.cssText='flex:1;background:#1c1c1f;border:1px solid #2e2e33;border-radius:6px;padding:4px 8px;color:#fafafa;font-family:ui-monospace,Consolas,monospace;font-size:12px;outline:none';
      v.oninput=()=>{h.value=v.value};
      if(h.auto){const rb=mkBtn('换一个','font-size:11px;padding:4px 8px;');rb.onclick=()=>{h.value=uuid();v.value=h.value};row.append(c,k,v,rb)}
      else row.append(c,k,v);
      list.appendChild(row);
    }
  }
  function stat(){const n=S[tab].filter(h=>h.checked).length;info.textContent='勾选 '+n+' / '+S[tab].length+' · 取消勾选的键将从渠道中移除'}
  loadTab('claude');
  const tb0=[...tabs.children][0];tb0.style.background='#3b82f6';tb0.style.color='#fff';
  ok.onclick=()=>{
    const out={...(cur0||{})};
    let add=0,rem=0;
    for(const _t in PRESETS){if(_t===tab)continue;for(const _h of PRESETS[_t]){if(shared[_h.k]>1)continue;if(out[_h.k]!==undefined){delete out[_h.k];rem++}}}
    for(const h of S[tab]){
      if(h.checked){if(out[h.k]!==h.value)add++;out[h.k]=h.value}
      else if(out[h.k]!==undefined){delete out[h.k];rem++}
    }
    try{apply(out);close();if(window.__mhToast)window.__mhToast('已应用：新增/更新 '+add+' 个，移除 '+rem+' 个请求头')}
    catch(e){if(window.__mhToast)window.__mhToast('写入失败：'+e,!1)}
  };
}catch(e){console.error('[modelhub] headers error',e)}};
`;

try {
  log("读取并校验 " + asarPath);
  let p = asar.readEntry(asarPath, PRELOAD_REL);
  let m = asar.readEntry(asarPath, MAIN_REL);
  let r = asar.readEntry(asarPath, RENDER_REL);
  if (p == null || m == null || r == null) die("目标文件缺失，ZCode 版本可能不是 3.14.0");
  p = p.toString("utf8"); m = m.toString("utf8"); r = r.toString("utf8");
  if (p.includes("modelhubFetchModels") || r.includes("__mhPick")) die("检测到已安装过补丁，如需重装请先 --restore");

  // preload anchor + which ipcRenderer local? detect `_.ipcRenderer` vs `h.ipcRenderer`
  if (p.split(PRELOAD_ANCHOR).length - 1 !== 1) die("preload 锚点不唯一/未找到");
  let preloadInject;
  if (p.includes("_.ipcRenderer.invoke")) preloadInject = PRELOAD_INJECT_314;
  else if (p.includes("h.ipcRenderer.invoke")) preloadInject = PRELOAD_INJECT;
  else die("preload 未找到 ipcRenderer 引用名(既非 _ 也非 h)，需人工确认");
  log("preload ipcRenderer 局部名: " + (preloadInject === PRELOAD_INJECT_314 ? "_" : "h"));

  // render anchor
  if (r.split(VRT_START).length - 1 !== 1) die("渲染层锚点(mbn调用)不唯一/未找到");
  const vs = r.indexOf(VRT_START);
  const ve = r.indexOf(VRT_END, vs);
  if (ve < 0) die("渲染层锚点结束标记未找到");
  const VRT_ANCHOR = r.slice(vs, ve + VRT_END.length);
  if (!VRT_ANCHOR.includes("models:G") || !VRT_ANCHOR.includes("onAddModel:je") || !VRT_ANCHOR.includes("onModelCommit:Oe")) die("渲染层锚点内容校验失败(models:G/onAddModel:je/onModelCommit:Oe)");
  log("渲染层锚点定位成功（长度 " + VRT_ANCHOR.length + "）");

  log("备份原版 -> app.asar.modelhub-backup");
  if (!fs.existsSync(backupPath)) atomicReplace(asarPath, backupPath, fs.statSync(asarPath).size);

  log("改写三个文件（内存中）...");
  p = p.replace(PRELOAD_ANCHOR, 'exposeInMainWorld("zcode",{' + preloadInject + "connectRemote");
  m += MAIN_HANDLERS;
  const BTN_ROW = "(0,$.jsxs)(`div`,{style:{display:`flex`,justifyContent:`flex-end`,gap:`8px`},children:[" + BTN_PULL + "," + BTN_HEADERS + "]})";
  const VRT_WRAP = "(0,$.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:`8px`},children:[" + BTN_ROW + "," + VRT_ANCHOR + "]})";
  r = r.replace(VRT_ANCHOR, VRT_WRAP);
  r += HELPER_BLOCK;

  log("外科手术式重打包...");
  const outTmp = asarPath + ".modelhub-new";
  asar.patchEntries(asarPath, outTmp, {
    [PRELOAD_REL]: Buffer.from(p, "utf8"),
    [MAIN_REL]: Buffer.from(m, "utf8"),
    [RENDER_REL]: Buffer.from(r, "utf8"),
  });
  log("原子替换...");
  atomicReplace(outTmp, asarPath, fs.statSync(outTmp).size);
  fs.rmSync(outTmp, { force: true });
  console.log("\n[√] 3.14.0 补丁安装完成！重启 ZCode → 设置 → 模型供应商 → 编辑渠道，模型列表上方应有「拉取模型」「请求头模拟」。");
} catch (e) {
  die(String(e && e.stack || e));
}
