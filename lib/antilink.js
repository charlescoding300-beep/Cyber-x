'use strict'
// ════════════════════════════════════════════════════════════════════
//  lib/antilink.js  —  ZEN X  |  Antilink Watchdog
//
//  ZERO index.js wiring needed for detection — your loader already does
//  it. index.js's loadDir() requires every file in lib/ and merges its
//  exports onto the shared `lib` object, and messages.upsert already
//  calls:
//
//      if (typeof lib.handleAntilink === "function")
//        lib.handleAntilink(sock, m, extractBody).catch(() => {})
//
//  So the moment this file exists in lib/, it's live on every session,
//  on every incoming message, automatically. Turning it on/off per
//  group is handled by commands/antilink.js (the .antilink command).
//
//  DETECTION PIPELINE (normalize, then match):
//   1. Strip invisible / zero-width / bidi-control characters
//   2. Normalize fullwidth Unicode (Ａ-Ｚ, ０-９, ．etc.) → ASCII
//   3. Normalize homoglyphs (Cyrillic/Greek lookalikes) → Latin letters
//   4. Normalize unicode "dot" lookalikes (。．․‧) → "."
//   5. Collapse "(dot)" / "[dot]" / " dot " → "."
//   6. Collapse spaced-out single-character sequences (w w w . c o m)
//   7. Collapse repeated punctuation/whitespace noise
//   8. Lowercase
//   9. Match protocol / invite-link / www / bare-domain patterns
//        — bare-domain check uses the FULL official IANA list of
//          1,287 top-level domains (data.iana.org/TLD), not a
//          hand-picked shortlist, so it isn't limited to .com/.net/etc.
//  10. Match bare-IP URLs (spammers sometimes skip domains entirely)
//
//  OCR: if the message is an image, the image is downloaded and run
//  through tesseract.js (if installed) so links hidden inside a
//  screenshot get caught too, not just typed text.
//  Install with:  npm install tesseract.js --save
//  If it isn't installed, OCR is silently skipped — nothing breaks.
// ════════════════════════════════════════════════════════════════════

const fs   = require('fs')
const path = require('path')

let downloadMediaMessage = null
try { ({ downloadMediaMessage } = require('@whiskeysockets/baileys')) } catch {}

let Tesseract = null
try { Tesseract = require('tesseract.js') } catch { /* OCR disabled until installed */ }

// ─────────────────────────────────────────────────────────────────────
//  Settings & warning-count storage (simple JSON files, self-contained)
// ─────────────────────────────────────────────────────────────────────
const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'antilink-settings.json')
const WARNINGS_PATH = path.join(__dirname, '..', 'data', 'antilink-warnings.json')

function ensureFile(p, def) {
    const dir = path.dirname(p)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(def))
}
function loadJson(p, def) {
    ensureFile(p, def)
    try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return def }
}
function saveJson(p, data) {
    ensureFile(p, {})
    fs.writeFileSync(p, JSON.stringify(data, null, 2))
}

const key = (phone, groupId) => `${phone}_${groupId}`

function isEnabled(phone, groupId) {
    const s = loadJson(SETTINGS_PATH, {})
    return !!s[key(phone, groupId)]?.enabled
}
function getAction(phone, groupId) {
    const s = loadJson(SETTINGS_PATH, {})
    return s[key(phone, groupId)]?.action || 'delete' // 'delete' = on default. 'warn' = 3-strike then kick. 'kick' = instant.
}
function setEnabled(phone, groupId, enabled, action) {
    const s = loadJson(SETTINGS_PATH, {})
    const k = key(phone, groupId)
    s[k] = { ...(s[k] || {}), enabled, ...(action ? { action } : {}) }
    saveJson(SETTINGS_PATH, s)
    return s[k]
}

const WARN_LIMIT = 3
function bumpWarning(groupId, jid) {
    const w = loadJson(WARNINGS_PATH, {})
    const k = `${groupId}_${jid}`
    w[k] = (w[k] || 0) + 1
    saveJson(WARNINGS_PATH, w)
    return w[k]
}
function resetWarning(groupId, jid) {
    const w = loadJson(WARNINGS_PATH, {})
    delete w[`${groupId}_${jid}`]
    saveJson(WARNINGS_PATH, w)
}

function getWarningCount(groupId, jid) {
    const w = loadJson(WARNINGS_PATH, {})
    return w[`${groupId}_${jid}`] || 0
}
const HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g

// ─── Layer 2: fullwidth Unicode block → ASCII ─────────────────────────
function defullwidth(str) {
    return str.replace(/[\uFF01-\uFF5E]/g, ch =>
        String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
    ).replace(/\u3000/g, ' ')
}

