// ─────────────────────────────────────────────────────────────────────────────
// server.js  —  CYBER X  |  Gateway + Website + Bot Manager
// Run with:  node server.js
// Render start command: node server.js
// ─────────────────────────────────────────────────────────────────────────────
"use strict"
require("dotenv").config()

const http      = require("http")
const fs        = require("fs")
const path      = require("path")
const { spawn } = require("child_process")
const QRCode    = require("qrcode")
const Pino      = require("pino")

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys")

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const PORT           = process.env.PORT           || 10000
const MANAGER_SECRET = process.env.MANAGER_SECRET || "RGNpLM3n5OcA78bMB8YGYFjRmAWBh1Gb"
const OWNER_PHONE    = (process.env.OWNER_NUMBER  || "2348120382097").replace(/\D/g, "")
const BOT_SCRIPT     = path.join(__dirname, "index.js")
const GW_SESSIONS    = path.join(__dirname, "gateway_sessions")
const DATA_FILE      = path.join(__dirname, "data", "gw_instances.json")
const CMD_DIR        = path.join(__dirname, "commands")

for (const dir of [GW_SESSIONS, path.dirname(DATA_FILE)]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

process.on("uncaughtException",  e => console.error("[CRASH]",   e?.message || e))
process.on("unhandledRejection", e => console.error("[PROMISE]", e?.message || e))

// ─────────────────────────────────────────────────────────────────────────────
// WEBSITE HTML — served at / and /connect
// ─────────────────────────────────────────────────────────────────────────────
const WEBSITE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CYBER X — Official WhatsApp Bot Platform</title>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--g:#00ff41;--g2:#00cc33;--b:#00cfff;--p:#9d00ff;--r:#ff003c;--bg:#0a0a0a;--glass:rgba(0,255,65,0.04);--border:rgba(0,255,65,0.15)}
html{scroll-behavior:smooth}
body{background:var(--bg);color:#fff;font-family:'Share Tech Mono',monospace;overflow-x:hidden;cursor:default}

/* BINARY RAIN */
#matrix{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;opacity:0.18}

/* SCANLINES */
body::after{content:'';position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px);z-index:1;pointer-events:none}

/* NAV */
nav{position:fixed;top:0;left:0;right:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:14px 32px;background:rgba(0,0,0,0.9);border-bottom:1px solid var(--border);backdrop-filter:blur(10px)}
.nav-logo{font-family:'Orbitron',sans-serif;font-weight:900;font-size:18px;color:var(--g);text-shadow:0 0 20px var(--g);letter-spacing:3px}
.nav-status{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--g)}
.pulse{width:8px;height:8px;border-radius:50%;background:var(--g);animation:pulse 2s infinite;box-shadow:0 0 8px var(--g)}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}

/* HERO */
#hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:100px 24px 60px;position:relative;z-index:2}

.glitch{font-family:'Orbitron',sans-serif;font-weight:900;font-size:clamp(52px,12vw,110px);color:var(--g);text-shadow:0 0 40px var(--g),0 0 80px rgba(0,255,65,0.3);letter-spacing:4px;position:relative;animation:flicker 6s infinite}
@keyframes flicker{0%,95%,100%{opacity:1;text-shadow:0 0 40px var(--g),0 0 80px rgba(0,255,65,0.3)}96%,98%{opacity:.8;text-shadow:0 0 20px var(--g)}}
.glitch::before,.glitch::after{content:'CYBER X';position:absolute;top:0;left:0;width:100%}
.glitch::before{color:var(--b);clip-path:polygon(0 30%,100% 30%,100% 50%,0 50%);transform:translateX(-3px);animation:glitch1 4s infinite;opacity:.7}
.glitch::after{color:var(--r);clip-path:polygon(0 60%,100% 60%,100% 80%,0 80%);transform:translateX(3px);animation:glitch2 4s infinite;opacity:.7}
@keyframes glitch1{0%,90%,100%{transform:translateX(0)}92%{transform:translateX(-4px)}94%{transform:translateX(4px)}}
@keyframes glitch2{0%,90%,100%{transform:translateX(0)}93%{transform:translateX(4px)}95%{transform:translateX(-4px)}}

.tagline{font-size:12px;letter-spacing:4px;color:rgba(0,255,65,0.5);text-transform:uppercase;margin:8px 0 24px}
.dev-credit{font-size:13px;color:rgba(255,255,255,0.3);margin-bottom:32px}
.dev-credit span{color:var(--g)}

#typed-wrap{font-family:'Orbitron',sans-serif;font-size:clamp(14px,3vw,22px);font-weight:700;color:var(--b);min-height:36px;margin-bottom:40px;text-shadow:0 0 16px var(--b)}
.cursor{display:inline-block;width:2px;height:1.1em;background:var(--g);animation:blink .8s infinite;vertical-align:middle;margin-left:3px}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}

.cta{padding:16px 48px;font-family:'Orbitron',sans-serif;font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase;background:transparent;border:2px solid var(--g);color:var(--g);border-radius:4px;cursor:pointer;transition:all .3s;text-shadow:0 0 10px var(--g);box-shadow:0 0 20px rgba(0,255,65,0.2);position:relative;overflow:hidden}
.cta::before{content:'';position:absolute;inset:0;background:var(--g);transform:translateX(-100%);transition:transform .3s;z-index:-1}
.cta:hover{color:#000;text-shadow:none}
.cta:hover::before{transform:translateX(0)}

.stats{display:flex;flex-wrap:wrap;gap:16px;justify-content:center;margin-top:48px}
.stat{padding:8px 20px;border:1px solid var(--border);color:var(--g);font-size:11px;letter-spacing:2px;background:var(--glass)}

/* BOOT TERMINAL */
#boot{position:fixed;inset:0;z-index:999;background:#000;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:40px}
.boot-text{font-family:'Share Tech Mono',monospace;font-size:13px;color:var(--g);max-width:600px;width:100%;line-height:1.8}
.boot-line{opacity:0;transform:translateY(4px);transition:all .2s}
.boot-line.show{opacity:1;transform:translateY(0)}
.boot-bar{width:100%;height:3px;background:rgba(0,255,65,0.1);margin-top:24px;border-radius:2px;overflow:hidden}
.boot-fill{height:100%;background:var(--g);width:0%;transition:width .05s;box-shadow:0 0 10px var(--g)}

/* SECTIONS */
section{position:relative;z-index:2;padding:100px 24px}
.sec-title{font-family:'Orbitron',sans-serif;font-size:clamp(20px,5vw,36px);font-weight:900;color:var(--g);text-align:center;margin-bottom:8px;text-shadow:0 0 20px rgba(0,255,65,0.4);letter-spacing:2px}
.sec-sub{text-align:center;font-size:12px;color:rgba(255,255,255,0.3);margin-bottom:48px;letter-spacing:2px}

/* CONNECT */
#connect{display:flex;flex-direction:column;align-items:center}
.steps{display:flex;align-items:center;gap:0;margin-bottom:40px}
.step-item{display:flex;align-items:center;gap:8px}
.step-num{width:32px;height:32px;border-radius:50%;border:2px solid rgba(0,255,65,0.2);display:flex;align-items:center;justify-content:center;font-size:12px;color:rgba(0,255,65,0.3);font-family:'Orbitron',sans-serif;font-weight:700;transition:all .3s}
.step-num.active{border-color:var(--g);color:var(--g);box-shadow:0 0 14px rgba(0,255,65,0.4)}
.step-label{font-size:10px;color:rgba(255,255,255,0.3);letter-spacing:1px}
.step-line{width:40px;height:1px;background:rgba(0,255,65,0.1);margin:0 12px}

.card{width:100%;max-width:500px;border:1px solid var(--border);background:rgba(0,0,0,0.6);padding:32px;backdrop-filter:blur(10px);position:relative}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--g),transparent)}

