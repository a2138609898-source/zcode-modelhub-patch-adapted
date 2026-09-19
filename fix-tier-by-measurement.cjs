#!/usr/bin/env node
"use strict";
/*
 * 按【实发请求实测结果】修正推理挡位 values。
 *
 * 与 fix-provider-config.cjs 的区别：本脚本处理的是「配置里的档位被端点明确拒绝」的问题，
 * 依据是 verify-atria-full.js 的实测数据（每个档位真实发请求，解析报错信息）。
 *
 * 已确认的问题（2026-09-20 实测，复测 2 次稳定）：
 *   atria/deepseek-v4-flash-0731 : 端点要求 'low','medium','high','xhigh','max' → 移除 none, minimal
 *   atria/glm-5.3                : 端点要求 'low','high','max'（始终思考）      → 移除 none, minimal, medium, xhigh
 *   atria/qwen3.8-27b            : 端点要求 xhigh/medium/low                    → 移除 minimal
 *   atria/intern-s2              : none 被 422 拒绝                             → 移除 none
 *
 * 安全：ZCode 运行时拒写；写前备份；写后 JSON + 真实 CEL 解析器校验；原子替换。
 * 用法：node fix-tier-by-measurement.cjs [--dry-run]
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
  console.error("[x] ZCode 正在运行 — 写入会被内存覆盖，已中止。请完全退出后重试（或 --dry-run）。");
  process.exit(3);
}

// 真实 CEL 解析器（校验 map）
function loadRealParser() {
  if (!fs.existsSync(ZCODE_CJS)) return null;
  const src = fs.readFileSync(ZCODE_CJS, "utf8");
  const iTok = src.indexOf("unsupported token");
  if (iTok < 0) return null;
  const start = src.lastIndexOf("class ", src.lastIndexOf("ModelOptionMapError", iTok));
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
    vm.runInContext(prelude + code + "\n;module.exports={i4i,uer};\n", sb, { filename: "zcel.js" });
    return m_.exports;
  } catch { return null; }
}
const CEL = loadRealParser();
console.log(CEL ? "[*] 已加载真实 CEL 解析器" : "[!] 未加载真实解析器");

// ---- 基于实测的修正表 ----
// remove: 端点明确拒绝的档位（依据报错原文）
const FIXES = [
  { model: "deepseek-v4-flash-0731", remove: ["none", "minimal"], evidence: "端点: must be one of: 'low','medium','high','xhigh','max'" },
  { model: "glm-5.3", remove: ["none", "minimal", "medium", "xhigh"], evidence: "端点: 该模型始终思考，不支持关闭思考；请使用 low、high 或 max" },
  { model: "qwen3.8-27b", remove: ["minimal"], evidence: "端点: Unexpected reasoning effort minimal. Supported types are xhigh, medium, and low" },
  { model: "intern-s2", remove: ["none"], evidence: "端点: none 返回 422（不带参数则正常）" },
];

const doc = JSON.parse(fs.readFileSync(PC, "utf8"));
const pmr = doc.config.modelConfigRules.providerModelRules;
const changes = [];

console.log("\n=== 应用实测修正 ===");
for (const f of FIXES) {
  for (const e of pmr) {
    if (e.modelId !== f.model) continue;
    const rl = e.config && e.config.optionSpecs && e.config.optionSpecs.reasoningLevel;
    if (!rl || !Array.isArray(rl.values)) continue;
    const before = [...rl.values];
    const after = before.filter(v => !f.remove.includes(v));
    if (after.length === before.length) continue;  // 无需改
    if (after.length === 0) { console.error("  [x] " + f.model + " 移除后为空，跳过"); continue; }
    // 校验 map 仍然合法
    if (CEL && rl.map) {
      try {
        const ast = CEL.i4i(rl.map, "reasoningLevel");
        for (const v of after) CEL.uer(ast, v);
      } catch (err) { console.error("  [x] " + f.model + " map 校验失败: " + err.message); continue; }
    }
    rl.values = after;
    changes.push(f.model + ": " + JSON.stringify(before) + " → " + JSON.stringify(after));
    console.log("  [√] " + f.model);
    console.log("      依据: " + f.evidence);
    console.log("      " + JSON.stringify(before) + " → " + JSON.stringify(after));
  }
}

// 全量校验
console.log("\n=== 全量校验 ===");
let bad = 0, n = 0;
for (const e of pmr) {
  const rl = e.config && e.config.optionSpecs && e.config.optionSpecs.reasoningLevel;
  if (!rl || !rl.map) continue;
  n++;
  if (CEL) {
    try {
      const ast = CEL.i4i(rl.map, "reasoningLevel");
      for (const v of (rl.values || ["low"])) CEL.uer(ast, v);
    } catch (err) { bad++; console.error("  [x] " + e.providerId + "/" + e.modelId + ": " + err.message); }
  }
}
console.log("  校验 map 数: " + n + " | 失败: " + bad);
if (bad) { console.error("[x] 有 map 校验失败，放弃写入"); process.exit(4); }
if (!changes.length) { console.log("\n无需修改。"); process.exit(0); }

const out = JSON.stringify(doc, null, 2) + "\n";
JSON.parse(out);
if (DRY) { console.log("\n[--dry-run] 未写入。"); process.exit(0); }

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const bak = path.join(V, "provider_config.json.SAFEBAK-tierfix-" + ts + ".bak");
fs.copyFileSync(PC, bak);
const tmp = PC + ".tierfix-tmp";
fs.writeFileSync(tmp, out);
fs.renameSync(tmp, PC);
console.log("\n[√] 已写入 provider_config.json（" + changes.length + " 项）");
console.log("    备份: " + bak);