// ─── Layer 3: common homoglyphs used to spoof domains ─────────────────
const CONFUSABLES = {
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
    'і': 'i', 'ѕ': 's', 'һ': 'h', 'ԁ': 'd', 'ⅰ': 'i', 'ⅼ': 'l',
    'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K',
    'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
    'α': 'a', 'ο': 'o', 'ρ': 'p', 'ι': 'i', 'υ': 'u', 'ν': 'v',
}
function deconfuse(str) {
    return str.replace(/[\u0370-\u03FF\u0400-\u04FF]/g, ch => CONFUSABLES[ch] || ch)
}

// ─── Layer 4: unicode "dot" lookalikes ────────────────────────────────
const DOT_LOOKALIKES = /[\u3002\uFF0E\u2024\u2027]/g

function antilinkNormalize(text) {
    if (!text) return ''
    let t = text
    t = t.replace(HIDDEN_CHARS, '')
    t = defullwidth(t)
    t = deconfuse(t)
    t = t.replace(DOT_LOOKALIKES, '.')
    t = t.replace(/\s*[\(\[]\s*dot\s*[\)\]]\s*/gi, '.')
         .replace(/\s+dot\s+/gi, '.')
    t = t.replace(/(?:[a-zA-Z0-9.]\s+){2,}[a-zA-Z0-9.]/g, m => m.replace(/\s+/g, ''))
    t = t.replace(/[.]{2,}/g, '.').replace(/\s{2,}/g, ' ')
    t = t.toLowerCase()
    return t
}