.input-lbl{font-size:10px;letter-spacing:2px;color:rgba(0,255,65,0.6);text-transform:uppercase;margin-bottom:8px;display:block}
.input{width:100%;padding:14px 16px;background:rgba(0,255,65,0.03);border:1px solid rgba(0,255,65,0.2);color:var(--g);font-family:'Share Tech Mono',monospace;font-size:16px;letter-spacing:3px;outline:none;transition:all .2s;margin-bottom:24px}
.input:focus{border-color:var(--g);box-shadow:0 0 20px rgba(0,255,65,0.15)}
.input::placeholder{color:rgba(0,255,65,0.2);letter-spacing:1px}

.btn-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.btn{padding:14px 8px;font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;border:none;cursor:pointer;transition:all .3s;position:relative;overflow:hidden}
.btn-g{background:transparent;border:2px solid var(--g);color:var(--g)}
.btn-g:hover{background:var(--g);color:#000}
.btn-b{background:transparent;border:2px solid var(--b);color:var(--b)}
.btn-b:hover{background:var(--b);color:#000}

/* RESULT AREAS */
#result{margin-top:24px;display:none}

.loading-box{display:flex;align-items:center;gap:12px;padding:16px;border:1px solid rgba(0,255,65,0.1);background:rgba(0,255,65,0.02)}
.spin{width:18px;height:18px;border:2px solid rgba(0,255,65,0.15);border-top-color:var(--g);border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-txt{font-size:12px;color:rgba(0,255,65,0.6)}

.code-box{border:2px solid var(--g);padding:32px;text-align:center;background:rgba(0,255,65,0.03);box-shadow:0 0 40px rgba(0,255,65,0.1),inset 0 0 40px rgba(0,255,65,0.02)}
.code-label{font-size:10px;letter-spacing:3px;color:rgba(0,255,65,0.5);text-transform:uppercase;margin-bottom:16px}
.code-val{font-family:'Orbitron',sans-serif;font-size:clamp(32px,10vw,56px);font-weight:900;color:var(--g);letter-spacing:12px;text-shadow:0 0 30px var(--g),0 0 60px rgba(0,255,65,0.3)}
.code-copy{font-size:10px;color:rgba(0,255,65,0.3);margin-top:12px;cursor:pointer}
.code-copy:hover{color:var(--g)}
.code-steps{margin-top:20px;padding:16px;border:1px solid rgba(255,255,255,0.06);font-size:12px;color:rgba(255,255,255,0.4);line-height:2;text-align:left}
.code-steps strong{color:rgba(255,255,255,0.7)}
.waiting{display:flex;align-items:center;gap:10px;margin-top:16px;justify-content:center;font-size:11px;color:rgba(0,255,65,0.4)}

.qr-box{border:2px solid var(--b);padding:24px;text-align:center;background:rgba(0,207,255,0.02);box-shadow:0 0 40px rgba(0,207,255,0.1)}
.qr-box img{width:220px;height:220px;display:block;margin:0 auto 16px;image-rendering:pixelated}
.qr-steps{font-size:12px;color:rgba(255,255,255,0.4);line-height:2}

.success-box{border:2px solid var(--g);padding:32px;text-align:center;background:rgba(0,255,65,0.05);animation:success-in .4s ease}
@keyframes success-in{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
.success-icon{font-size:52px;margin-bottom:12px}
.success-title{font-family:'Orbitron',sans-serif;font-size:20px;font-weight:900;color:var(--g);text-shadow:0 0 20px var(--g);margin-bottom:8px}
.success-sub{font-size:12px;color:rgba(255,255,255,0.4)}
.btn-dash{margin-top:20px;padding:12px 32px;font-family:'Orbitron',sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;background:var(--g);color:#000;border:none;cursor:pointer;width:100%}

/* DASHBOARD */
#dashboard{display:none;flex-direction:column;align-items:center}
.dash-card{width:100%;max-width:600px;border:1px solid var(--border);background:rgba(0,0,0,0.7);padding:28px}
.dash-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px}
.dash-phone{font-family:'Orbitron',sans-serif;font-size:14px;color:rgba(255,255,255,0.7)}
.badge{padding:5px 14px;font-size:10px;font-family:'Orbitron',sans-serif;letter-spacing:2px;font-weight:700}
.badge-online{border:1px solid var(--g);color:var(--g);box-shadow:0 0 10px rgba(0,255,65,0.3)}
.badge-offline{border:1px solid var(--r);color:var(--r)}
.badge-pairing{border:1px solid #ffc800;color:#ffc800}
.badge-owner{border:1px solid #ffc800;color:#ffc800;box-shadow:0 0 10px rgba(255,200,0,0.3)}
.dash-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px}
.dash-stat{border:1px solid rgba(255,255,255,0.06);padding:14px;background:rgba(0,0,0,0.3)}
.dash-stat-label{font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.3);text-transform:uppercase;margin-bottom:4px}
.dash-stat-val{font-family:'Orbitron',sans-serif;font-size:22px;font-weight:700;color:var(--g)}
.dash-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
.act-btn{padding:8px 16px;font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;letter-spacing:1px;cursor:pointer;border:none;background:transparent;transition:all .2s}
.act-stop{border:1px solid var(--r);color:var(--r)}
.act-stop:hover{background:var(--r);color:#000}
.act-restart{border:1px solid var(--b);color:var(--b)}
.act-restart:hover{background:var(--b);color:#000}
.act-del{border:1px solid var(--p);color:var(--p)}
.act-del:hover{background:var(--p);color:#fff}
.act-out{border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.3)}
.act-out:hover{border-color:rgba(255,255,255,0.3);color:#fff}
.terminal{background:#000;border:1px solid rgba(0,255,65,0.1);padding:14px;font-size:11px;line-height:1.7;max-height:160px;overflow-y:auto;color:rgba(0,255,65,0.7)}
.terminal::-webkit-scrollbar{width:3px}
.terminal::-webkit-scrollbar-thumb{background:var(--g)}

/* BOARD */
#board{}
.board-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;max-width:700px;margin:0 auto 32px}
.board-card{border:1px solid var(--border);padding:20px;text-align:center;background:rgba(0,0,0,0.4)}
.board-num{font-family:'Orbitron',sans-serif;font-size:36px;font-weight:900;color:var(--g);text-shadow:0 0 20px rgba(0,255,65,0.4)}
.board-lbl{font-size:10px;color:rgba(255,255,255,0.3);letter-spacing:2px;margin-top:4px}
.inst-list{max-width:700px;margin:0 auto;display:flex;flex-direction:column;gap:6px}
.inst-row{display:flex;align-items:center;justify-content:space-between;border:1px solid rgba(0,255,65,0.08);padding:10px 14px;background:rgba(0,0,0,0.3)}
.inst-phone{font-family:'Share Tech Mono',monospace;font-size:12px;color:rgba(255,255,255,0.4)}

/* FEATURES */
#features{}
.feat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;max-width:900px;margin:0 auto}
.feat{border:1px solid rgba(0,255,65,0.1);padding:20px;background:rgba(0,0,0,0.3);transition:all .3s;cursor:default}
.feat:hover{border-color:var(--g);box-shadow:0 0 20px rgba(0,255,65,0.08);transform:translateY(-3px)}
.feat-icon{font-size:26px;margin-bottom:10px}
.feat-name{font-family:'Orbitron',sans-serif;font-size:11px;font-weight:700;color:var(--g);margin-bottom:6px;letter-spacing:1px}
.feat-desc{font-size:11px;color:rgba(255,255,255,0.3);line-height:1.5}

/* HOW */
.how-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;max-width:700px;margin:0 auto}
.how-card{border:1px solid rgba(0,255,65,0.1);padding:28px;text-align:center;background:rgba(0,0,0,0.4)}
.how-icon{font-size:36px;margin-bottom:14px}
.how-title{font-family:'Orbitron',sans-serif;font-size:11px;font-weight:700;color:var(--g);margin-bottom:8px}
.how-desc{font-size:11px;color:rgba(255,255,255,0.3);line-height:1.6}

/* FOOTER */
footer{border-top:1px solid var(--border);padding:40px 24px;text-align:center;position:relative;z-index:2}
.footer-logo{font-family:'Orbitron',sans-serif;font-weight:900;font-size:24px;color:var(--g);text-shadow:0 0 20px var(--g);letter-spacing:4px;margin-bottom:16px}
.footer-text{font-size:11px;color:rgba(255,255,255,0.2);line-height:2}
.footer-dev{color:var(--g)}

/* TOAST */
#toast{position:fixed;bottom:80px;right:20px;z-index:999;padding:12px 20px;font-size:12px;transform:translateY(60px);opacity:0;transition:all .3s;pointer-events:none;max-width:280px;border-left:3px solid}
#toast.show{transform:translateY(0);opacity:1}
#toast.ok{background:rgba(0,255,65,0.1);border-color:var(--g);color:var(--g)}
#toast.err{background:rgba(255,0,60,0.1);border-color:var(--r);color:var(--r)}

/* MUSIC BTN */
#music-btn{position:fixed;bottom:20px;right:20px;z-index:998;width:46px;height:46px;border-radius:50%;border:2px solid var(--g);background:rgba(0,0,0,0.8);color:var(--g);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 0 16px rgba(0,255,65,0.3);transition:all .2s}
#music-btn:hover{box-shadow:0 0 30px rgba(0,255,65,0.5)}

/* MODAL */
.overlay{display:none;position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.85);backdrop-filter:blur(6px);align-items:center;justify-content:center}
.overlay.show{display:flex}
.modal{border:1px solid var(--border);background:#060606;padding:32px;max-width:340px;width:90%;text-align:center}
.modal h3{font-family:'Orbitron',sans-serif;font-size:16px;color:var(--r);margin-bottom:12px}
.modal p{font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:24px;line-height:1.7}
.modal-btns{display:flex;gap:12px;justify-content:center}

@media(max-width:480px){
  nav{padding:12px 16px}
  .card{padding:20px}
  .btn-row{grid-template-columns:1fr}
  .dash-grid{grid-template-columns:1fr 1fr}
}
</style>
</head>
<body>

<!-- MATRIX RAIN -->
<canvas id="matrix"></canvas>

<!-- BOOT SCREEN -->
<div id="boot">
  <div class="boot-text" id="boot-text"></div>
  <div class="boot-bar"><div class="boot-fill" id="boot-fill"></div></div>
</div>

<!-- MUSIC -->
<audio id="bgm" loop>
  <source src="https://cdn.pixabay.com/audio/2022/11/22/audio_febc508520.mp3" type="audio/mpeg">
  <source src="https://cdn.pixabay.com/audio/2023/03/15/audio_8cb01bab1f.mp3" type="audio/mpeg">
</audio>
<button id="music-btn" onclick="toggleMusic()" title="Toggle Music">🎵</button>

<!-- NAV -->
<nav>
  <div class="nav-logo">CYBER X</div>
  <div class="nav-status">
    <div class="pulse"></div>
    <span>SYSTEM ONLINE</span>
  </div>
</nav>

<!-- HERO -->
<section id="hero">
  <div class="glitch">CYBER X</div>
  <div class="tagline">[ NEXT-GEN WHATSAPP AUTOMATION ]</div>
  <div class="dev-credit">Developed by <span>Charles Tech</span></div>
  <div id="typed-wrap"><span id="typed"></span><span class="cursor"></span></div>
  <button class="cta" onclick="document.getElementById('connect').scrollIntoView({behavior:'smooth'})">
    [ INITIALIZE CONNECTION ]
  </button>
  <div class="stats">
    <div class="stat">29+ COMMANDS</div>
    <div class="stat">MULTI-DEVICE</div>
    <div class="stat">24/7 ONLINE</div>
    <div class="stat">QR + PAIRING</div>
    <div class="stat">BY CHARLES TECH</div>
  </div>
</section>

<!-- CONNECT -->
<section id="connect">
  <div class="sec-title">// LINK YOUR WHATSAPP</div>
  <div class="sec-sub">[ CHOOSE YOUR CONNECTION PROTOCOL ]</div>

  <div class="steps">
    <div class="step-item">
      <div class="step-num active" id="sn1">01</div>
      <div class="step-label">ENTER NUM</div>
    </div>
    <div class="step-line"></div>
    <div class="step-item">
      <div class="step-num" id="sn2">02</div>
      <div class="step-label">CHOOSE METHOD</div>
    </div>
    <div class="step-line"></div>
    <div class="step-item">
      <div class="step-num" id="sn3">03</div>
      <div class="step-label">GO LIVE</div>
    </div>
  </div>

  <div class="card">
    <div id="pane-enter">
      <label class="input-lbl">TARGET PHONE NUMBER (WITH COUNTRY CODE)</label>
      <input class="input" type="tel" id="phone" placeholder="e.g. 2348012345678">
      <div style="font-size:10px;color:rgba(0,255,65,0.3);margin-bottom:20px;letter-spacing:1px">
        ⚠ DIGITS ONLY — NO + OR SPACES &nbsp;|&nbsp; EXAMPLE: <span style="color:var(--g)">2348012345678</span>
      </div>
      <div class="btn-row">
        <button class="btn btn-g" onclick="connect('pairing')">📱 PAIRING CODE</button>
        <button class="btn btn-b" onclick="connect('qr')">📷 QR SCAN</button>
      </div>
    </div>

    <div id="pane-loading" style="display:none">
      <div class="loading-box">
        <div class="spin"></div>
        <div class="loading-txt" id="load-txt">INITIALIZING BOT INSTANCE...</div>
      </div>
    </div>

    <div id="pane-pair" style="display:none">
      <div class="code-box">
        <div class="code-label">⚡ WHATSAPP PAIRING CODE</div>
        <div class="code-val" id="pair-code">----</div>
        <div class="code-copy" onclick="copyCode()">[ TAP TO COPY ]</div>
      </div>
      <div class="code-steps">
        <strong>HOW TO ENTER:</strong><br>
        1 → Open WhatsApp on your phone<br>
        2 → Tap ⋮ Menu → <strong>Linked Devices</strong><br>
        3 → Tap <strong>Link a Device</strong><br>
        4 → Tap <strong>"Link with phone number instead"</strong><br>
        5 → Enter the code above ☝️
      </div>
      <div class="waiting">
        <div class="spin"></div>
        <span id="wait-txt">WAITING FOR CODE ENTRY...</span>
      </div>
    </div>

    <div id="pane-qr" style="display:none">
      <div class="qr-box">
        <img id="qr-img" src="" alt="QR">
        <div class="qr-steps">
          Open WhatsApp → <strong>Linked Devices</strong> → <strong>Scan QR Code</strong>
        </div>
      </div>
      <div class="waiting" style="margin-top:16px">
        <div class="spin"></div>
        <span>WAITING FOR SCAN...</span>
      </div>
    </div>

    <div id="pane-success" style="display:none">
      <div class="success-box">
        <div class="success-icon">✅</div>
        <div class="success-title">BOT IS LIVE!</div>
        <div class="success-sub">Type <strong style="color:var(--g)">.menu</strong> in any WhatsApp chat to begin</div>
        <button class="btn-dash" onclick="showDash()">[ OPEN DASHBOARD ]</button>
      </div>
    </div>
  </div>
</section>

<!-- DASHBOARD -->
<section id="dashboard">
  <div class="sec-title">// BOT DASHBOARD</div>
  <div class="sec-sub">[ YOUR BOT STATUS & CONTROLS ]</div>
  <div class="dash-card">
    <div class="dash-header">
      <div>
        <div class="dash-phone" id="d-phone">—</div>
        <div id="owner-area" style="margin-top:6px;display:none">
          <span class="badge badge-owner">⚡ OWNER — CHARLES TECH</span>
        </div>
      </div>
      <div id="d-status" class="badge badge-offline">OFFLINE</div>
    </div>
    <div class="dash-grid">
      <div class="dash-stat"><div class="dash-stat-label">GROUPS</div><div class="dash-stat-val" id="d-groups">—</div></div>
      <div class="dash-stat"><div class="dash-stat-label">COMMANDS</div><div class="dash-stat-val" id="d-cmds">—</div></div>
      <div class="dash-stat"><div class="dash-stat-label">UPTIME</div><div class="dash-stat-val" id="d-uptime">—</div></div>
      <div class="dash-stat"><div class="dash-stat-label">MEMORY</div><div class="dash-stat-val" id="d-mem">—</div></div>
    </div>
    <div class="dash-actions">
      <button class="act-btn act-stop" onclick="act('stop')">⏹ STOP</button>
      <button class="act-btn act-restart" onclick="act('restart')">↻ RESTART</button>
      <button class="act-btn act-del" onclick="openDel()">🗑 DELETE</button>
      <button class="act-btn act-out" onclick="doLogout()">← LOGOUT</button>
    </div>
    <div style="font-size:9px;letter-spacing:2px;color:rgba(0,255,65,0.4);margin-bottom:8px">LIVE LOGS</div>
    <div class="terminal" id="d-logs">Connecting to log stream...</div>
  </div>
</section>

<!-- BOARD -->
<section id="board">
  <div class="sec-title">// LIVE NETWORK BOARD</div>
  <div class="sec-sub">[ REAL-TIME BOT STATUS — VIEW ONLY ]</div>
  <div class="board-grid">
    <div class="board-card"><div class="board-num" id="b-on">0</div><div class="board-lbl">🟢 ONLINE</div></div>
    <div class="board-card"><div class="board-num" id="b-tot">0</div><div class="board-lbl">🔵 TOTAL</div></div>
    <div class="board-card"><div class="board-num" id="b-pair">0</div><div class="board-lbl">🟡 PAIRING</div></div>
    <div class="board-card"><div class="board-num" id="b-stop">0</div><div class="board-lbl">⚫ STOPPED</div></div>
  </div>
  <div class="inst-list" id="inst-list"><div style="text-align:center;color:rgba(255,255,255,0.2);font-size:12px;padding:24px">NO ACTIVE INSTANCES</div></div>
</section>

<!-- FEATURES -->
<section id="features">
  <div class="sec-title">// CAPABILITIES</div>
  <div class="sec-sub">[ WHAT YOUR BOT CAN DO ]</div>
  <div class="feat-grid">
    <div class="feat"><div class="feat-icon">🤖</div><div class="feat-name">AI CHARACTER</div><div class="feat-desc">CYBER X AI — intelligent chat assistant</div></div>
    <div class="feat"><div class="feat-icon">🛡️</div><div class="feat-name">ANTILINK</div><div class="feat-desc">Auto-removes harmful links from groups</div></div>
    <div class="feat"><div class="feat-icon">👋</div><div class="feat-name">WELCOME/GOODBYE</div><div class="feat-desc">Custom join and leave messages</div></div>
    <div class="feat"><div class="feat-icon">🎵</div><div class="feat-name">MUSIC PLAYER</div><div class="feat-desc">Stream audio in WhatsApp groups</div></div>
    <div class="feat"><div class="feat-icon">⚠️</div><div class="feat-name">WARN SYSTEM</div><div class="feat-desc">Auto-kick on maximum warnings</div></div>
    <div class="feat"><div class="feat-icon">🏷️</div><div class="feat-name">TAG ALL</div><div class="feat-desc">Mention every group member instantly</div></div>
    <div class="feat"><div class="feat-icon">🔇</div><div class="feat-name">MUTE/UNMUTE</div><div class="feat-desc">Full group message control</div></div>
    <div class="feat"><div class="feat-icon">🕵️</div><div class="feat-name">DETECTIVE MODE</div><div class="feat-desc">User information lookup system</div></div>
    <div class="feat"><div class="feat-icon">👁️</div><div class="feat-name">VIEW ONCE REVEAL</div><div class="feat-desc">Reveals hidden view-once media</div></div>
  </div>
</section>

<!-- HOW IT WORKS -->
<section id="how">
  <div class="sec-title">// PROTOCOL</div>
  <div class="sec-sub">[ THREE STEPS TO GO LIVE ]</div>
  <div class="how-grid">
    <div class="how-card"><div class="how-icon">🔢</div><div class="how-title">01 — INPUT NUMBER</div><div class="how-desc">Enter your WhatsApp number with country code</div></div>
    <div class="how-card"><div class="how-icon">📱</div><div class="how-title">02 — AUTHENTICATE</div><div class="how-desc">Scan QR or enter pairing code in WhatsApp</div></div>
    <div class="how-card"><div class="how-icon">⚡</div><div class="how-title">03 — BOT IS LIVE</div><div class="how-desc">Type .menu in any chat to activate</div></div>
  </div>
</section>

<!-- FOOTER -->
<footer>
  <div class="footer-logo">CYBER X</div>
  <div class="footer-text">
    © 2025 CYBER X — Developed by <span class="footer-dev">Charles Tech</span>. All Rights Reserved.<br>
    Unauthorized use, copying or redistribution is strictly prohibited.<br>
    <span style="color:rgba(255,255,255,0.1);font-size:10px">[ OFFICIAL PLATFORM — BUILT WITH ❤️ BY CHARLES TECH ]</span>
  </div>
</footer>

<!-- TOAST -->
<div id="toast"></div>

<!-- DELETE MODAL -->
<div class="overlay" id="del-modal">
  <div class="modal">
    <h3>// DELETE INSTANCE?</h3>
    <p>This will permanently delete your bot session and all data. You will need to re-link your WhatsApp account.</p>
    <div class="modal-btns">
      <button class="act-btn act-del" style="padding:10px 24px" onclick="doDelete()">CONFIRM DELETE</button>
      <button class="act-btn act-out" style="padding:10px 24px" onclick="closeModal()">CANCEL</button>
    </div>
  </div>
</div>

<script>
// ── CONFIG ────────────────────────────────────────────────────────────────────
const BASE = ""  // same origin — no need for full URL
const SECRET = "RGNpLM3n5OcA78bMB8YGYFjRmAWBh1Gb"
const OWNER = "2348120382097"

// ── MATRIX RAIN ──────────────────────────────────────────────────────────────
;(function(){
  const c = document.getElementById("matrix")
  const ctx = c.getContext("2d")
  let cols, drops
  const chars = "01アイウエオカキクケコサシスセソタチツテトナニヌネノ@#$%^&*(){}[]<>?"

  function init(){
    c.width  = window.innerWidth
    c.height = window.innerHeight
    cols  = Math.floor(c.width / 16)
    drops = Array(cols).fill(1)
  }

  function draw(){
    ctx.fillStyle = "rgba(0,0,0,0.05)"
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = "#00ff41"
    ctx.font = "14px 'Share Tech Mono', monospace"
    for(let i = 0; i < drops.length; i++){
      const ch = chars[Math.floor(Math.random() * chars.length)]
      ctx.fillStyle = i % 5 === 0 ? "#00ff41" : "rgba(0,255,65,0.5)"
      ctx.fillText(ch, i * 16, drops[i] * 16)
      if(drops[i] * 16 > c.height && Math.random() > 0.975) drops[i] = 0
      drops[i]++
    }
  }

  init()
  setInterval(draw, 50)
  window.addEventListener("resize", init)
})()

// ── BOOT SEQUENCE ─────────────────────────────────────────────────────────────
;(function(){
  const lines = [
    "> CYBER X SYSTEM v3.0 — CHARLES TECH",
    "> Initializing core modules...",
    "> Loading WhatsApp gateway... [OK]",
    "> Command registry loaded... [29 commands]",
    "> Security layer active... [AES-256]",
    "> Network handshake... [ESTABLISHED]",
    "> CYBER X is ONLINE. Welcome.",
  ]
  const el = document.getElementById("boot-text")
  const fill = document.getElementById("boot-fill")
  let i = 0

  function nextLine(){
    if(i >= lines.length){
      setTimeout(() => {
        document.getElementById("boot").style.transition = "opacity .5s"
        document.getElementById("boot").style.opacity = "0"
        setTimeout(() => document.getElementById("boot").style.display = "none", 500)
        startMusic()
      }, 400)
      return
    }
    const div = document.createElement("div")
    div.className = "boot-line"
    div.textContent = lines[i]
    el.appendChild(div)
    requestAnimationFrame(() => div.classList.add("show"))
    fill.style.width = ((i + 1) / lines.length * 100) + "%"
    i++
    setTimeout(nextLine, 350)
  }
  nextLine()
})()

// ── TYPING ANIMATION ──────────────────────────────────────────────────────────
;(function(){
  const phrases = [
    "CONNECT. AUTOMATE. DOMINATE.",
    "YOUR WHATSAPP. SUPERCHARGED.",
    "POWERED BY CHARLES TECH.",
    "NEXT-GEN BOT PLATFORM.",
  ]
  let pi = 0, ci = 0, del = false
  const el = document.getElementById("typed")
  function tick(){
    const p = phrases[pi]
    if(!del){ el.textContent = p.slice(0, ++ci); if(ci === p.length){ del = true; setTimeout(tick, 2000); return } }
    else { el.textContent = p.slice(0, --ci); if(ci === 0){ del = false; pi = (pi + 1) % phrases.length } }
    setTimeout(tick, del ? 35 : 75)
  }
  tick()
})()

// ── MUSIC ─────────────────────────────────────────────────────────────────────
let musicOn = false
function startMusic(){
  const a = document.getElementById("bgm")
  a.volume = 0.3
  a.play().catch(() => {})
  musicOn = true
}
function toggleMusic(){
  const a = document.getElementById("bgm")
  const b = document.getElementById("music-btn")
  if(musicOn){ a.pause(); b.textContent = "🔇"; musicOn = false }
  else { a.play().catch(() => {}); b.textContent = "🎵"; musicOn = true }
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function toast(msg, type = "ok"){
  const t = document.getElementById("toast")
  t.textContent = msg
  t.className = "show " + type
  setTimeout(() => t.className = "", 3500)
}

// ── API ───────────────────────────────────────────────────────────────────────
async function api(method, url, body){
  const opts = {
    method,
    headers: { "Content-Type": "application/json", "X-Secret": SECRET }
  }
  if(body) opts.body = JSON.stringify(body)
  try {
    const r = await fetch(BASE + url, opts)
    return await r.json()
  } catch(e) {
    return { ok: false, error: e.message }
  }
}

// ── STEPS ─────────────────────────────────────────────────────────────────────
function setStep(n){
  for(let i = 1; i <= 3; i++){
    document.getElementById("sn"+i).classList.toggle("active", i <= n)
  }
}

function showPane(id){
  for(const p of ["pane-enter","pane-loading","pane-pair","pane-qr","pane-success"])
    document.getElementById(p).style.display = "none"
  document.getElementById(id).style.display = "block"
}

// ── CONNECT ───────────────────────────────────────────────────────────────────
let pollTimer = null
let curPhone = ""

async function connect(method){
  const phone = document.getElementById("phone").value.replace(/\\D/g, "")
  if(!phone || phone.length < 7){
    toast("Enter a valid phone number with country code", "err")
    return
  }
  curPhone = phone
  setStep(2)
  showPane("pane-loading")
  document.getElementById("load-txt").textContent = "INITIALIZING BOT INSTANCE..."

  const res = await api("POST", "/instance/create", { phone, method })

  if(!res.ok && res.error){
    toast("Error: " + res.error, "err")
    showPane("pane-enter")
    setStep(1)
    return
  }

  if(res.status === "online"){ handleOnline(phone); return }

  setStep(3)
  if(method === "pairing") pollPair(phone)
  else pollQR(phone)
}

function pollPair(phone){
  showPane("pane-loading")
  document.getElementById("load-txt").textContent = "REQUESTING PAIRING CODE..."
  clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    const d = await api("GET", "/instance/" + phone + "/pair")
    const code = d.pairCode || d.pairingCode
    if(d.status === "online"){ clearInterval(pollTimer); handleOnline(phone); return }
    if(code){
      clearInterval(pollTimer)
      document.getElementById("pair-code").textContent = code
      showPane("pane-pair")
      // Keep polling for online status
      pollTimer = setInterval(async () => {
        const s = await api("GET", "/instance/" + phone + "/pair")
        if(s.status === "online"){ clearInterval(pollTimer); handleOnline(phone) }
        else document.getElementById("wait-txt").textContent =
          "WAITING... " + new Date().toLocaleTimeString()
      }, 3000)
    }
  }, 3000)
}

function pollQR(phone){
  showPane("pane-loading")
  document.getElementById("load-txt").textContent = "GENERATING QR CODE..."
  clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    const d = await api("GET", "/instance/" + phone + "/qr")
    if(d.status === "online"){ clearInterval(pollTimer); handleOnline(phone); return }
    if(d.qr){
      document.getElementById("qr-img").src = d.qr
      showPane("pane-qr")
    }
  }, 3000)
}

function handleOnline(phone){
  clearInterval(pollTimer)
  localStorage.setItem("cx_phone", phone)
  setStep(3)
  showPane("pane-success")
  toast("🟢 Bot connected successfully!", "ok")
}

function copyCode(){
  const code = document.getElementById("pair-code").textContent
  navigator.clipboard?.writeText(code).then(() => toast("Code copied!", "ok")).catch(() => {})
}

function showDash(){ loadDashboard(curPhone || localStorage.getItem("cx_phone")) }

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
let dashTimer = null, logsTimer = null

function loadDashboard(phone){
  if(!phone) return
  curPhone = phone
  document.getElementById("connect").style.display = "none"
  const ds = document.getElementById("dashboard")
  ds.style.display = "flex"
  document.getElementById("d-phone").textContent = phone
  if(phone === OWNER) document.getElementById("owner-area").style.display = "block"
  refreshDash(phone)
  refreshLogs(phone)
  clearInterval(dashTimer); clearInterval(logsTimer)
  dashTimer = setInterval(() => refreshDash(phone), 10000)
  logsTimer = setInterval(() => refreshLogs(phone), 8000)
}

async function refreshDash(phone){
  const d = await api("GET", "/instance/" + phone)
  if(!d.ok) return
  const el = document.getElementById("d-status")
  if(d.status === "online"){ el.textContent = "🟢 ONLINE"; el.className = "badge badge-online" }
  else if(d.status === "connecting"){ el.textContent = "🟡 PAIRING"; el.className = "badge badge-pairing" }
  else { el.textContent = "🔴 OFFLINE"; el.className = "badge badge-offline" }
  document.getElementById("d-groups").textContent = d.groups ?? "—"
  document.getElementById("d-cmds").textContent   = d.commands ?? "—"
  document.getElementById("d-mem").textContent    = d.memory ? d.memory + "MB" : "—"
  const up = d.uptime || 0
  document.getElementById("d-uptime").textContent =
    Math.floor(up/3600) + "h " + Math.floor((up%3600)/60) + "m"
}

async function refreshLogs(phone){
  const d = await api("GET", "/instance/" + phone + "/logs")
  const el = document.getElementById("d-logs")
  const logs = d.logs || []
  if(!logs.length){ el.textContent = "No logs yet..."; return }
  el.innerHTML = logs.slice(-10).map(l => "<div>" + l + "</div>").join("")
  el.scrollTop = el.scrollHeight
}

async function act(action){
  const r = await api("POST", "/instance/" + curPhone + "/" + action)
  if(r.ok) toast(action.toUpperCase() + " successful", "ok")
  else toast("Failed: " + r.error, "err")
  setTimeout(() => refreshDash(curPhone), 2000)
}

function openDel(){ document.getElementById("del-modal").classList.add("show") }
function closeModal(){ document.getElementById("del-modal").classList.remove("show") }

async function doDelete(){
  closeModal()
  const r = await api("DELETE", "/instance/" + curPhone)
  if(r.ok){ toast("Instance deleted", "ok"); doLogout() }
  else toast("Delete failed: " + r.error, "err")
}

function doLogout(){
  clearInterval(dashTimer); clearInterval(logsTimer)
  localStorage.removeItem("cx_phone")
  document.getElementById("dashboard").style.display = "none"
  document.getElementById("connect").style.display = "flex"
  showPane("pane-enter")
  setStep(1)
  curPhone = ""
}

// ── PUBLIC BOARD ──────────────────────────────────────────────────────────────
async function refreshBoard(){
  const r = await fetch(BASE + "/dashboard")
  const d = await r.json().catch(() => ({}))
  document.getElementById("b-on").textContent   = d.totalOnline    ?? 0
  document.getElementById("b-tot").textContent  = d.totalInstances ?? 0
  document.getElementById("b-pair").textContent = d.pairing        ?? 0
  document.getElementById("b-stop").textContent = d.stopped        ?? 0
  const list = document.getElementById("inst-list")
  const insts = d.instances || []
  list.innerHTML = insts.length === 0
    ? '<div style="text-align:center;color:rgba(255,255,255,0.15);font-size:12px;padding:24px">NO ACTIVE INSTANCES</div>'
    : insts.map(i => \`<div class="inst-row"><span class="inst-phone">\${i.phone}</span><span class="badge \${i.status==='online'?'badge-online':i.status==='connecting'?'badge-pairing':'badge-offline'}">\${i.status.toUpperCase()}</span></div>\`).join("")
}
refreshBoard()
setInterval(refreshBoard, 15000)

// ── ON LOAD ───────────────────────────────────────────────────────────────────
window.addEventListener("load", () => {
  const saved = localStorage.getItem("cx_phone")
  if(saved) setTimeout(() => loadDashboard(saved), 1500)
})
</script>
</body>
</html>`

// ─────────────────────────────────────────────────────────────────────────────
// SPAWN BOT (index.js)
// ─────────────────────────────────────────────────────────────────────────────
console.log("[SERVER] 🤖 Starting CYBER X bot (index.js)...")
let botProc = null

function spawnBot() {
  botProc = spawn(process.execPath, ["--expose-gc", BOT_SCRIPT], {
    env: { ...process.env }, cwd: __dirname, stdio: "inherit",
  })
  botProc.on("exit", (code) => {
    console.log(`[SERVER] Bot exited (${code}) — restarting in 3s...`)
    setTimeout(spawnBot, 3000)
  })
}
spawnBot()

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
const cmdRegistry = new Map()

function loadCommands() {
  if (!fs.existsSync(CMD_DIR)) return
  cmdRegistry.clear()
  let ok = 0
  for (const file of fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js"))) {
    try {
      const full = path.join(CMD_DIR, file)
      delete require.cache[require.resolve(full)]
      const mod = require(full)
      if (mod?.pattern && typeof mod.run === "function") {
        cmdRegistry.set(mod.pattern.replace(/^\./, "").toLowerCase().trim(), mod)
        ok++
      }
    } catch (e) { console.error(`[CMD] ✗ ${file}: ${e.message}`) }
  }
  console.log(`[SERVER] ✔ ${ok} commands loaded`)
}
loadCommands()

let cmdTimer = null
if (fs.existsSync(CMD_DIR)) {
  fs.watch(CMD_DIR, { persistent: false }, (_, f) => {
    if (!f?.endsWith(".js")) return
    clearTimeout(cmdTimer)
    cmdTimer = setTimeout(loadCommands, 150)
  })
}

function extractBody(msg) {
  const m = msg.message
  return m?.conversation || m?.extendedTextMessage?.text ||
         m?.imageMessage?.caption || m?.videoMessage?.caption || ""
}

async function runCommand(sock, msg, phone) {
  const body = extractBody(msg).trim()
  if (!body.startsWith(".")) return
  const slice = body.slice(1).trimStart()
  const sp    = slice.indexOf(" ")
  const cmd   = (sp === -1 ? slice : slice.slice(0, sp)).toLowerCase()
  const rest  = sp === -1 ? "" : slice.slice(sp + 1).trim()
  const command = cmdRegistry.get(cmd)
  if (!command) return
  const from   = msg.key.remoteJid
  const sender = msg.key.participant || from
  try {
    await command.run({
      sock, from, msg, sender,
      args: rest ? rest.split(/\s+/) : [],
      text: rest, full: body,
      commands: cmdRegistry,
      cmdList: [...cmdRegistry.keys()].map(k => `.${k}`).sort(),
      isOwner: sender.replace(/\D/g, "").includes(OWNER_PHONE),
      isGroup: from.endsWith("@g.us"),
      isAdmin: false, isBotAdmin: false, extractBody,
      settings: { botName: "CYBER X", prefix: ".", owner: OWNER_PHONE, get(k) { return this[k] } },
    })
  } catch (e) {
    try { await sock.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: msg }) } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCE MANAGER
// ─────────────────────────────────────────────────────────────────────────────
const instances = new Map()

function gwLog(phone, line) {
  const inst = instances.get(phone)
  const full = `[${new Date().toISOString()}] ${line}`
  console.log(`[GW:${phone}] ${line}`)
  if (!inst) return
  inst.logs.push(full)
  if (inst.logs.length > 150) inst.logs.shift()
}

function saveInstances() {
  const data = {}
  for (const [p, s] of instances.entries())
    data[p] = { method: s.method, status: s.status, startedAt: s.startedAt }
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)) } catch {}
}

function instanceMeta(phone) {
  const s = instances.get(phone)
  if (!s) return null
  return {
    phone, status: s.status, method: s.method, startedAt: s.startedAt,
    groups: s.groups || 0, msgCount: s.msgCount || 0, commands: cmdRegistry.size,
    uptime: s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : 0,
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    pairCode: s.pairingCode || null, qr: s.qr || null,
  }
}

function maskPhone(phone) {
  if (phone.length <= 7) return phone
  return phone.slice(0, 4) + "****" + phone.slice(-3)
}

async function startInstance(phone, opts = {}) {
  const existing    = instances.get(phone)
  const method      = opts.method      ?? existing?.method      ?? "qr"
  const phoneNumber = opts.phoneNumber ?? existing?.phoneNumber ?? phone
  const sessionPath = path.join(GW_SESSIONS, phone)
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
  const { version }          = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, Pino({ level: "silent" })) },
    printQRInTerminal: false, logger: Pino({ level: "silent" }),
    browser: ["CYBER X", "Chrome", "1.0"],
  })

  if (existing?.reconnectTimer) clearTimeout(existing.reconnectTimer)
  if (existing?.sock) { try { existing.sock.ev.removeAllListeners(); existing.sock.end(undefined) } catch {} }

  instances.set(phone, {
    sock, status: "connecting", qr: null, pairingCode: null,
    method, phoneNumber, startedAt: Date.now(),
    groups: 0, msgCount: existing?.msgCount || 0,
    logs: existing?.logs || [], reconnectTimer: null,
  })

  if (method === "pairing" && !state.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ""))
        const inst = instances.get(phone)
        if (inst) inst.pairingCode = code
        gwLog(phone, `🔑 Pairing code: ${code}`)
      } catch (e) { gwLog(phone, `✗ Pairing code failed: ${e.message}`) }
    }, 1500)
  }

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    const inst = instances.get(phone)
    if (!inst) return
    if (qr && method === "qr") { inst.qr = await QRCode.toDataURL(qr); gwLog(phone, "📷 QR ready") }
    if (connection === "open") {
      inst.status = "online"; inst.qr = null; inst.pairingCode = null
      gwLog(phone, `✔ Connected as ${sock.user?.id || "unknown"}`)
      try { const all = await sock.groupFetchAllParticipating(); inst.groups = Object.keys(all).length } catch {}
      saveInstances()
    }
    if (connection === "close") {
      inst.status = "stopped"
      const code = lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        gwLog(phone, "✗ Logged out"); instances.delete(phone)
        try { fs.rmSync(sessionPath, { recursive: true, force: true }) } catch {}
        saveInstances()
      } else {
        gwLog(phone, `↻ Reconnecting in 3s (code ${code})`)
        inst.reconnectTimer = setTimeout(() => startInstance(phone, { method, phoneNumber }), 3000)
      }
    }
  })

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue
      const inst = instances.get(phone)
      if (inst) inst.msgCount = (inst.msgCount || 0) + 1
      runCommand(sock, msg, phone).catch(() => {})
    }
  })
}

