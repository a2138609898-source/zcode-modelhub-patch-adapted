// 完整验证：所有 atria 模型 × 所有档位，并保存原始响应供分析
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const V = "C:/Users/86158/.zcode/v2";
const cfg = JSON.parse(fs.readFileSync(path.join(V, "provider_config.json"), "utf8"));
const rules = cfg.config.providerConfigRules.providerRules;
const pmr = cfg.config.modelConfigRules.providerModelRules;
let PROXY = "";
try { PROXY = JSON.parse(fs.readFileSync(path.join(V, "setting.json"), "utf8")).httpProxy || ""; } catch {}

function curl(url, headers, bodyObj, timeoutSec) {
  const hs = [];
  for (const [k, v] of Object.entries(headers)) hs.push("-H", k + ": " + v);
  const a = ["-sS", "--max-time", String(timeoutSec), "-w", "\n__HTTP__%{http_code}", url, ...hs, "--data-binary", "@-"];
  if (PROXY) a.push("--proxy", PROXY);
  try {
    const out = execFileSync("curl", a, { input: JSON.stringify(bodyObj), encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
    const i = out.lastIndexOf("__HTTP__");
    return { code: i >= 0 ? parseInt(out.slice(i + 8).trim(), 10) : 0, text: i >= 0 ? out.slice(0, i) : out };
  } catch (e) { return { code: 0, text: String(e && e.message || e) }; }
}
function sleep(ms) { try { execFileSync("cmd", ["/c", "ping", "127.0.0.1", "-n", String(Math.max(1, Math.round(ms / 1000)) + 1), ">nul"], { stdio: "ignore" }); } catch {} }

const atria = rules.find(x => x.providerName === "atria");
const api = atria.config.api;
const key = atria.config.access.apiKey;
const base = api.baseUrl.replace(/\/+$/, "");
const url = base + "/chat/completions";
const H = { "Content-Type": "application/json", Authorization: "Bearer " + key };
if (api.headers) for (const [k, v] of Object.entries(api.headers)) H[k] = v;

const models = (atria.config.personalModelIds) || [];
const TIERS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const OUT = [];
const results = {};

for (const mid of models) {
  results[mid] = {};
  const e = pmr.find(x => x.providerId === atria.providerId && x.modelId === mid);
  const rl = e && e.config && e.config.optionSpecs && e.config.optionSpecs.reasoningLevel;
  const cfgVals = rl && rl.values ? rl.values : [];
  for (const tier of TIERS) {
    const body = { model: mid, messages: [{ role: "user", content: "hi" }], max_tokens: 1, reasoning_effort: tier };
    const res = curl(url, H, body, 20);
    results[mid][tier] = { code: res.code, text: (res.text || "").slice(0, 300) };
    sleep(700);
  }
  // 打印
  const line = TIERS.map(t => {
    const r = results[mid][t];
    const ok = r.code >= 200 && r.code < 300;
    return t + "=" + (ok ? "✓" : (r.code === 0 ? "TO" : String(r.code)));
  }).join(" ");
  console.log("[" + mid + "] cfg=" + JSON.stringify(cfgVals));
  console.log("  " + line);
  // 提取每个失败的报错特征
  const rej = [];
  for (const t of TIERS) {
    const r = results[mid][t];
    if (r.code === 400 || r.code === 422) {
      const m = (r.text || "").match(/must be one of[^"]*|Unexpected reasoning[^"]*|supported[^"]*effort[^"]*|not supported by the current model/i);
      rej.push(t + ": " + (m ? m[0].slice(0, 120) : r.text.slice(0, 120).replace(/\s+/g, " ")));
    }
  }
  if (rej.length) for (const s of rej) console.log("    " + s);
  OUT.push({ mid, cfgVals, results: results[mid] });
  console.log();
  sleep(1000);
}

fs.writeFileSync("D:/ClaudeCode/tmp/zcode-review/atria-tier-results.json", JSON.stringify(OUT, null, 2));

// 汇总需要修复的
console.log("=== 需要修复（配置含但被端点拒绝）===");
let any = false;
for (const o of OUT) {
  const bad = [];
  for (const t of o.cfgVals) {
    const r = o.results[t];
    if (!r) continue;
    if (r.code === 400 || r.code === 422) {
      const isEnum = /must be one of|Unexpected reasoning|not supported by the current model|reasoning.?effort/i.test(r.text);
      if (isEnum) bad.push(t);
    }
  }
  if (bad.length) { any = true; console.log("  " + o.mid + " → 移除 " + bad.join(", ")); }
}
if (!any) console.log("  无");

// 汇总可用但配置缺的
console.log();
console.log("=== 可补充（实测可用但配置没有）===");
for (const o of OUT) {
  const add = [];
  for (const t of TIERS) {
    const r = o.results[t];
    if (r && r.code >= 200 && r.code < 300 && !o.cfgVals.includes(t)) add.push(t);
  }
  if (add.length) console.log("  " + o.mid + " → 可加 " + add.join(", "));
}