// ─── Layers 9 & 10: pattern matching ──────────────────────────────────
// Full official IANA TLD list (1,287 entries) — data.iana.org/TLD
const IANA_TLDS = [
  'aaa','aarp','abb','abbott','abbvie','abc','able','abogado','abudhabi','ac','academy','accenture',
  'accountant','accountants','aco','actor','ad','ads','adult','ae','aeg','aero','aetna','af','afl',
  'africa','ag','agakhan','agency','ai','aig','airbus','airforce','airtel','akdn','al','alibaba',
  'alipay','allfinanz','allstate','ally','alsace','alstom','am','amazon','americanexpress',
  'americanfamily','amex','amfam','amica','amsterdam','analytics','android','anquan','anz','ao','aol',
  'apartments','app','apple','aq','aquarelle','ar','arab','aramco','archi','army','arpa','art','arte',
  'as','asda','asia','associates','at','athleta','attorney','au','auction','audi','audible','audio',
  'auspost','author','auto','autos','aw','aws','ax','axa','az','azure','ba','baby','baidu','banamex',
  'band','bank','bar','barcelona','barclaycard','barclays','barefoot','bargains','baseball',
  'basketball','bauhaus','bayern','bb','bbc','bbt','bbva','bcg','bcn','bd','be','beats','beauty',
  'beer','berlin','best','bestbuy','bet','bf','bg','bh','bharti','bi','bible','bid','bike','bing',
  'bingo','bio','biz','bj','black','blackfriday','blockbuster','blog','bloomberg','blue','bm','bms',
  'bmw','bn','bnpparibas','bo','boats','boehringer','bofa','bom','bond','boo','book','booking','bosch',
  'bostik','boston','bot','boutique','box','br','bradesco','bridgestone','broadway','broker','brother',
  'brussels','bs','bt','build','builders','business','buy','buzz','bv','bw','by','bz','bzh','ca','cab',
  'cafe','cal','call','calvinklein','cam','camera','camp','canon','capetown','capital','capitalone',
  'car','caravan','cards','care','career','careers','cars','casa','case','cash','casino','cat',
  'catering','catholic','cba','cbn','cbre','cc','cd','center','ceo','cern','cf','cfa','cfd','cg','ch',
  'chanel','channel','charity','chase','chat','cheap','chintai','christmas','chrome','church','ci',
  'cipriani','circle','cisco','citadel','citi','citic','city','ck','cl','claims','cleaning','click',
  'clinic','clinique','clothing','cloud','club','clubmed','cm','cn','co','coach','codes','coffee',
  'college','cologne','com','commbank','community','company','compare','computer','comsec','condos',
  'construction','consulting','contact','contractors','cooking','cool','coop','corsica','country',
  'coupon','coupons','courses','cpa','cr','credit','creditcard','creditunion','cricket','crown','crs',
  'cruise','cruises','cu','cuisinella','cv','cw','cx','cy','cymru','cyou','cz','dad','dance','data',
  'date','dating','datsun','day','dclk','dds','de','deal','dealer','deals','degree','delivery','dell',
  'deloitte','delta','democrat','dental','dentist','desi','design','dev','dhl','diamonds','diet',
  'digital','direct','directory','discount','discover','dish','diy','dj','dk','dm','dnp','do','docs',
  'doctor','dog','domains','dot','download','drive','dtv','dubai','dupont','durban','dvag','dvr','dz',
  'earth','eat','ec','eco','edeka','edu','education','ee','eg','email','emerck','energy','engineer',
  'engineering','enterprises','epson','equipment','er','ericsson','erni','es','esq','estate','et','eu',
  'eurovision','eus','events','exchange','expert','exposed','express','extraspace','fage','fail',
  'fairwinds','faith','family','fan','fans','farm','farmers','fashion','fast','fedex','feedback',
  'ferrari','ferrero','fi','fidelity','fido','film','final','finance','financial','fire','firestone',
  'firmdale','fish','fishing','fit','fitness','fj','fk','flickr','flights','flir','florist','flowers',
  'fly','fm','fo','foo','food','football','ford','forex','forsale','forum','foundation','fox','fr',
  'free','fresenius','frl','frogans','frontier','ftr','fujitsu','fun','fund','furniture','futbol',
  'fyi','ga','gal','gallery','gallo','gallup','game','games','gap','garden','gay','gb','gbiz','gd',
  'gdn','ge','gea','gent','genting','george','gf','gg','ggee','gh','gi','gift','gifts','gives',
  'giving','gl','glass','gle','global','globo','gm','gmail','gmbh','gmo','gmx','gn','godaddy','gold',
  'goldpoint','golf','goodyear','goog','google','gop','got','gov','gp','gq','gr','grainger','graphics',
  'gratis','green','gripe','grocery','group','gs','gt','gu','gucci','guge','guide','guitars','guru',
  'gw','gy','hair','hamburg','hangout','haus','hbo','hdfc','hdfcbank','health','healthcare','help',
  'helsinki','here','hermes','hiphop','hisamitsu','hitachi','hiv','hk','hkt','hm','hn','hockey',
  'holdings','holiday','homedepot','homegoods','homes','homesense','honda','horse','hospital','host',
  'hosting','hot','hotels','hotmail','house','how','hr','hsbc','ht','hu','hughes','hyatt','hyundai',
  'ibm','icbc','ice','icu','id','ie','ieee','ifm','ikano','il','im','imamat','imdb','immo',
  'immobilien','in','inc','industries','infiniti','info','ing','ink','institute','insurance','insure',
  'int','international','intuit','investments','io','ipiranga','iq','ir','irish','is','ismaili','ist',
  'istanbul','it','itau','itv','jaguar','java','jcb','je','jeep','jetzt','jewelry','jio','jll','jm',
  'jmp','jnj','jo','jobs','joburg','jot','joy','jp','jpmorgan','jprs','juegos','juniper','kaufen',
  'kddi','ke','kerryhotels','kerryproperties','kfh','kg','kh','ki','kia','kids','kim','kindle',
  'kitchen','kiwi','km','kn','koeln','komatsu','kosher','kp','kpmg','kpn','kr','krd','kred',
  'kuokgroup','kw','ky','kyoto','kz','la','lacaixa','lamborghini','lamer','land','landrover','lanxess',
  'lasalle','lat','latino','latrobe','law','lawyer','lb','lc','lds','lease','leclerc','lefrak','legal',
  'lego','lexus','lgbt','li','lidl','life','lifeinsurance','lifestyle','lighting','like','lilly',
  'limited','limo','lincoln','link','live','living','lk','llc','llp','loan','loans','locker','locus',
  'lol','london','lotte','lotto','love','lpl','lplfinancial','lr','ls','lt','ltd','ltda','lu',
  'lundbeck','luxe','luxury','lv','ly','ma','madrid','maif','maison','makeup','man','management',
  'mango','map','market','marketing','markets','marriott','marshalls','mattel','mba','mc','mckinsey',
  'md','me','med','media','meet','melbourne','meme','memorial','men','menu','merck','merckmsd','mg',
  'mh','miami','microsoft','mil','mini','mint','mit','mitsubishi','mk','ml','mlb','mls','mm','mma',
  'mn','mo','mobi','mobile','moda','moe','moi','mom','monash','money','monster','mormon','mortgage',
  'moscow','moto','motorcycles','mov','movie','mp','mq','mr','ms','msd','mt','mtn','mtr','mu','museum',
  'music','mv','mw','mx','my','mz','na','nab','nagoya','name','navy','nba','nc','ne','nec','net',
  'netbank','netflix','network','neustar','new','news','next','nextdirect','nexus','nf','nfl','ng',
  'ngo','nhk','ni','nico','nike','nikon','ninja','nissan','nissay','nl','no','nokia','norton','now',
  'nowruz','nowtv','np','nr','nra','nrw','ntt','nu','nyc','nz','obi','observer','office','okinawa',
  'olayan','olayangroup','ollo','om','omega','one','ong','onl','online','ooo','open','oracle','orange',
  'org','organic','origins','osaka','otsuka','ott','ovh','pa','page','panasonic','paris','pars',
  'partners','parts','party','pay','pccw','pe','pet','pf','pfizer','pg','ph','pharmacy','phd',
  'philips','phone','photo','photography','photos','physio','pics','pictet','pictures','pid','pin',
  'ping','pink','pioneer','pizza','pk','pl','place','play','playstation','plumbing','plus','pm','pn',
  'pnc','pohl','poker','politie','porn','post','pr','praxi','press','prime','pro','prod','productions',
  'prof','progressive','promo','properties','property','protection','pru','prudential','ps','pt','pub',
  'pw','pwc','py','qa','qpon','quebec','quest','racing','radio','re','read','realestate','realtor',
  'realty','recipes','red','redumbrella','rehab','reise','reisen','reit','reliance','ren','rent',
  'rentals','repair','report','republican','rest','restaurant','review','reviews','rexroth','rich',
  'richardli','ricoh','ril','rio','rip','ro','rocks','rodeo','rogers','room','rs','rsvp','ru','rugby',
  'ruhr','run','rw','rwe','ryukyu','sa','saarland','safe','safety','sakura','sale','salon','samsclub',
  'samsung','sandvik','sandvikcoromant','sanofi','sap','sarl','sas','save','saxo','sb','sbi','sbs',
  'sc','scb','schaeffler','schmidt','scholarships','school','schule','schwarz','science','scot','sd',
  'se','search','seat','secure','security','seek','select','sener','services','seven','sew','sex',
  'sexy','sfr','sg','sh','shangrila','sharp','shell','shia','shiksha','shoes','shop','shopping',
  'shouji','show','si','silk','sina','singles','site','sj','sk','ski','skin','sky','skype','sl',
  'sling','sm','smart','smile','sn','sncf','so','soccer','social','softbank','software','sohu','solar',
  'solutions','song','sony','soy','spa','space','sport','spot','sr','srl','ss','st','stada','staples',
  'star','statebank','statefarm','stc','stcgroup','stockholm','storage','store','stream','studio',
  'study','style','su','sucks','supplies','supply','support','surf','surgery','suzuki','sv','swatch',
  'swiss','sx','sy','sydney','systems','sz','tab','taipei','talk','taobao','target','tatamotors',
  'tatar','tattoo','tax','taxi','tc','tci','td','tdk','team','tech','technology','tel','temasek',
  'tennis','teva','tf','tg','th','thd','theater','theatre','tiaa','tickets','tienda','tips','tires',
  'tirol','tj','tjmaxx','tjx','tk','tkmaxx','tl','tm','tmall','tn','to','today','tokyo','tools','top',
  'toray','toshiba','total','tours','town','toyota','toys','tr','trade','trading','training','travel',
  'travelers','travelersinsurance','trust','trv','tt','tube','tui','tunes','tushu','tv','tvs','tw',
  'tz','ua','ubank','ubs','ug','uk','unicom','university','uno','uol','ups','us','uy','uz','va',
  'vacations','vana','vanguard','vc','ve','vegas','ventures','verisign','versicherung','vet','vg','vi',
  'viajes','video','vig','viking','villas','vin','vip','virgin','visa','vision','viva','vivo',
  'vlaanderen','vn','vodka','volvo','vote','voting','voto','voyage','vu','wales','walmart','walter',
  'wang','wanggou','watch','watches','weather','weatherchannel','web','webcam','weber','website','wed',
  'wedding','weibo','weir','wf','whoswho','wien','wiki','williamhill','win','windows','wine','winners',
  'wme','woodside','work','works','world','wow','ws','wtc','wtf','xbox','xerox','xihuan','xin','xxx',
  'xyz','yachts','yahoo','yamaxun','yandex','ye','yodobashi','yoga','yokohama','you','youtube','yt',
  'yun','za','zappos','zara','zero','zip','zm','zone','zuerich','zw'
]