async function stopInstance(phone) {
  const inst = instances.get(phone)
  if (!inst) return
  if (inst.reconnectTimer) clearTimeout(inst.reconnectTimer)
  try { inst.sock?.ev?.removeAllListeners(); inst.sock?.end(undefined) } catch {}
  inst.status = "stopped"; inst.sock = null
  saveInstances(); gwLog(phone, "⏹ Stopped")
}

async function deleteInstance(phone) {
  await stopInstance(phone)
  instances.delete(phone)
  try { fs.rmSync(path.join(GW_SESSIONS, phone), { recursive: true, force: true }) } catch {}
  saveInstances()
}

async function restoreInstances() {
  if (!fs.existsSync(DATA_FILE)) return
  let data = {}
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) } catch { return }
  const phones = Object.keys(data)
  console.log(`[GW] Restoring ${phones.length} instance(s)...`)
  for (const phone of phones) {
    if (!fs.existsSync(path.join(GW_SESSIONS, phone, "creds.json"))) continue
    try { await startInstance(phone, { method: data[phone].method || "qr", phoneNumber: phone }) }
    catch (e) { console.error(`[GW] Restore ${phone} failed:`, e.message) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP SERVER
// ─────────────────────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise(resolve => {
    let b = ""
    req.on("data", d => { b += d })
    req.on("end",  () => { try { resolve(JSON.parse(b || "{}")) } catch { resolve({}) } })
    req.on("error",() => resolve({}))
  })
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin",  "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Secret,Authorization")
}

