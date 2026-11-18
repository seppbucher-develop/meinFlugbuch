/* Automatisch erzeugt aus service.jsx (sha256 21e5cec7078d) — nicht von Hand ändern, siehe scripts/build.js */
(function (React, ReactDOM) {
function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
}
function formatTimestamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
async function loadAllFlights() {
  const keys = await window.storage.list("flight:");
  const raw = await Promise.all((keys?.keys || []).map(async (k) => {
    try {
      const r = await window.storage.get(k);
      return r ? JSON.parse(r.value) : null;
    } catch {
      return null;
    }
  }));
  return raw.filter(Boolean);
}
async function loadAllMaterial() {
  const keys = await window.storage.list("entry:");
  const raw = await Promise.all((keys?.keys || []).map(async (k) => {
    try {
      const r = await window.storage.get(k);
      return r ? JSON.parse(r.value) : null;
    } catch {
      return null;
    }
  }));
  return raw.filter(Boolean);
}
async function loadSchirmeList() {
  try {
    const r = await window.storage.get("schirme:list");
    return r ? JSON.parse(r.value) : [];
  } catch {
    return [];
  }
}
async function loadSitzeList() {
  try {
    const r = await window.storage.get("sitze:list");
    return r ? JSON.parse(r.value) : [];
  } catch {
    return [];
  }
}
async function loadGeraeteList() {
  try {
    const r = await window.storage.get("geraete:list");
    return r ? JSON.parse(r.value) : [];
  } catch {
    return [];
  }
}
async function loadDivList() {
  try {
    const r = await window.storage.get("div:list");
    return r ? JSON.parse(r.value) : [];
  } catch {
    return [];
  }
}
function flattenForCsv(record, flattenKeys) {
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    if (flattenKeys.includes(k) && v && typeof v === "object" && !Array.isArray(v)) {
      for (const [sk, sv] of Object.entries(v)) out[`${k}.${sk}`] = sv;
    } else {
      out[k] = v;
    }
  }
  return out;
}
function csvCell(v) {
  let s;
  if (v === null || v === void 0) s = "";
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function buildCsv(records, flattenKeys = []) {
  const flat = records.map((r) => flattenForCsv(r, flattenKeys));
  const keys = [];
  const seen = /* @__PURE__ */ new Set();
  for (const r of flat) for (const k of Object.keys(r)) if (!seen.has(k)) {
    seen.add(k);
    keys.push(k);
  }
  const lines = [keys.map(csvCell).join(",")];
  for (const r of flat) lines.push(keys.map((k) => csvCell(r[k])).join(","));
  return "\uFEFF" + lines.join("\r\n");
}
function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
async function loadRawIgcFile(flightId) {
  try {
    const r = await window.storage.get(`igcfile:${flightId}`);
    if (!r || !r.value) return null;
    const buf = base64ToArrayBuffer(r.value);
    const bytes = new Uint8Array(buf);
    const isGzip = bytes.length > 2 && bytes[0] === 31 && bytes[1] === 139;
    if (!isGzip) return buf;
    if (typeof DecompressionStream === "undefined") return buf;
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await (await new Response(stream).blob()).arrayBuffer();
  } catch {
    return null;
  }
}
function buildIgcTextFromFlight(fl) {
  const t = fl.track;
  if (!t || t.length < 2) return null;
  const d = fl.rawDate || fl.date || "";
  const parts = d.split(".");
  const dateStr = parts.length === 3 ? parts[0].padStart(2, "0") + parts[1].padStart(2, "0") + parts[2].slice(-2) : "010101";
  const fmtTime = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return String(h).padStart(2, "0") + String(m).padStart(2, "0") + String(sec).padStart(2, "0");
  };
  const fmtLat = (lat) => {
    const a = Math.abs(lat), dg = Math.floor(a), m = (a - dg) * 6e4;
    return String(dg).padStart(2, "0") + String(Math.round(m)).padStart(5, "0") + (lat >= 0 ? "N" : "S");
  };
  const fmtLon = (lon) => {
    const a = Math.abs(lon), dg = Math.floor(a), m = (a - dg) * 6e4;
    return String(dg).padStart(3, "0") + String(Math.round(m)).padStart(5, "0") + (lon >= 0 ? "E" : "W");
  };
  const NL = "\r\n";
  let igc = "AXXX" + NL + "HFDTE" + dateStr + NL;
  igc += "HFPLTPILOTINCHARGE:" + (fl.pilot || "") + NL;
  igc += "HFGTYGLIDERTYPE:" + (fl.glider || "") + NL;
  igc += "HFGIDGLIDERID:" + NL;
  for (const p of t) {
    const ts = fmtTime(p.timeSec || 0);
    const alt = Math.round(p.gpsAlt || 0);
    igc += "B" + ts + fmtLat(p.lat) + fmtLon(p.lon) + "A" + String(alt).padStart(5, "0") + String(alt).padStart(5, "0") + NL;
  }
  const filenameBase = (fl.customFields?.igcFilename || fl.name || fl.id || "flug").toString();
  return { filenameBase, text: igc };
}
function SectionHeader({ title, sectionKey, open, onToggle }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, title), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => onToggle(sectionKey),
      "aria-label": open ? "Erklärung ausblenden" : "Erklärung einblenden",
      style: { flexShrink: 0, background: "transparent", border: "none", color: "rgba(232,244,253,0.45)", fontSize: 15, cursor: "pointer", padding: "2px 4px", lineHeight: 1 }
    },
    open ? "▾" : "▸"
  ));
}
const NOTIZEN_KEY = "settings:serviceNotizen";
let notizenZaehler = 0;
function neueNotizZeile(todo = false, text = "") {
  notizenZaehler += 1;
  return { id: Date.now().toString(36) + notizenZaehler.toString(36) + Math.random().toString(36).slice(2, 6), todo, erledigt: false, text };
}
function passeHoehe(el) {
  if (!el.scrollHeight) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}