const TLD_GROUP = IANA_TLDS.join('|')

const ANTILINK_PATTERNS = [
    /(?:https?|ftp):\/\/[^\s<>"{}|\\^`[\]]{2,}/gi,
    /chat\.whatsapp\.com\/[a-z0-9]{10,}/gi,
    /(?:t|telegram)\.me\/[^\s]{2,}/gi,
    /discord(?:\.gg|\.com\/invite)\/[^\s]{2,}/gi,
    /wa\.me\/[^\s]{2,}/gi,
    /www\.[a-z0-9][-a-z0-9]{0,61}(?:\.[a-z]{2,})+(?:\/[^\s]*)?/gi,
    new RegExp(`\\b[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?\\.(?:${TLD_GROUP})\\b(?:\\/[^\\s]*)?`, 'gi'),
    // layer 10 — bare IPv4 used as a link host
    /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?(?:\/[^\s]*)?/g,
]

function containsLink(rawText) {
    if (!rawText) return false
    const normalized = antilinkNormalize(rawText)
    return ANTILINK_PATTERNS.some(p => { p.lastIndex = 0; return p.test(normalized) })
}

// ─── OCR: catch links hidden inside a screenshot/image ────────────────
async function ocrExtractText(sock, msg) {
    if (!Tesseract || !downloadMediaMessage) return ''
    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {})
        const { data } = await Tesseract.recognize(buffer, 'eng')
        return data?.text || ''
    } catch (e) {
        console.error('[antilink] OCR failed:', e?.message || e)
        return ''
    }
}

