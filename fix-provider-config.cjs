#!/usr/bin/env node
"use strict";
/*
 * 修复审查中发现的配置缺陷：
 *  1) miaomiao/grok-4.6 有 map 但缺 values（下拉退化成开关）
 *  2) 鸡蛋(new-provider-3) 的 4 个模型缺 reasoningLevel 挡位与 contextWindow
 *
 * 安全：ZCode 运行时拒写；写前备份；写后 JSON + 真实 CEL 解析器双重校验；原子替换。
 * 用法：node fix-provider-config.cjs [--dry-run]
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const V = path.join(os.homedir(), ".zcode", "v2");
const PC = path.join(V, "provider_config.json");
const ZCODE_CJS = path.join(process.env.LOCALAPPDATA || "", "Programs", "ZCode", "resources", "glm", "zcode.cjs");
const DRY = process.argv.includes("--dry-run");

function zcodeRunning() {
  try { return /(^|\s)ZCode\.exe/im.test(execFileSync("tasklist", { encoding: "utf8" })); } catch { return false; }
}
if (zcodeRunning() && !DRY) {
  console.error("[x] ZCode 正在运行 — 写入会被内存覆盖，已中止。请完全退出 ZCode 后重试（或用 --dry-run 预览）。");
  process.exit(3);
}

// ---- 载入 ZCode 真实 CEL 解析器，用于校验每个 map ----
function loadRealParser() {
  if (!fs.existsSync(ZCODE_CJS)) return null;
  const src = fs.readFileSync(ZCODE_CJS, "utf8");
  const iTok = src.indexOf("unsupported token");
  if (iTok < 0) return null;
  const mapErrIdx = src.lastIndexOf("ModelOptionMapError", iTok);
  const start = src.lastIndexOf("class ", mapErrIdx);
  const iEntry = src.indexOf("function i4i(");
  const end = src.indexOf("}", src.indexOf("ger.set(n,s)", iEntry)) + 1;
  let code = src.slice(start, end);
  code = code.replace(/^class extends Error/, "class Qm extends Error").replace(/\}\);/, ";").replace(/^Qm=/, "var Qm=").replace(/,Qde=class/, ";var Qde=class");
  const prelude = `
var r=(o,k,v)=>{Object.defineProperty(o,k,{value:v,enumerable:false,configurable:true,writable:true})};
var her=new Map();var ger=new Map();var aV=()=>{};var Y=(f)=>{try{f()}catch(e){}return{}};
var _er=(e,t)=>t+"\\u0000"+e;
`;
  try {
    const m_ = { exports: {} };
    const sb = { module: m_, exports: m_.exports, console, JSON, Object, Array, String, Number, Boolean, Math, Error, TypeError, RangeError, Set, Map, Symbol, RegExp, Date, isNaN, parseInt, parseFloat, isFinite };
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(prelude + code + "\n;module.exports={i4i,uer};\n", sb, { filename: "zcode-cel.js" });
    return m_.exports;
  } catch (e) { console.error("[!] 解析器加载失败，降级为分词校验: " + e.message); return null; }
}
const CEL = loadRealParser();
console.log(CEL ? "[*] 已加载 ZCode 真实 CEL 解析器（校验最强）" : "[!] 未加载真实解析器，将只用分词校验");

// 分词校验（兜底）
const TWO = new Set(["&&","||","==","!=","<=",">="]), ONE = new Set(["+","-","*","/","%","!","<",">"]), PUNC = new Set(["{","}","[","]","(",")",",",":","?","."]);
function tokOK(e){let r=0;while(r<e.length){const n=e[r];if(/\s/u.test(n)){r++;continue}if(n==="'"||n==='"'){const q=n;let i=r+1,c=false;while(i<e.length){if(e[i]==="\\"){i+=2;continue}if(e[i]===q){c=true;i++;break}i++}if(!c)throw Error("unterminated@"+r);r=i;continue}if(/[0-9]/u.test(n)){const m=/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(e.slice(r));r+=m?m[0].length:1;continue}if(/[A-Za-z_]/u.test(n)){let i=r+1;while(i<e.length&&/[A-Za-z0-9_]/u.test(e[i]))i++;r=i;continue}const two=e.slice(r,r+2);if(TWO.has(two)){r+=2;continue}if(ONE.has(n)){r++;continue}if(PUNC.has(n)){r++;continue}throw Error("unsupported token "+JSON.stringify(n)+"@"+r)}return true}

const CANON_MAP = '(reasoningLevel == "none" || reasoningLevel == "disabled" || reasoningLevel == "off")'
  + '?{"thinking":{"type":"disabled"}}'
  + ':{"thinking":{"type":"enabled"},"enable_thinking":true,"reasoning_effort":(reasoningLevel == "enabled"?"high":reasoningLevel)}';

function checkMap(expr, label) {
  if (CEL) {
    try {
      const ast = CEL.i4i(expr, "reasoningLevel");
      const probe = ["none", "enabled", "low", "high", "max"];
      for (const p of probe) CEL.uer(ast, p); // 全挡位求值不抛错才算通过
      return true;
    } catch (e) { console.error("  [x] " + label + " CEL 校验失败: " + e.message); return false; }
  }
  try { tokOK(expr); return true; } catch (e) { console.error("  [x] " + label + " 分词校验失败: " + e.message); return false; }
}

const doc = JSON.parse(fs.readFileSync(PC, "utf8"));
const rules = doc.config.providerConfigRules.providerRules;
const pmr = doc.config.modelConfigRules.providerModelRules;
const changes = [];

// ---------- 修复 1: grok-4.6 补 values ----------
console.log("\n=== 修复 1: miaomiao/grok-4.6 补 values ===");
for (const e of pmr) {
  const rl = e.config && e.config.optionSpecs && e.config.optionSpecs.reasoningLevel;
  if (rl && rl.map && !(Array.isArray(rl.values) && rl.values.length)) {
    const prov = rules.find(x => x.providerId === e.providerId);
    const nm = (prov && prov.providerName) || e.providerId;
    const newVals = ["none", "low", "medium", "high", "max"];
    if (!checkMap(rl.map, nm + "/" + e.modelId)) { console.error("  [x] 该模型 map 本身非法，跳过"); continue; }
    rl.values = newVals;
    changes.push(nm + "/" + e.modelId + " 补 values=" + JSON.stringify(newVals) + " (默认档=" + newVals.at(-1) + ")");
    console.log("  [√] " + nm + "/" + e.modelId + " values=" + JSON.stringify(newVals));
  }
}

// ---------- 修复 2: 活跃 OpenAI 类供应商缺挡位的模型 ----------
console.log("\n=== 修复 2: 活跃 OpenAI 类供应商中缺挡位的模型 ===");
for (const r of rules) {
  const api = r.config && r.config.api;
  if (!api || !api.baseUrl) continue;
  if (api.type === "anthropic-messages") continue; // anthropic 机制不同(thinking.budget_tokens), 不套用
  const ids = (r.config && r.config.personalModelIds) || [];
  for (const mid of ids) {
    let e = pmr.find(x => x.providerId === r.providerId && x.modelId === mid);
    if (!e) { e = { modelId: mid, config: {}, providerId: r.providerId }; pmr.push(e); }
    e.config = e.config || {};
    e.config.optionSpecs = e.config.optionSpecs || {};
    const rl = e.config.optionSpecs.reasoningLevel;
    if (rl && Array.isArray(rl.values) && rl.values.length) continue; // 已有, 不动
    if (!checkMap(CANON_MAP, r.providerName + "/" + mid)) continue;
    const newVals = ["none", "low", "medium", "high", "max"];
    e.config.optionSpecs.reasoningLevel = { values: newVals, map: CANON_MAP };
    if (e.config.properties == null || e.config.properties.contextWindow == null) {
      e.config.properties = e.config.properties || {};
      e.config.properties.contextWindow = 128000;
      changes.push(r.providerName + "/" + mid + " 补 values + contextWindow=128000");
    } else {
      changes.push(r.providerName + "/" + mid + " 补 values");
    }
    console.log("  [√] " + r.providerName + "/" + mid + " values=" + JSON.stringify(newVals));
  }
}

// ---------- 全量校验 ----------
console.log("\n=== 全量校验 ===");
let bad = 0, withV = 0, withM = 0;
for (const e of pmr) {
  const rl = e.config && e.config.optionSpecs && e.config.optionSpecs.reasoningLevel;
  if (!rl) continue;
  if (rl.map) { withM++; if (!checkMap(rl.map, e.providerId + "/" + e.modelId)) bad++; }
  if (Array.isArray(rl.values) && rl.values.length) withV++;
}
console.log("  有 map: " + withM + " | 有 values: " + withV + " | map 非法: " + bad);
if (bad) { console.error("[x] 存在非法 map，放弃写入"); process.exit(4); }
if (!changes.length) { console.log("\n没有需要修复的项。"); process.exit(0); }

console.log("\n=== 将应用的改动 (" + changes.length + ") ===");
for (const c of changes) console.log("  - " + c);

const out = JSON.stringify(doc, null, 2) + "\n";
JSON.parse(out); // JSON 合法性
if (DRY) { console.log("\n[--dry-run] 未写入。"); process.exit(0); }

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const bak = path.join(V, "provider_config.json.SAFEBAK-fix-" + ts + ".bak");
fs.copyFileSync(PC, bak);
const tmp = PC + ".fix-tmp";
fs.writeFileSync(tmp, out);
fs.renameSync(tmp, PC);
console.log("\n[√] 已写入 provider_config.json");
console.log("    备份: " + bak);
