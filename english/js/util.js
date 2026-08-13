// כלי עזר כלליים
export function el(tag, attrs = {}, ...children){
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)){
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()){
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

export function shuffle(arr){
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sample(arr, n){ return shuffle(arr).slice(0, n); }
export function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

export function todayStr(d = new Date()){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
export function daysBetween(a, b){
  return Math.round((new Date(b + "T12:00") - new Date(a + "T12:00")) / 86400000);
}
export function addDays(dateStr, n){
  const d = new Date(dateStr + "T12:00"); d.setDate(d.getDate() + n);
  return todayStr(d);
}

export function fmtMinutes(mins){
  if (mins < 60) return `${Math.round(mins)} דק'`;
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return m ? `${h} ש' ${m} דק'` : `${h} שעות`;
}

let toastTimer = null;
export function toast(msg, ms = 2600){
  let t = document.getElementById("toast");
  if (!t){
    t = el("div", {id:"toast", class:"toast"});
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

export function confetti(){
  const wrap = el("div", {class:"confetti-wrap"});
  const colors = ["#6366f1","#8b5cf6","#f59e0b","#10b981","#ec4899"];
  for (let i = 0; i < 36; i++){
    const c = el("i");
    c.style.left = Math.random()*100 + "%";
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = (Math.random()*0.5) + "s";
    c.style.animationDuration = (1.2 + Math.random()*1.2) + "s";
    wrap.append(c);
  }
  document.body.append(wrap);
  setTimeout(() => wrap.remove(), 3000);
}

// השוואת טקסטים לתרגול הגייה/הכתבה: מחזיר לכל מילת מטרה האם זוהתה
export function normalizeEn(s){
  return (s || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
}
export function compareWords(target, spoken){
  const t = normalizeEn(target).split(" ").filter(Boolean);
  const s = new Set(normalizeEn(spoken).split(" ").filter(Boolean));
  return t.map(word => ({word, ok: s.has(word)}));
}
export function accuracy(target, spoken){
  const res = compareWords(target, spoken);
  if (!res.length) return 0;
  return Math.round(100 * res.filter(r => r.ok).length / res.length);
}