function json(res, code, data) {
  setCors(res)
  res.writeHead(code, { "Content-Type": "application/json" })
  res.end(JSON.stringify(data))
}

function checkAuth(req, res) {
  const h = req.headers["x-secret"] || (req.headers["authorization"] || "").replace("Bearer ", "")
  if (h !== MANAGER_SECRET) { json(res, 401, { ok: false, error: "Unauthorized" }); return false }
  return true
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { setCors(res); res.writeHead(204); return res.end() }

  const url    = req.url.split("?")[0]
  const method = req.method

  // ── Serve website ─────────────────────────────────────────────────────────
  if (method === "GET" && (url === "/" || url === "/connect" || url === "/pair")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    return res.end(WEBSITE_HTML)
  }

  // ── Health ────────────────────────────────────────────────────────────────
  if (url === "/health" || url === "/ping") {
    const all = [...instances.values()]
    return json(res, 200, {
      ok: true, service: "CYBER X Gateway",
      uptime: Math.floor(process.uptime()),
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
      online: all.filter(i => i.status === "online").length,
      total: instances.size, commands: cmdRegistry.size,
    })
  }

  // ── POST /instance/create ─────────────────────────────────────────────────
  if (url === "/instance/create" && method === "POST") {
    if (!checkAuth(req, res)) return
    const body  = await readBody(req)
    const phone = (body.phone || "").replace(/\D/g, "")
    const mth   = body.method || "qr"
    if (!phone || phone.length < 7) return json(res, 400, { ok: false, error: "Valid phone required with country code" })
    if (!["qr", "pairing"].includes(mth)) return json(res, 400, { ok: false, error: 'method must be "qr" or "pairing"' })
    const existing = instances.get(phone)
    if (existing?.status === "online") return json(res, 200, { ok: true, status: "online" })
    await startInstance(phone, { method: mth, phoneNumber: phone })
    return json(res, 200, { ok: true, phone, method: mth })
  }

  // ── GET /instance/:phone/qr ───────────────────────────────────────────────
  let m = url.match(/^\/instance\/(\d+)\/qr$/)
  if (m && method === "GET") {
    if (!checkAuth(req, res)) return
    const inst = instances.get(m[1])
    if (!inst) return json(res, 404, { ok: false, error: "Not found" })
    return json(res, 200, { ok: true, status: inst.status, qr: inst.qr || null })
  }

  // ── GET /instance/:phone/pair ─────────────────────────────────────────────
  m = url.match(/^\/instance\/(\d+)\/pair$/)
  if (m && method === "GET") {
    if (!checkAuth(req, res)) return
    const inst = instances.get(m[1])
    if (!inst) return json(res, 404, { ok: false, error: "Not found" })
    return json(res, 200, { ok: true, status: inst.status, pairCode: inst.pairingCode || null, pairingCode: inst.pairingCode || null })
  }

  // ── GET /instance/:phone/logs ─────────────────────────────────────────────
  m = url.match(/^\/instance\/(\d+)\/logs$/)
  if (m && method === "GET") {
    if (!checkAuth(req, res)) return
    const inst = instances.get(m[1])
    if (!inst) return json(res, 404, { ok: false, error: "Not found" })
    return json(res, 200, { ok: true, logs: inst.logs.slice(-100) })
  }

  // ── GET /instance/:phone ──────────────────────────────────────────────────
  m = url.match(/^\/instance\/(\d+)$/)
  if (m && method === "GET") {
    if (!checkAuth(req, res)) return
    const meta = instanceMeta(m[1])
    if (!meta) return json(res, 404, { ok: false, error: "Not found" })
    return json(res, 200, { ok: true, ...meta })
  }

  // ── POST /instance/:phone/stop|restart ────────────────────────────────────
  m = url.match(/^\/instance\/(\d+)\/(stop|restart)$/)
  if (m && method === "POST") {
    if (!checkAuth(req, res)) return
    const [, phone, action] = m
    if (action === "stop") await stopInstance(phone)
    else { await stopInstance(phone); setTimeout(() => startInstance(phone, { method: instances.get(phone)?.method || "qr", phoneNumber: phone }), 1500) }
    return json(res, 200, { ok: true })
  }

  // ── DELETE /instance/:phone ───────────────────────────────────────────────
  m = url.match(/^\/instance\/(\d+)$/)
  if (m && method === "DELETE") {
    if (!checkAuth(req, res)) return
    await deleteInstance(m[1])
    return json(res, 200, { ok: true, deleted: true })
  }

  // ── GET /instances ────────────────────────────────────────────────────────
  if (url === "/instances" && method === "GET") {
    if (!checkAuth(req, res)) return
    return json(res, 200, {
      ok: true,
      instances: [...instances.entries()].map(([phone, s]) => ({
        phone, status: s.status, method: s.method, startedAt: s.startedAt,
        groups: s.groups || 0, msgCount: s.msgCount || 0, commands: cmdRegistry.size,
        uptime: s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : 0,
      })),
    })
  }

  // ── GET /dashboard ────────────────────────────────────────────────────────
  if (url === "/dashboard" && method === "GET") {
    const all = [...instances.values()]
    return json(res, 200, {
      ok: true,
      totalOnline: all.filter(i => i.status === "online").length,
      totalInstances: instances.size,
      pairing: all.filter(i => i.status === "connecting").length,
      stopped: all.filter(i => i.status === "stopped").length,
      uptime: Math.floor(process.uptime()),
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
      commands: cmdRegistry.size,
      instances: [...instances.entries()].map(([phone, s]) => ({ phone: maskPhone(phone), status: s.status })),
    })
  }

  // ── GET /commands ─────────────────────────────────────────────────────────
  if (url === "/commands" && method === "GET") {
    return json(res, 200, {
      ok: true, total: cmdRegistry.size,
      commands: [...cmdRegistry.values()].map(c => ({
        pattern: c.pattern, desc: c.desc || "", usage: c.usage || "", category: c.category || "general",
      })).sort((a, b) => a.pattern.localeCompare(b.pattern)),
    })
  }

  // ── POST /admin/save ──────────────────────────────────────────────────────
  if (url === "/admin/save" && method === "POST") {
    if (!checkAuth(req, res)) return
    saveInstances()
    return json(res, 200, { ok: true, saved: true })
  }

  // ── POST /send ────────────────────────────────────────────────────────────
  if (url === "/send" && method === "POST") {
    if (!checkAuth(req, res)) return
    const { phone, to, message } = await readBody(req)
    if (!phone || !to || !message) return json(res, 400, { ok: false, error: "phone, to, message required" })
    const inst = instances.get(phone)
    if (!inst || inst.status !== "online") return json(res, 409, { ok: false, error: "Instance not connected" })
    try {
      const jid = to.includes("@") ? to : `${to.replace(/\D/g, "")}@s.whatsapp.net`
      await inst.sock.sendMessage(jid, { text: message })
      return json(res, 200, { ok: true })
    } catch (e) { return json(res, 500, { ok: false, error: e.message }) }
  }

  json(res, 404, { ok: false, error: "Not found" })
})

server.keepAliveTimeout = 120000
server.headersTimeout   = 125000

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   ⚡  CYBER X — Gateway + Website           ║
║   Port    : ${String(PORT).padEnd(30)}║
║   Website : http://localhost:${String(PORT).padEnd(16)}║
║   Secret  : ${MANAGER_SECRET ? "✔ SET" : "⚠ NOT SET"}${" ".repeat(26)}║
╚══════════════════════════════════════════════╝
  `)
  await restoreInstances()
})

process.on("SIGTERM", () => {
  console.log("[SERVER] SIGTERM — shutting down...")
  for (const [p] of instances) stopInstance(p)
  saveInstances()
  setTimeout(() => process.exit(0), 3000)
})