function NotizenCard({ open, onToggle }) {
  const [liste, setListe] = React.useState([]);
  const [geladen, setGeladen] = React.useState(false);
  const listeRef = React.useRef([]);
  const aktiv = React.useRef(null);
  const fokus = React.useRef(null);
  const timer = React.useRef(null);
  const root = React.useRef(null);
  const [platzhalter, setPlatzhalter] = React.useState(() => neueNotizZeile());
  React.useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(NOTIZEN_KEY);
        const roh = r && r.value ? JSON.parse(r.value) : [];
        if (Array.isArray(roh)) {
          const l = roh.filter((z) => z && typeof z.id === "string" && typeof z.text === "string").map((z) => ({ id: z.id, todo: !!z.todo, erledigt: !!z.todo && !!z.erledigt, text: z.text }));
          listeRef.current = l;
          setListe(l);
        }
      } catch {
      }
      setGeladen(true);
    })();
  }, []);
  React.useEffect(() => {
    if (!fokus.current) return;
    const input = root.current && root.current.querySelector('[data-id="' + fokus.current + '"] textarea');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    fokus.current = null;
  });
  const speichere = (l) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await window.storage.set(NOTIZEN_KEY, JSON.stringify(l));
        await window.storage.set("settings:backupDirty", "1");
      } catch {
      }
    }, 300);
  };
  const aendere = (f) => {
    let basis = listeRef.current;
    if (basis.length === 0) {
      basis = [platzhalter];
      setPlatzhalter(neueNotizZeile());
    }
    const neu = f(basis);
    listeRef.current = neu;
    setListe(neu);
    speichere(neu);
  };
  const ersetze = (l, id, f) => l.map((z) => z.id === id ? f(z) : z);
  const anzeige = liste.length ? liste : [platzhalter];
  const nachbar = (id, d) => {
    const z = anzeige[anzeige.findIndex((x) => x.id === id) + d];
    return z && z.id;
  };
  const taste = (e, z) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const neu = neueNotizZeile(z.todo);
      aendere((l) => {
        const i = l.findIndex((x) => x.id === z.id);
        return [...l.slice(0, i + 1), neu, ...l.slice(i + 1)];
      });
      fokus.current = neu.id;
    } else if (e.key === "Backspace" && e.target.value === "") {
      if (z.todo) {
        e.preventDefault();
        aendere((l) => ersetze(l, z.id, (x) => ({ ...x, todo: false, erledigt: false })));
        fokus.current = z.id;
      } else if (liste.length > 1) {
        e.preventDefault();
        fokus.current = nachbar(z.id, -1) || nachbar(z.id, 1);
        aendere((l) => l.filter((x) => x.id !== z.id));
      }
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const id = nachbar(z.id, e.key === "ArrowUp" ? -1 : 1);
      if (id) {
        e.preventDefault();
        fokus.current = id;
        setListe((l) => [...l]);
      }
    }
  };
  const einfuegen = (e, z) => {
    const text = e.clipboardData.getData("text");
    if (text.indexOf("\n") === -1) return;
    e.preventDefault();
    const inp = e.target;
    const vorne = inp.value.slice(0, inp.selectionStart);
    const hinten = inp.value.slice(inp.selectionEnd);
    const teile = text.replace(/\r/g, "").split("\n").filter((t, i, a) => t !== "" || i < a.length - 1);
    const neue = teile.map((t, i) => {
      const k = neueNotizZeile(z.todo);
      const m = /^\s*[-*]\s\[( |x|X)\]\s?(.*)$/.exec(t);
      if (m) {
        k.todo = true;
        k.erledigt = m[1] !== " ";
        k.text = m[2];
      } else {
        k.text = t;
      }
      if (i === 0) k.text = vorne + k.text;
      if (i === teile.length - 1) k.text += hinten;
      return k;
    });
    aendere((l) => {
      const i = l.findIndex((x) => x.id === z.id);
      return [...l.slice(0, i), ...neue, ...l.slice(i + 1)];
    });
    fokus.current = neue[neue.length - 1].id;
  };
  const todoUmschalten = () => {
    const id = anzeige.some((z) => z.id === aktiv.current) ? aktiv.current : anzeige[anzeige.length - 1].id;
    aendere((l) => ersetze(l, id, (x) => ({ ...x, todo: !x.todo, erledigt: false })));
    fokus.current = id;
  };
  const hatErledigte = liste.some((z) => z.todo && z.erledigt);
  const aufraeumen = () => {
    if (!hatErledigte || !confirm("Alle erledigten Todos entfernen?")) return;
    aendere((l) => l.filter((z) => !(z.todo && z.erledigt)));
  };
  const btn = { background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 10, padding: "8px 14px", color: "#7dd3fc", fontSize: 13, fontWeight: 700, cursor: "pointer" };
  return /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 } }, /* @__PURE__ */ React.createElement(SectionHeader, { title: "📝 Notizen", sectionKey: "notizen", open, onToggle }), open && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 14, lineHeight: 1.5 } }, "Freie Notizen, Zeile für Zeile. „☑ Todo” macht die aktuelle Zeile zu einem Todo mit Checkbox (nochmals klicken = wieder normaler Text). Enter = neue Zeile, Rückschritt in leerer Zeile = Zeile entfernen. Wird mit dem Backup gesichert."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 } }, /* @__PURE__ */ React.createElement("button", { onClick: todoUmschalten, style: btn }, "☑ Todo"), /* @__PURE__ */ React.createElement("button", { onClick: aufraeumen, disabled: !hatErledigte, style: { ...btn, opacity: hatErledigte ? 1 : 0.4, cursor: hatErledigte ? "pointer" : "default" } }, "Erledigte entfernen")), /* @__PURE__ */ React.createElement("div", { ref: root }, geladen && anzeige.map((z) => /* @__PURE__ */ React.createElement("div", { key: z.id, "data-id": z.id, style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4, opacity: z.todo && z.erledigt ? 0.5 : 1 } }, z.todo && /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "checkbox",
      "aria-label": "Erledigt",
      checked: z.erledigt,
      onChange: (e) => aendere((l) => ersetze(l, z.id, (x) => ({ ...x, erledigt: e.target.checked }))),
      style: { width: 20, height: 20, flexShrink: 0 }
    }
  ), /* @__PURE__ */ React.createElement(
    "textarea",
    {
      rows: 1,
      value: z.text,
      placeholder: anzeige.length <= 1 ? "Notiz schreiben …" : "",
      ref: (el) => {
        if (el) passeHoehe(el);
      },
      onFocus: () => {
        aktiv.current = z.id;
      },
      onChange: (e) => {
        passeHoehe(e.target);
        aendere((l) => ersetze(l, z.id, (x) => ({ ...x, text: e.target.value })));
      },
      onKeyDown: (e) => taste(e, z),
      onPaste: (e) => einfuegen(e, z),
      style: { flex: 1, minWidth: 0, boxSizing: "border-box", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "8px 10px", color: "#e8f4fd", fontSize: 14, fontFamily: "inherit", lineHeight: 1.4, resize: "none", overflow: "hidden", overflowWrap: "anywhere", textDecoration: z.todo && z.erledigt ? "line-through" : "none" }
    }
  )))));
}
function ServiceApp() {
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [stats, setStats] = React.useState(null);
  const fileRef = React.useRef(null);
  const [openInfo, setOpenInfo] = React.useState({});
  const toggleInfo = (key) => setOpenInfo((o) => ({ ...o, [key]: !o[key] }));
  const [maptilerKey, setMaptilerKey] = React.useState("");
  const [maptilerKeySaved, setMaptilerKeySaved] = React.useState(false);
  React.useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("settings:maptilerApiKey");
        if (r && r.value) {
          setMaptilerKey(r.value);
          setMaptilerKeySaved(true);
        }
      } catch {
      }
    })();
  }, []);
  const saveMaptilerKey = async () => {
    const trimmed = maptilerKey.trim();
    try {
      if (trimmed) await window.storage.set("settings:maptilerApiKey", trimmed);
      else await window.storage.delete("settings:maptilerApiKey");
      await window.storage.set("settings:backupDirty", "1");
      setMaptilerKeySaved(!!trimmed);
      setMsg({ type: "ok", text: trimmed ? "✓ MapTiler-Schlüssel gespeichert." : "✓ MapTiler-Schlüssel entfernt — Flugbuch nutzt wieder den eingebauten Standard-Schlüssel." });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Speichern: " + (e.message || String(e)) });
    }
  };
  const [googleClientId, setGoogleClientId] = React.useState("");
  const [googleClientIdSaved, setGoogleClientIdSaved] = React.useState(false);
  const [googleCalendarId, setGoogleCalendarId] = React.useState("");
  const [googlePistachioLabelId, setGooglePistachioLabelId] = React.useState("");
  React.useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("settings:googleClientId");
        if (r && r.value) {
          setGoogleClientId(r.value);
          setGoogleClientIdSaved(true);
        }
        const c = await window.storage.get("settings:googleCalendarId");
        if (c && c.value) setGoogleCalendarId(c.value);
        const l = await window.storage.get("settings:googlePistachioLabelId");
        if (l && l.value) setGooglePistachioLabelId(l.value);
      } catch {
      }
    })();
  }, []);
  const saveGoogleCalendarSettings = async () => {
    const trimmedId = googleClientId.trim();
    const trimmedCal = googleCalendarId.trim();
    const trimmedLabel = googlePistachioLabelId.trim();
    try {
      if (trimmedId) await window.storage.set("settings:googleClientId", trimmedId);
      else await window.storage.delete("settings:googleClientId");
      if (trimmedCal) await window.storage.set("settings:googleCalendarId", trimmedCal);
      else await window.storage.delete("settings:googleCalendarId");
      if (trimmedLabel) await window.storage.set("settings:googlePistachioLabelId", trimmedLabel);
      else await window.storage.delete("settings:googlePistachioLabelId");
      await window.storage.set("settings:backupDirty", "1");
      setGoogleClientIdSaved(!!trimmedId);
      setMsg({ type: "ok", text: trimmedId ? "✓ Google-Kalender-Einstellungen gespeichert." : "✓ Google-Client-ID entfernt." });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Speichern: " + (e.message || String(e)) });
    }
  };
  const [placeRadius, setPlaceRadius] = React.useState("0.5");
  const [placeRadiusSaved, setPlaceRadiusSaved] = React.useState(false);
  React.useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("settings:placeMatchRadiusKm");
        if (r && r.value) {
          setPlaceRadius(r.value);
          setPlaceRadiusSaved(true);
        }
      } catch {
      }
    })();
  }, []);
  const savePlaceRadius = async () => {
    const num = parseFloat(placeRadius.replace(",", "."));
    if (!isFinite(num) || num <= 0) {
      setMsg({ type: "error", text: "Bitte eine Zahl grösser 0 eingeben (z.B. 0.5)." });
      return;
    }
    try {
      await window.storage.set("settings:placeMatchRadiusKm", String(num));
      await window.storage.set("settings:backupDirty", "1");
      setPlaceRadiusSaved(true);
      setMsg({ type: "ok", text: `✓ Radius gespeichert: ${num} km.` });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Speichern: " + (e.message || String(e)) });
    }
  };
  const [nearbyRadius, setNearbyRadius] = React.useState("5");
  const [nearbyRadiusSaved, setNearbyRadiusSaved] = React.useState(false);
  React.useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("settings:nearbyRadiusKm");
        if (r && r.value) {
          setNearbyRadius(r.value);
          setNearbyRadiusSaved(true);
        }
      } catch {
      }
    })();
  }, []);
  const saveNearbyRadius = async () => {
    const num = parseFloat(nearbyRadius.replace(",", "."));
    if (!isFinite(num) || num <= 0) {
      setMsg({ type: "error", text: "Bitte eine Zahl grösser 0 eingeben (z.B. 5)." });
      return;
    }
    try {
      await window.storage.set("settings:nearbyRadiusKm", String(num));
      await window.storage.set("settings:backupDirty", "1");
      setNearbyRadiusSaved(true);
      setMsg({ type: "ok", text: `✓ Radius gespeichert: ${num} km.` });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Speichern: " + (e.message || String(e)) });
    }
  };
  const [networkFirst, setNetworkFirst] = React.useState(false);
  const sendCacheStrategyToSw = async (value) => {
    try {
      if (!("serviceWorker" in navigator)) return;
      const reg = await navigator.serviceWorker.getRegistration();
      reg?.active?.postMessage({ type: "setCacheStrategy", value });
    } catch {
    }
  };
  React.useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("settings:cacheStrategy");
        const value = r?.value === "network-first" ? "network-first" : "stale-while-revalidate";
        setNetworkFirst(value === "network-first");
        sendCacheStrategyToSw(value);
      } catch {
      }
    })();
  }, []);
  const saveNetworkFirst = async (checked) => {
    const value = checked ? "network-first" : "stale-while-revalidate";
    setNetworkFirst(checked);
    try {
      await window.storage.set("settings:cacheStrategy", value);
      await window.storage.set("settings:backupDirty", "1");
      await sendCacheStrategyToSw(value);
      setMsg({ type: "ok", text: checked ? "✓ Network-First aktiviert — neue Versionen sind ab dem nächsten Öffnen sofort sichtbar." : "✓ Wieder auf die Standard-Strategie umgestellt (sofort aus dem Zwischenspeicher, Updates ab dem übernächsten Öffnen)." });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Speichern: " + (e.message || String(e)) });
    }
  };
  const fsapiSupported = typeof window !== "undefined" && !!window.showDirectoryPicker;
  const [dirHandle, setDirHandle] = React.useState(null);
  const [dirName, setDirName] = React.useState(null);
  const [dirPermission, setDirPermission] = React.useState("prompt");
  React.useEffect(() => {
    if (!fsapiSupported) return;
    (async () => {
      try {
        const handle = await window.fsapiHandle.get("backupDir");
        if (handle) {
          setDirHandle(handle);
          setDirName(handle.name);
          try {
            const perm = await handle.queryPermission({ mode: "readwrite" });
            setDirPermission(perm);
            if (perm === "granted") refreshFolderBackups(handle);
          } catch {
            setDirPermission("prompt");
          }
        }
      } catch (e) {
        console.error("Backup-Ordner laden fehlgeschlagen:", e);
      }
    })();
  }, [fsapiSupported]);
  const [folderBackups, setFolderBackups] = React.useState([]);
  const [loadingFolderBackups, setLoadingFolderBackups] = React.useState(false);
  const refreshFolderBackups = async (handle) => {
    const h = handle || dirHandle;
    if (!h) {
      setFolderBackups([]);
      return;
    }
    setLoadingFolderBackups(true);
    try {
      const found = [];
      for await (const [name, entry] of h.entries()) {
        if (entry.kind !== "file") continue;
        if (!/^flugbuch-backup-.*\.(json|json\.gz)$/i.test(name)) continue;
        try {
          const file = await entry.getFile();
          found.push({ name, lastModified: file.lastModified, size: file.size, handle: entry });
        } catch {
        }
      }
      found.sort((a, b) => b.lastModified - a.lastModified);
      setFolderBackups(found);
    } catch (e) {
      console.error("Ordner-Inhalt lesen fehlgeschlagen:", e);
      setFolderBackups([]);
    } finally {
      setLoadingFolderBackups(false);
    }
  };
  const opfsSupported = !fsapiSupported && typeof navigator !== "undefined" && !!(navigator.storage && navigator.storage.getDirectory);
  const [opfsBackups, setOpfsBackups] = React.useState([]);
  const getOpfsDir = async () => {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle("backups", { create: true });
  };
  const refreshOpfsBackups = async () => {
    if (!opfsSupported) return;
    try {
      const dir = await getOpfsDir();
      const found = [];
      for await (const [name, entry] of dir.entries()) {
        if (entry.kind !== "file") continue;
        if (!/^flugbuch-backup-.*\.(json|json\.gz)$/i.test(name)) continue;
        try {
          const file = await entry.getFile();
          found.push({ name, lastModified: file.lastModified, size: file.size, handle: entry });
        } catch {
        }
      }
      found.sort((a, b) => b.lastModified - a.lastModified);
      setOpfsBackups(found);
    } catch (e) {
      console.error("App-Speicher lesen fehlgeschlagen:", e);
      setOpfsBackups([]);
    }
  };
  React.useEffect(() => {
    refreshOpfsBackups();
  }, []);
  const saveOpfsCopy = async (blob, filename) => {
    if (!opfsSupported) return;
    try {
      const dir = await getOpfsDir();
      const fh = await dir.getFileHandle(filename, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      refreshOpfsBackups();
    } catch (e) {
      console.error("Kopie im App-Speicher fehlgeschlagen:", e);
    }
  };
  const deleteOpfsBackup = async (name) => {
    if (!window.confirm(`Backup-Datei „${name}" endgültig löschen?`)) return;
    try {
      const dir = await getOpfsDir();
      await dir.removeEntry(name);
      setMsg({ type: "ok", text: `✓ Gelöscht: ${name}` });
    } catch (e) {
      setMsg({ type: "error", text: "Löschen fehlgeschlagen: " + (e.message || String(e)) });
    }
    refreshOpfsBackups();
  };
  const chooseDirectory = async () => {
    if (!fsapiSupported) return;
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await window.fsapiHandle.set("backupDir", handle);
      setDirHandle(handle);
      setDirName(handle.name);
      setDirPermission("granted");
      setMsg({ type: "ok", text: `✓ Backup-Ordner „${handle.name}" festgelegt. Künftige Backups landen automatisch dort.` });
      refreshFolderBackups(handle);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setMsg({ type: "error", text: "Ordnerauswahl fehlgeschlagen: " + (e.message || String(e)) });
    }
  };
  const clearDirectory = async () => {
    await window.fsapiHandle.delete("backupDir");
    setDirHandle(null);
    setDirName(null);
    setDirPermission("prompt");
    setFolderBackups([]);
  };
  const [lastBackupAt, setLastBackupAt] = React.useState(null);
  const [lastRestoreAt, setLastRestoreAt] = React.useState(null);
  React.useEffect(() => {
    (async () => {
      try {
        const b = await window.storage.get("settings:lastBackupAt");
        if (b && b.value) setLastBackupAt(b.value);
        const r = await window.storage.get("settings:lastRestoreAt");
        if (r && r.value) setLastRestoreAt(r.value);
      } catch {
      }
    })();
  }, []);
  const requestDirWriteHandle = async () => {
    if (!(fsapiSupported && dirHandle)) return null;
    try {
      let perm = await dirHandle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") perm = await dirHandle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") {
        setDirPermission("granted");
        return dirHandle;
      }
      setDirPermission(perm);
    } catch (e) {
      console.error("Berechtigung für Backup-Ordner fehlgeschlagen:", e);
    }
    return null;
  };
  const loadStats = React.useCallback(async () => {
    try {
      const all = await window.storage.list("");
      const keys = all?.keys || [];
      const flights = keys.filter((k) => k.startsWith("flight:")).length;
      const material = keys.filter((k) => k.startsWith("entry:")).length;
      setStats({ flights, material, keys: keys.length });
    } catch (e) {
      console.error("Stats load error:", e);
    }
  }, []);
  React.useEffect(() => {
    loadStats();
  }, [loadStats]);
  const [backupWithIgc, setBackupWithIgc] = React.useState(() => {
    try {
      return localStorage.getItem("backupWithIgc") !== "0";
    } catch {
      return true;
    }
  });
  const toggleBackupOpt = (name, val, setter) => {
    setter(val);
    try {
      localStorage.setItem(name, val ? "1" : "0");
    } catch {
    }
  };
  const DEVICE_NAME_KEY = "flugbuch-geraetename";
  const [deviceName, setDeviceName] = React.useState(() => {
    try {
      return localStorage.getItem(DEVICE_NAME_KEY) || "";
    } catch {
      return "";
    }
  });
  const saveDeviceName = (name) => {
    try {
      const v = (name || "").trim();
      if (v) localStorage.setItem(DEVICE_NAME_KEY, v);
      else localStorage.removeItem(DEVICE_NAME_KEY);
    } catch {
    }
  };
  const exportBackup = async () => {
    setBusy(true);
    setMsg(null);
    let writeHandle = await requestDirWriteHandle();
    try {
      const all = await window.storage.list("");
      const keys = (all?.keys || []).filter((k) => backupWithIgc || !k.startsWith("igcfile:"));
      const results = await Promise.all(keys.map((k) => window.storage.get(k).catch(() => null)));
      const entries = {};
      keys.forEach((k, i) => {
        if (results[i]) entries[k] = results[i].value;
      });
      if (!backupWithIgc) {
        for (const k of Object.keys(entries)) {
          if (!k.startsWith("flight:")) continue;
          try {
            const fl = JSON.parse(entries[k]);
            if (fl && fl.track) {
              fl.track = [];
              entries[k] = JSON.stringify(fl);
            }
          } catch {
          }
        }
      }
      const deviceTag = deviceName.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
      const payload = { exportedAt: (/* @__PURE__ */ new Date()).toISOString(), device: deviceTag, entries };
      const json = JSON.stringify(payload);
      const dateStamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const versionTag = (window.APP_VERSION || "unbekannt").replace(/[\\/:*?"<>|]/g, "_");
      const optTag = (deviceTag ? "-" + deviceTag : "") + (backupWithIgc ? "" : "-ohneIGC");
      let blob, filename;
      try {
        if (typeof CompressionStream !== "undefined") {
          const gzStream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
          blob = await new Response(gzStream).blob();
          filename = `flugbuch-backup-${versionTag}${optTag}-${dateStamp}.json.gz`;
        }
      } catch (e) {
        console.error("Backup: gzip compression failed, falling back to plain JSON:", e);
      }
      if (!blob) {
        blob = new Blob([json], { type: "application/json" });
        filename = `flugbuch-backup-${versionTag}${optTag}-${dateStamp}.json`;
      }
      const markBackedUp = async () => {
        try {
          await window.storage.set("settings:backupDirty", "0");
        } catch {
        }
        const iso = (/* @__PURE__ */ new Date()).toISOString();
        try {
          await window.storage.set("settings:lastBackupAt", iso);
        } catch {
        }
        setLastBackupAt(iso);
      };
      await saveOpfsCopy(blob, filename);
      if (writeHandle) {
        try {
          const fileHandle = await writeHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          await markBackedUp();
          setMsg({ type: "ok", text: `✓ Automatisch gespeichert in „${writeHandle.name}": ${filename} (${keys.length} Einträge, ${formatBytes(blob.size)}).` });
          refreshFolderBackups(writeHandle);
          setBusy(false);
          return;
        } catch (e) {
          console.error("Direktes Schreiben in Backup-Ordner fehlgeschlagen, weiche auf Teilen/Download aus:", e);
        }
      }
      if (navigator.share && navigator.canShare) {
        try {
          const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] });
            await markBackedUp();
            setMsg({ type: "ok", text: `✓ Backup geteilt (${keys.length} Einträge, ${formatBytes(blob.size)}).` });
            setBusy(false);
            return;
          }
        } catch (e) {
          if (e && e.name === "AbortError") {
            setBusy(false);
            return;
          }
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      await markBackedUp();
      setMsg({ type: "ok", text: `✓ Backup gespeichert: ${filename} (${keys.length} Einträge, ${formatBytes(blob.size)}).` });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Sichern: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };
  const importBackup = async (file) => {
    setBusy(true);
    setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const isGzip = bytes.length > 2 && bytes[0] === 31 && bytes[1] === 139;
      let text;
      if (isGzip) {
        if (typeof DecompressionStream === "undefined") {
          throw new Error("Dieses gzip-komprimierte Backup kann auf diesem Browser nicht gelesen werden.");
        }
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        text = await new Response(stream).text();
      } else {
        text = new TextDecoder("utf-8").decode(bytes);
      }
      const data = JSON.parse(text);
      const writes = [];
      if (data && data.entries && typeof data.entries === "object" && !Array.isArray(data.entries)) {
        for (const [key, value] of Object.entries(data.entries)) writes.push([key, value]);
      } else if (data && Array.isArray(data.flights)) {
        for (const f of data.flights) {
          if (!f || typeof f.id !== "string" && typeof f.id !== "number") throw new Error("Ungültiges Backup: Flug ohne ID.");
          writes.push([`flight:${f.id}`, JSON.stringify(f)]);
        }
        if (Array.isArray(data.customFieldDefs) && data.customFieldDefs.length) writes.push(["customFieldDefs", JSON.stringify(data.customFieldDefs)]);
        if (data.service && typeof data.service === "object") for (const [k, v] of Object.entries(data.service)) writes.push([k, JSON.stringify(v)]);
        if (data.reisen && typeof data.reisen === "object") for (const [k, v] of Object.entries(data.reisen)) writes.push([k, JSON.stringify(v)]);
        if (typeof data.notes === "string" && data.notes) writes.push(["settings:notes", data.notes]);
        if (Array.isArray(data.savedViews) && data.savedViews.length) writes.push(["flugbuchSavedViews", JSON.stringify(data.savedViews)]);
      } else {
        throw new Error("Ungültiges Backup-Format.");
      }
      for (const [key, value] of writes) {
        if (typeof key !== "string" || key.length === 0 || key.length > 300 || /[\u0000-\u001f]/.test(key)) {
          throw new Error('Ungültiges Backup: unzulässiger Schlüssel "' + String(key).slice(0, 40) + '".');
        }
        if (typeof value !== "string") {
          throw new Error('Ungültiges Backup: Wert zu "' + key.slice(0, 40) + '" ist kein Text.');
        }
      }
      const previous = await Promise.all(writes.map(async ([key]) => {
        const r = await window.storage.get(key);
        return [key, r ? r.value : null];
      }));
      let count = 0;
      try {
        for (const [key, value] of writes) {
          const r = await window.storage.set(key, value);
          if (!r) throw new Error('Speichern von "' + key.slice(0, 40) + '" fehlgeschlagen (Speicher voll?).');
          count++;
        }
      } catch (e) {
        let rollbackFailed = 0;
        for (const [key, old] of previous) {
          try {
            if (old === null) await window.storage.delete(key);
            else await window.storage.set(key, old);
          } catch {
            rollbackFailed++;
          }
        }
        throw new Error((e.message || String(e)) + " — Wiederherstellung abgebrochen, vorheriger Stand wurde zurückgesetzt" + (rollbackFailed ? ` (${rollbackFailed} Einträge konnten nicht zurückgesetzt werden)` : "") + ".");
      }
      await window.storage.set("settings:backupDirty", "0");
      const iso = (/* @__PURE__ */ new Date()).toISOString();
      try {
        await window.storage.set("settings:lastRestoreAt", iso);
      } catch {
      }
      setLastRestoreAt(iso);
      setMsg({ type: "ok", text: `✓ ${count} Einträge wiederhergestellt.` });
      loadStats();
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Wiederherstellen: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };
  const exportCsvIgc = async () => {
    setBusy(true);
    setMsg(null);
    let writeHandle = await requestDirWriteHandle();
    try {
      const [flights, material, schirme, sitze, geraete, div] = await Promise.all([
        loadAllFlights(),
        loadAllMaterial(),
        loadSchirmeList(),
        loadSitzeList(),
        loadGeraeteList(),
        loadDivList()
      ]);
      const flugbuchCsv = buildCsv(flights, ["customFields"]);
      const materialCsv = buildCsv(material);
      const schirmeCsv = buildCsv(schirme);
      const sitzeCsv = buildCsv(sitze);
      const geraeteCsv = buildCsv(geraete);
      const divCsv = buildCsv(div);
      if (typeof JSZip === "undefined") throw new Error("ZIP-Bibliothek (JSZip) konnte nicht geladen werden.");
      const zip = new JSZip();
      const usedNames = /* @__PURE__ */ new Set();
      let igcCount = 0;
      for (const fl of flights) {
        const raw = await loadRawIgcFile(fl.id);
        let safeBase, content;
        if (raw) {
          safeBase = (fl.customFields?.igcFilename || fl.name || fl.id || "flug").toString().replace(/[\\/:*?"<>|]/g, "_");
          content = raw;
        } else {
          const built = buildIgcTextFromFlight(fl);
          if (!built) continue;
          safeBase = built.filenameBase.replace(/[\\/:*?"<>|]/g, "_");
          content = built.text;
        }
        let name = safeBase + ".igc", i = 2;
        while (usedNames.has(name)) {
          name = `${safeBase}_${i}.igc`;
          i++;
        }
        usedNames.add(name);
        zip.file(name, content);
        igcCount++;
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const files = [
        { name: "flugbuch.csv", blob: new Blob([flugbuchCsv], { type: "text/csv;charset=utf-8" }) },
        { name: "material.csv", blob: new Blob([materialCsv], { type: "text/csv;charset=utf-8" }) },
        { name: "schirme.csv", blob: new Blob([schirmeCsv], { type: "text/csv;charset=utf-8" }) },
        { name: "sitze.csv", blob: new Blob([sitzeCsv], { type: "text/csv;charset=utf-8" }) },
        { name: "geraete.csv", blob: new Blob([geraeteCsv], { type: "text/csv;charset=utf-8" }) },
        { name: "div.csv", blob: new Blob([divCsv], { type: "text/csv;charset=utf-8" }) },
        { name: "flugbuch-igc.zip", blob: zipBlob }
      ];
      const summary = `flugbuch.csv, material.csv, schirme.csv, sitze.csv, geraete.csv, div.csv, flugbuch-igc.zip (${flights.length} Flüge, ${material.length} Material-Einträge, ${schirme.length} Schirme, ${igcCount} IGC-Dateien)`;
      if (writeHandle) {
        try {
          for (const f of files) {
            const fileHandle = await writeHandle.getFileHandle(f.name, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(f.blob);
            await writable.close();
          }
          setMsg({ type: "ok", text: `✓ Export gespeichert in „${writeHandle.name}": ${summary}.` });
          setBusy(false);
          return;
        } catch (e) {
          console.error("Direktes Schreiben in Backup-Ordner fehlgeschlagen, weiche auf Teilen/Download aus:", e);
        }
      }
      if (navigator.share && navigator.canShare) {
        try {
          const shareFiles = files.map((f) => new File([f.blob], f.name, { type: f.blob.type || "application/octet-stream" }));
          if (navigator.canShare({ files: shareFiles })) {
            await navigator.share({ files: shareFiles });
            setMsg({ type: "ok", text: `✓ Export geteilt: ${summary}.` });
            setBusy(false);
            return;
          }
        } catch (e) {
          if (e && e.name === "AbortError") {
            setBusy(false);
            return;
          }
        }
      }
      for (const f of files) {
        const url = URL.createObjectURL(f.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      setMsg({ type: "ok", text: `✓ Export heruntergeladen: ${summary}.` });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Exportieren: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "system-ui,sans-serif", paddingBottom: 40 } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "calc(18px + env(safe-area-inset-top, 0px)) 16px 6px", display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("a", { href: "index.html", style: { color: "#7dd3fc", fontSize: 24, textDecoration: "none", flexShrink: 0, lineHeight: 1 } }, "‹"), /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(232,244,253,0.4)", marginBottom: 2 } }, "Flugbuch"), /* @__PURE__ */ React.createElement("h1", { style: { fontSize: 22, fontWeight: 800, margin: "0 0 4px" } }, "🛠️ Service"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.45)" } }, stats ? `${stats.flights} Flüge · ${stats.material} Material-Einträge · ${stats.keys} Datensätze gesamt` : "Lade…"))), /* @__PURE__ */ React.createElement("div", { style: { padding: "16px" } }, /* @__PURE__ */ React.createElement(NotizenCard, { open: !!openInfo.notizen, onToggle: toggleInfo }), /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 } }, /* @__PURE__ */ React.createElement(SectionHeader, { title: "🔑 API-Zugangsdaten", sectionKey: "maptiler", open: !!openInfo.maptiler, onToggle: toggleInfo }), openInfo.maptiler && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 14, lineHeight: 1.5 } }, "MapTiler-Schlüssel für die Karten im Flugbuch (Outdoor-Kartenstil). Ohne eigenen Schlüssel läuft die App mit einem eingebauten Standard-Schlüssel weiter. Tipp: Den Schlüssel im MapTiler-Konto auf die Domain dieser App beschränken (Allowed HTTP origins) — er ist im Browser sichtbar und wird bei Kartenanfragen mitgesendet."), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "MapTiler API Key"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      value: maptilerKey,
      onChange: (e) => setMaptilerKey(e.target.value),
      placeholder: "eigenen Schlüssel von cloud.maptiler.com einfügen",
      style: { flex: "1 1 220px", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 13 }
    }
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: saveMaptilerKey,
      style: { flexShrink: 0, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 10, padding: "10px 16px", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: "pointer" }
    },
    "Speichern"
  )), maptilerKeySaved && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(74,222,128,0.8)", marginTop: 8 } }, "✓ Eigener Schlüssel aktiv — Feld leeren und speichern, um wieder den Standard-Schlüssel zu nutzen.")), /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 } }, /* @__PURE__ */ React.createElement(SectionHeader, { title: "🔗 Google Kalender (Reiseanalyse)", sectionKey: "googleCalendar", open: !!openInfo.googleCalendar, onToggle: toggleInfo }), openInfo.googleCalendar && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 14, lineHeight: 1.5 } }, 'Für die "Reiseanalyse" in der Statistik liest die App pistazienfarbige Termine aus deinem Google Kalender — standardmässig aus ALLEN Kalendern des Kontos (auch separate, z.B. ein eigener "Reisen"-Kalender), nicht nur dem Hauptkalender. Dafür einmalig in der ', /* @__PURE__ */ React.createElement("a", { href: "https://console.cloud.google.com/", target: "_blank", rel: "noopener", style: { color: "#7dd3fc" } }, "Google Cloud Console"), ' ein Projekt anlegen, die "Google Calendar API" aktivieren und eine OAuth-Client-ID vom Typ "Webanwendung" erstellen — als autorisierten JavaScript-Ursprung genau die Adresse eintragen, unter der diese App läuft (z.B. https://dein-name.github.io). Die Client-ID unten einfügen. Kalender-ID nur nötig, falls NICHT alle Kalender durchsucht werden sollen, sondern gezielt nur ein bestimmter.'), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "OAuth-Client-ID"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      value: googleClientId,
      onChange: (e) => setGoogleClientId(e.target.value),
      placeholder: "xxxxx.apps.googleusercontent.com",
      style: { flex: "1 1 220px", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 13 }
    }
  )), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "Kalender-ID (optional, leer = alle Kalender durchsuchen)"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      value: googleCalendarId,
      onChange: (e) => setGoogleCalendarId(e.target.value),
      placeholder: "primary",
      style: { flex: "1 1 220px", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 13 }
    }
  )), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "Pistazie-Label-ID (optional — aus der Diagnose in der Reiseanalyse ablesen, falls dein Konto das neuere Google-Farbsystem statt colorId nutzt)"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      value: googlePistachioLabelId,
      onChange: (e) => setGooglePistachioLabelId(e.target.value),
      placeholder: "z.B. 07bceb0d-6858-413d-bea9-48c8b5179014",
      style: { flex: "1 1 220px", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 13 }
    }
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: saveGoogleCalendarSettings,
      style: { flexShrink: 0, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 10, padding: "10px 16px", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: "pointer" }
    },
    "Speichern"
  )), googleClientIdSaved && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(74,222,128,0.8)", marginTop: 8 } }, '✓ Client-ID hinterlegt — in der Statistik → Reiseanalyse jetzt "Mit Google Kalender verbinden" antippen.')), /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 } }, /* @__PURE__ */ React.createElement(SectionHeader, { title: /* @__PURE__ */ React.createElement(React.Fragment, null, "📍 IGC-Import: Start-/Landeplatz & Land"), sectionKey: "placeRadius", open: !!openInfo.placeRadius, onToggle: toggleInfo }), openInfo.placeRadius && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 14, lineHeight: 1.5 } }, "Beim Import einer neuen IGC-Datei übernimmt das Flugbuch Startplatz, Landeplatz und Land automatisch von einem bereits vorhandenen Flug, dessen Koordinaten innerhalb dieses Radius liegen. Findet sich kein Treffer, wird das Land zusätzlich per MapTiler bestimmt (benötigt den Schlüssel oben)."), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "Radius (km)"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      value: placeRadius,
      onChange: (e) => setPlaceRadius(e.target.value),
      inputMode: "decimal",
      placeholder: "0.5",
      style: { flex: "1 1 120px", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 13 }
    }
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: savePlaceRadius,
      style: { flexShrink: 0, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 10, padding: "10px 16px", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: "pointer" }
    },
    "Speichern"
  )), placeRadiusSaved && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(74,222,128,0.8)", marginTop: 8 } }, "✓ Aktueller Radius: ", placeRadius, " km.")), /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 } }, /* @__PURE__ */ React.createElement(SectionHeader, { title: "📍 Umkreissuche (aktueller Standort)", sectionKey: "nearbyRadius", open: !!openInfo.nearbyRadius, onToggle: toggleInfo }), openInfo.nearbyRadius && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 14, lineHeight: 1.5 } }, "Im Flugbuch lässt sich über das 📍-Symbol bei der Suche nach Flügen filtern, deren Start- oder Landeplatz in der Nähe des aktuellen Standorts (Browser-Geolocation) liegt. Dieser Radius ist der Vorgabewert dafür — pro Suche im Flugbuch selbst weiterhin änderbar."), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "Standardradius (km)"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      value: nearbyRadius,
      onChange: (e) => setNearbyRadius(e.target.value),
      inputMode: "decimal",
      placeholder: "5",
      style: { flex: "1 1 120px", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 13 }
    }
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: saveNearbyRadius,
      style: { flexShrink: 0, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 10, padding: "10px 16px", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: "pointer" }
    },
    "Speichern"
  )), nearbyRadiusSaved && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(74,222,128,0.8)", marginTop: 8 } }, "✓ Aktueller Standardradius: ", nearbyRadius, " km.")), /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 } }, /* @__PURE__ */ React.createElement(SectionHeader, { title: /* @__PURE__ */ React.createElement(React.Fragment, null, "🔄 Updates & Offline-Cache"), sectionKey: "cache", open: !!openInfo.cache, onToggle: toggleInfo }), openInfo.cache && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 14, lineHeight: 1.5 } }, "Die App speichert ihre eigenen Seiten für die Offline-Nutzung zwischen. Standardmässig wird beim Öffnen immer sofort die zuletzt gespeicherte Version angezeigt (auch offline oder bei schwachem Netz sofort da) — ein Update wird dadurch erst beim übernächsten Öffnen sichtbar. Mit dieser Einstellung lädt die App stattdessen bei jedem Öffnen zuerst die neueste Version übers Netz; Updates sind dann sofort sichtbar, aber bei schwachem Empfang (z.B. am Lande-/Startplatz) kann das Laden dadurch spürbar länger dauern."), /* @__PURE__ */ React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "checkbox",
      checked: networkFirst,
      onChange: (e) => saveNetworkFirst(e.target.checked),
      style: { width: 18, height: 18, cursor: "pointer", flexShrink: 0 }
    }
  ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "Immer neueste Version laden (Network-First)"))), fsapiSupported && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 } }, /* @__PURE__ */ React.createElement(SectionHeader, { title: "📁 Backup-Ordner (automatisch, dieser PC)", sectionKey: "backupFolder", open: !!openInfo.backupFolder, onToggle: toggleInfo }), openInfo.backupFolder && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 14, lineHeight: 1.5 } }, "Einmalig festlegen (z.B. dein lokaler Synology-Drive-Sync-Ordner) — künftige Backups landen danach automatisch dort, ganz ohne Dialog. Gilt nur für diesen Browser auf diesem Gerät."), dirName ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 auto", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#4ade80" } }, "📂 ", dirName, dirPermission !== "granted" && /* @__PURE__ */ React.createElement("span", { style: { color: "#fcd34d", marginLeft: 8 } }, "(Berechtigung beim nächsten Backup erneut bestätigen)")), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: chooseDirectory,
      style: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 12px", color: "rgba(232,244,253,0.8)", fontSize: 12, cursor: "pointer" }
    },
    "Ändern"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: clearDirectory,
      style: { background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, padding: "8px 12px", color: "#f87171", fontSize: 12, cursor: "pointer" }
    },
    "Entfernen"
  )) : /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: chooseDirectory,
      style: { background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 10, padding: "10px 16px", color: "#7dd3fc", fontSize: 13, fontWeight: 700, cursor: "pointer" }
    },
    "📁 Ordner auswählen…"
  ), dirName && dirPermission === "granted" && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 } }, "Backups in diesem Ordner ", loadingFolderBackups ? "(lade…)" : `(${folderBackups.length})`), folderBackups.length === 0 && !loadingFolderBackups && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.4)" } }, "Noch keine Backup-Dateien hier gefunden."), folderBackups.map((b) => /* @__PURE__ */ React.createElement("div", { key: b.name, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8, marginBottom: 6 } }, /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#e8f4fd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, b.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "rgba(232,244,253,0.4)" } }, new Date(b.lastModified).toLocaleString("de-CH"), " · ", formatBytes(b.size))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flexShrink: 0 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: async () => {
        const file = await b.handle.getFile();
        importBackup(file);
      },
      disabled: busy,
      style: { flexShrink: 0, background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 8, padding: "6px 12px", color: "#7dd3fc", fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer" }
    },
    "Wiederherstellen"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      title: "Backup-Datei löschen",
      "aria-label": "Backup-Datei löschen",
      disabled: busy,
      onClick: async () => {
        if (!window.confirm(`Backup-Datei „${b.name}" endgültig löschen?`)) return;
        try {
          await dirHandle.removeEntry(b.name);
          setMsg({ type: "ok", text: `✓ Gelöscht: ${b.name}` });
        } catch (e) {
          setMsg({ type: "error", text: "Löschen fehlgeschlagen: " + (e.message || String(e)) });
        }
        refreshFolderBackups();
      },
      style: { flexShrink: 0, background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, padding: "6px 9px", color: "#f87171", fontSize: 13, cursor: busy ? "default" : "pointer" }
    },
    "🗑"
  )))))), opfsSupported && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 } }, "📱 Backups im App-Speicher (", opfsBackups.length, ")"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 10, lineHeight: 1.5 } }, "Jedes Backup wird zusätzlich hier auf dem Gerät abgelegt und kann von hier wiederhergestellt oder gelöscht werden. Die geteilte/heruntergeladene Datei bleibt unberührt."), opfsBackups.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.4)" } }, "Noch keine Backup-Dateien hier."), opfsBackups.map((b) => /* @__PURE__ */ React.createElement("div", { key: b.name, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 8, marginBottom: 6 } }, /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#e8f4fd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, b.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "rgba(232,244,253,0.4)" } }, new Date(b.lastModified).toLocaleString("de-CH"), " · ", formatBytes(b.size))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flexShrink: 0 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: async () => {
        const file = await b.handle.getFile();
        importBackup(file);
      },
      disabled: busy,
      style: { background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 8, padding: "6px 12px", color: "#7dd3fc", fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer" }
    },
    "Wiederherstellen"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      title: "Backup-Datei löschen",
      "aria-label": "Backup-Datei löschen",
      disabled: busy,
      onClick: () => deleteOpfsBackup(b.name),
      style: { background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, padding: "6px 9px", color: "#f87171", fontSize: 13, cursor: busy ? "default" : "pointer" }
    },
    "🗑"
  ))))), /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 } }, /* @__PURE__ */ React.createElement(SectionHeader, { title: /* @__PURE__ */ React.createElement(React.Fragment, null, "☁️ Backup & Restore ", dirName ? "(anderer Ort)" : ""), sectionKey: "backupRestore", open: !!openInfo.backupRestore, onToggle: toggleInfo }), openInfo.backupRestore && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 16, lineHeight: 1.5 } }, dirName ? "Zum manuellen Wiederherstellen aus einer Datei außerhalb des oben gewählten Ordners, oder wenn dein Backup-Ordner gerade nicht verfügbar ist." : "Sichert alles auf einmal: Flugbuch, Statistik-Voreinstellungen und Material. Eine wiederhergestellte Sicherung ersetzt die aktuellen Daten in den jeweils gleichen Bereichen (bestehende Einträge mit derselben ID werden überschrieben, alles andere bleibt unangetastet).", !fsapiSupported && " Auf diesem Browser läuft „Backup sichern” über den Teilen-/Download-Dialog (die automatische Ordner-Option oben gibt es nur in Chrome/Edge am PC)."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12, color: "rgba(232,244,253,0.7)" } }, /* @__PURE__ */ React.createElement("label", { htmlFor: "backup-device-name", style: { flexShrink: 0 } }, "Gerätename (im Dateinamen):"), /* @__PURE__ */ React.createElement(
    "input",
    {
      id: "backup-device-name",
      type: "text",
      maxLength: 40,
      autoComplete: "off",
      placeholder: "z. B. Sepp-Handy",
      value: deviceName,
      onChange: (e) => setDeviceName(e.target.value),
      onBlur: (e) => saveDeviceName(e.target.value),
      style: { flex: "1 1 auto", minWidth: 0, boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 10px", color: "#e8f4fd", fontSize: 13 }
    }
  )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 160px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 14, justifyContent: "center", marginBottom: 8, fontSize: 12, color: "rgba(232,244,253,0.7)" } }, /* @__PURE__ */ React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 5, cursor: "pointer" } }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: backupWithIgc, onChange: (e) => toggleBackupOpt("backupWithIgc", e.target.checked, setBackupWithIgc) }), " IGC")), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: exportBackup,
      disabled: busy,
      style: { width: "100%", boxSizing: "border-box", background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 10, padding: "12px", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }
    },
    busy ? "⏳ …" : "☁️ Backup sichern"
  ), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.45)", marginTop: 6, textAlign: "center" } }, lastBackupAt ? `Letztes Backup: ${formatTimestamp(lastBackupAt)}` : "Noch kein Backup gesichert.")), /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 160px" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => fileRef.current?.click(),
      disabled: busy,
      style: { width: "100%", boxSizing: "border-box", background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 10, padding: "12px", color: "#7dd3fc", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }
    },
    "⬆ Backup importieren (Datei wählen)"
  ), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.45)", marginTop: 6, textAlign: "center" } }, lastRestoreAt ? `Letzter Restore: ${formatTimestamp(lastRestoreAt)}` : "Noch kein Restore durchgeführt.")), /* @__PURE__ */ React.createElement(
    "input",
    {
      ref: fileRef,
      type: "file",
      accept: ".json,.gz,.json.gz",
      style: { display: "none" },
      onChange: (e) => {
        if (e.target.files[0]) importBackup(e.target.files[0]);
        e.target.value = "";
      }
    }
  ))), /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 18, marginBottom: 14 } }, /* @__PURE__ */ React.createElement(SectionHeader, { title: /* @__PURE__ */ React.createElement(React.Fragment, null, "📤 Exportieren (CSV & IGC)"), sectionKey: "exportCsv", open: !!openInfo.exportCsv, onToggle: toggleInfo }), openInfo.exportCsv && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", marginBottom: 16, lineHeight: 1.5 } }, "Erzeugt flugbuch.csv, material.csv, schirme.csv, sitze.csv, geraete.csv und div.csv (je eine Spalte pro Datenbankfeld) sowie eine ZIP-Datei mit den IGC-Dateien aller Flüge — und legt sie am selben Ort ab wie das Backup oben", dirName ? ` (Ordner „${dirName}")` : "", "."), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: exportCsvIgc,
      disabled: busy,
      style: { width: "100%", boxSizing: "border-box", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "12px", color: "#fcd34d", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }
    },
    busy ? "⏳ …" : "📤 Exportieren"
  )), msg && /* @__PURE__ */ React.createElement("div", { style: { background: msg.type === "ok" ? "rgba(74,222,128,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${msg.type === "ok" ? "rgba(74,222,128,0.3)" : "rgba(239,68,68,0.3)"}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: msg.type === "ok" ? "#4ade80" : "#f87171", marginBottom: 14 } }, msg.text)));
}

;window.__FLUGBUCH_APP__ = ServiceApp;
})(window.React, window.ReactDOM);
