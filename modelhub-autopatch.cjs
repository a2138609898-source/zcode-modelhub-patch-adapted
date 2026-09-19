#!/usr/bin/env node
"use strict";
/*
 * modelhub 补丁 — 自动重打 / 健康检查
 *
 * 背景：ZCode 自动更新会整体替换 resources/app.asar，注入式补丁随之消失。
 * 本脚本在每次 ZCode 启动前检查补丁是否还在；不在则自动重打（需已存好"补丁源码"）。
 *
 * 原理：补丁的本质是"往 asar 里 3 个文件注入固定代码"。因此不依赖具体版本号，
 *       而是用【锚点探测】判断当前 asar 结构是否仍可注入 —— 能注入就自动注入，
 *       结构变了(锚点失配)就明确报错并退出，绝不破坏原文件。
 *
 * 用法：
 *   node modelhub-autopatch.cjs --check          # 只检查补丁是否在（退出码 0=在, 1=不在, 2=结构变了）
 *   node modelhub-autopatch.cjs                  # 不在则重打（ZCode 必须已退出）
 *   node modelhub-autopatch.cjs --install-task   # 注册计划任务：每次登录 + 每小时自动检查
 *   node modelhub-autopatch.cjs --uninstall-task # 移除计划任务
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const asar = require(path.join(__dirname, "asar.js"));

const TASK_NAME = "ZCodeModelHubAutoPatch";
const RES = path.join(process.env.LOCALAPPDATA || "", "Programs", "ZCode", "resources");
const ASAR = path.join(RES, "app.asar");
const BACKUP = path.join(RES, "app.asar.modelhub-backup");

function die(m) { console.error("[x] " + m); process.exit(1); }
function log(m) { console.log("[*] " + m); }
function zcodeRunning() {
  try { return /(^|\s)ZCode\.exe/im.test(execFileSync("tasklist", { encoding: "utf8" })); } catch { return false; }
}

// 动态发现渲染层文件名（styles-<hash>.js）——它每次构建都会变，不能写死
function readBigHeader(p) {
  const fd = fs.openSync(p, "r");
  const b = Buffer.alloc(96 * 1024 * 1024);
  fs.readSync(fd, b, 0, b.length, 0);
  fs.closeSync(fd);
  return asar.readHeader(b);
}
function findRenderEntry(p) {
  const h = readBigHeader(p);
  const assets = h.json.files.out.files.renderer.files.assets.files;
  const styles = Object.keys(assets).filter((f) => /^styles-.*\.js$/.test(f));
  if (styles.length !== 1) return null;
  return "out/renderer/assets/" + styles[0];
}

const PRELOAD_REL = "out/preload/index.cjs";
const MAIN_REL = "out/main/index.js";

// ---- 检查状态 ----
function checkState() {
  if (!fs.existsSync(ASAR)) return { state: "no-asar" };
  const RENDER_REL = findRenderEntry(ASAR);
  if (!RENDER_REL) return { state: "render-not-found" };
  let p, r;
  try {
    p = asar.readEntry(ASAR, PRELOAD_REL);
    r = asar.readEntry(ASAR, RENDER_REL);
  } catch (e) { return { state: "unreadable", error: e.message }; }
  if (!p || !r) return { state: "missing-entries" };
  const pS = p.toString("utf8"), rS = r.toString("utf8");
  const patched = pS.includes("modelhubFetchModels") && rS.includes("__mhPick");
  if (patched) return { state: "patched", render: RENDER_REL };
  // 未打补丁 → 判断是否"可注入"
  const canPreload = pS.includes('exposeInMainWorld("zcode",{connectRemote');
  const hasVrt = /\(0,\$\.jsx\)\((mbn|vRt),\{providerId:e\.providerId/.test(rS);
  return { state: "unpatched", render: RENDER_REL, canPreload, hasVrt };
}

const args = process.argv.slice(2);

if (args.includes("--install-task")) {
  const script = path.resolve(__filename);
  const cmd = `"${process.execPath}" "${script}"`;
  try {
    execFileSync("schtasks", ["/create", "/tn", TASK_NAME, "/sc", "onlogon", "/tr", cmd, "/f", "/rl", "highest"], { stdio: "inherit" });
    execFileSync("schtasks", ["/create", "/tn", TASK_NAME + "Hourly", "/sc", "hourly", "/tr", cmd, "/f", "/rl", "highest"], { stdio: "inherit" });
    console.log("\n[√] 已注册计划任务：登录时 + 每小时 自动检查补丁");
    console.log("    任务名: " + TASK_NAME + " / " + TASK_NAME + "Hourly");
    console.log("    说明: 检查到补丁缺失会自动重打(需 ZCode 未运行)；结构变化则只告警不破坏。");
  } catch (e) { die("注册计划任务失败: " + e.message + "\n（可能需要管理员权限）"); }
  process.exit(0);
}
if (args.includes("--uninstall-task")) {
  for (const t of [TASK_NAME, TASK_NAME + "Hourly"]) {
    try { execFileSync("schtasks", ["/delete", "/tn", t, "/f"], { stdio: "inherit" }); } catch {}
  }
  console.log("[√] 已移除计划任务");
  process.exit(0);
}

const st = checkState();
console.log("补丁状态: " + JSON.stringify(st, null, 2));

if (args.includes("--check")) {
  if (st.state === "patched") process.exit(0);
  if (st.state === "unpatched") process.exit(1);
  process.exit(2);
}

if (st.state === "patched") { console.log("\n[√] 补丁已就位，无需操作。"); process.exit(0); }
if (st.state !== "unpatched") die("asar 状态异常: " + st.state + " — 不自动处理，请人工检查。");

if (!st.canPreload || !st.hasVrt) {
  console.error("\n[!] ZCode 渲染层结构已变化（锚点失配）:");
  console.error("    preload 锚点: " + (st.canPreload ? "OK" : "失配"));
  console.error("    渲染层锚点:   " + (st.hasVrt ? "OK" : "失配"));
  console.error("    → 补丁需要重新适配（改写 patch-core 的锚点），未做任何修改。");
  console.error("    提示: 运行 node modelhub-patch/patch-core-314.js 并按其报错信息定位新锚点。");
  process.exit(2);
}

if (zcodeRunning()) die("ZCode 正在运行 — 重打补丁需要 ZCode 完全退出。");

// 调用适配版补丁脚本
const PATCHERS = ["patch-core-314.js", "patch-core-adapted.js", "patch-core.js"]
  .map((f) => path.join(__dirname, f))
  .filter((f) => fs.existsSync(f));
if (!PATCHERS.length) die("未找到补丁脚本(patch-core*.js)，请与本脚本放在同一目录。");

log("补丁缺失，正在自动重打…");
let ok = false;
for (const p of PATCHERS) {
  try {
    execFileSync(process.execPath, [p, RES], { stdio: "inherit" });
    ok = true; break;
  } catch (e) {
    console.error("[!] " + path.basename(p) + " 失败，尝试下一个…");
  }
}
if (!ok) die("所有补丁脚本均失败 — 锚点可能需要重新适配。");
console.log("\n[√] 自动重打完成。下次启动 ZCode 即可看到「拉取模型」按钮。");