async function isSenderAdmin(sock, groupId, senderJid) {
    try {
        const meta = await sock.groupMetadata(groupId)
        const p = meta.participants?.find(pt => pt.id === senderJid)
        return !!p?.admin
    } catch { return false }
}
async function isBotAdmin(sock, groupId) {
    try {
        const meta = await sock.groupMetadata(groupId)
        const myNum = (sock.user?.id || '').split(':')[0]
        const p = meta.participants?.find(pt => pt.id?.startsWith(myNum))
        return !!p?.admin
    } catch { return false }
}

/**
 * Called automatically by index.js for every non-fromMe message
 * (index.js already does: lib.handleAntilink(sock, m, extractBody)).
 * No additional wiring required.
 */
async function handleAntilink(sock, msg, extractBody) {
    const from = msg.key?.remoteJid
    if (!from || !from.endsWith('@g.us')) return
    if (msg.key.fromMe) return

    const phone = (sock.user?.id || '').split(':')[0]
    if (!isEnabled(phone, from)) return

    let body = typeof extractBody === 'function' ? extractBody(msg) : ''

    const hasImage = !!msg.message?.imageMessage
    let hit = containsLink(body)

    if (!hit && hasImage) {
        const ocrText = await ocrExtractText(sock, msg)
        if (ocrText) hit = containsLink(ocrText)
    }

    if (!hit) return

    const senderJid = msg.key.participant || msg.key.remoteJid
    if (await isSenderAdmin(sock, from, senderJid)) return
    if (!(await isBotAdmin(sock, from))) return // can't enforce without admin rights

    try { await sock.sendMessage(from, { delete: msg.key }) } catch {}

    const action = getAction(phone, from)
    if (action === 'delete') return // silent delete only, no warn/kick escalation

    if (action === 'kick') {
        try {
            await sock.groupParticipantsUpdate(from, [senderJid], 'remove')
            await sock.sendMessage(from, {
                text: `> *🚫 @${senderJid.split('@')[0]} was removed immediately for sharing a link*`,
                mentions: [senderJid],
            })
        } catch {}
        return
    }

    const count = bumpWarning(from, senderJid)
    if (count >= WARN_LIMIT) {
        resetWarning(from, senderJid)
        try {
            await sock.groupParticipantsUpdate(from, [senderJid], 'remove')
            await sock.sendMessage(from, {
                text: `> *🚫 @${senderJid.split('@')[0]} was removed for repeated link sharing (${WARN_LIMIT}/${WARN_LIMIT} warnings)*`,
                mentions: [senderJid],
            })
        } catch {}
    } else {
        await sock.sendMessage(from, {
            text: `> *⚠️ @${senderJid.split('@')[0]}, links aren't allowed here. Warning ${count}/${WARN_LIMIT}*`,
            mentions: [senderJid],
        })
    }
}

module.exports = {
    handleAntilink,
    isEnabled,
    setEnabled,
    getAction,
    containsLink,
    antilinkNormalize, // exported for testing
    resetWarning,
    getWarningCount,
    ocrEnabled: !!Tesseract,
}
