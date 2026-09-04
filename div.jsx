// ── Div ─────────────────────────────────────────────────────────────
// Eigenständige Seite (wie Schirme/Material) — über die Material-Seite
// erreichbar (einer der vier Knöpfe Schirme/Sitze/Geräte/Div dort).
// Zentrale Verwaltung: ein Datensatz je Div, mit Hersteller,
// Bemerkung, letztem Check.
//
// Diese Liste (div:list) ist die FÜHRENDE Tabelle für Div:
// Material-Einträge mit Art="Div" verweisen per ID hierher (Feld
// divId im Material-Eintrag), nie umgekehrt — siehe material.jsx/
// syncMaterialWithMasters. Zugeordnet wird über die Material-Spalte "Typ"
// (Typ = Name hier in der Liste); fehlt der passende Eintrag, wird er dort
// automatisch neu angelegt. Analog zu schirme.jsx, aber ohne die
// Flugbuch-Verknüpfung, da Flüge nur den Schirm referenzieren.

const DIV_KEY = "div:list";
const DIV_ART = "Div";

function parseDateToTs(d) {
  if (!d) return 0;
  const p = d.split(".");
  return p.length === 3 ? new Date(+p[2], +p[1] - 1, +p[0]).getTime() : 0;
}

async function loadAllMaterial() {
  const keys = await window.storage.list("entry:");
  const raw = await Promise.all((keys?.keys || []).map(async k => {
    try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; }
  }));
  return raw.filter(Boolean);
}

function DivApp() {
  const [material, setMaterial] = React.useState(null);
  const [list, setList] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [editing, setEditing] = React.useState(null);

  const load = React.useCallback(async () => {
    const mat = await loadAllMaterial();
    let stored = [];
    try {
      const r = await window.storage.get(DIV_KEY);
      stored = r ? JSON.parse(r.value) : [];
    } catch { stored = []; }
    setMaterial(mat);
    setList(stored);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const markDirty = () => { try { window.storage.set("settings:backupDirty", "1"); } catch {} };

  const saveList = async (next) => {
    setList(next);
    try { await window.storage.set(DIV_KEY, JSON.stringify(next)); } catch {}
    markDirty();
  };

  // Legt für jeden Material-Eintrag mit Art="Div" einen Eintrag an,
  // falls noch keiner mit passendem Namen (= Material-Spalte "Typ")
  // existiert, und repariert danach die divId-Verknüpfung bei allen
  // betroffenen Material-Einträgen.
  const generateFromMaterial = async () => {
    setBusy(true); setMsg(null);
    try {
      const mat = material || await loadAllMaterial();
      const relevant = mat.filter(m => (m.art || "").trim() === DIV_ART);
      const byName = new Map(list.map(e => [(e.name || "").trim().toLowerCase(), e]));
      let nextList = list;
      const newEntries = [];
      for (const m of relevant) {
        const name = (m.typ || "").trim();
        if (!name || byName.has(name.toLowerCase())) continue;
        const entry = { id: `div_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name, hersteller: m.hersteller || "", bemerkung: "", letzterCheck: "" };
        byName.set(name.toLowerCase(), entry);
        newEntries.push(entry);
      }
      if (newEntries.length) {
        nextList = [...list, ...newEntries];
        await saveList(nextList);
      }
      let relinkCount = 0;
      let workingMat = mat;
      for (const m of relevant) {
        const name = (m.typ || "").trim().toLowerCase();
        if (!name) continue;
        const target = byName.get(name);
        if (target && m.divId !== target.id) {
          const updated = { ...m, divId: target.id };
          await window.storage.set(`entry:${updated.id}`, JSON.stringify(updated));
          workingMat = workingMat.map(x => x.id === updated.id ? updated : x);
          relinkCount++;
        }
      }
      setMaterial(workingMat);
      if (relinkCount) markDirty();
      const parts = [];
      if (newEntries.length) parts.push(`${newEntries.length} Eintrag/Einträge erzeugt`);
      if (relinkCount) parts.push(`${relinkCount} Material-Verknüpfung(en) ergänzt`);
      setMsg({ type: "ok", text: parts.length ? `✓ ${parts.join(", ")}.` : "Alles bereits aktuell — nichts zu erzeugen oder zu verknüpfen." });
    } catch (e) {
      setMsg({ type: "error", text: "Fehler beim Erzeugen: " + (e.message || String(e)) });
    } finally {
      setBusy(false);
    }
  };

  const materialFor = (entry) => (material || []).filter(m => m.divId === entry.id)
    .sort((a, b) => parseDateToTs(b.datum) - parseDateToTs(a.datum));

  const unlinkedMaterial = React.useMemo(() =>
    (material || []).filter(m => (m.art || "").trim() === DIV_ART && !m.divId), [material]);

  const linkMaterial = async (materialId, targetId) => {
    const m = (material || []).find(x => x.id === materialId);
    if (!m) return;
    const updated = { ...m, divId: targetId };
    await window.storage.set(`entry:${updated.id}`, JSON.stringify(updated));
    setMaterial(prev => prev.map(x => x.id === updated.id ? updated : x));
    markDirty();
  };
  const unlinkMaterial = async (materialId) => {
    const m = (material || []).find(x => x.id === materialId);
    if (!m) return;
    const updated = { ...m, divId: null };
    await window.storage.set(`entry:${updated.id}`, JSON.stringify(updated));
    setMaterial(prev => prev.map(x => x.id === updated.id ? updated : x));
    markDirty();
  };

  if (material === null) {
    return <div style={{ padding: 24, color: "rgba(232,244,253,0.5)", fontFamily: "system-ui,sans-serif" }}>Lade…</div>;
  }

  const sorted = [...list].sort((a, b) => (a.name || "").localeCompare(b.name || "", "de"));

  return (
    <div style={{ minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "system-ui,sans-serif", paddingBottom: 40 }}>
      <div style={{ padding: "calc(18px + env(safe-area-inset-top, 0px)) 16px 6px", display: "flex", alignItems: "center", gap: 10 }}>
        <a href="material.html" style={{ color: "#7dd3fc", fontSize: 24, textDecoration: "none", flexShrink: 0, lineHeight: 1 }}>‹</a>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(232,244,253,0.4)", marginBottom: 2 }}>Flugbuch · Material</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px" }}>🧰 Div</h1>
          <div style={{ fontSize: 12, color: "rgba(232,244,253,0.45)" }}>{sorted.length} Einträge</div>
        </div>
      </div>

      <div style={{ padding: "0 16px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setEditing({ name: "", hersteller: "", bemerkung: "", letzterCheck: "" })} disabled={busy}
          style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 8, padding: "9px 14px", color: "#4ade80", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
          + Neuer Eintrag
        </button>
        <button onClick={generateFromMaterial} disabled={busy}
          title="Legt für jeden Material-Eintrag mit Art=&quot;Div&quot; einen Eintrag an, falls noch keiner existiert, und repariert alle Verknüpfungen."
          style={{ background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 8, padding: "9px 14px", color: "#4ade80", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
          {busy ? "⏳ …" : "🔄 aus Material synchronisieren"}
        </button>
      </div>

      {msg && (
        <div style={{ margin: "0 16px 14px", background: msg.type === "ok" ? "rgba(74,222,128,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${msg.type === "ok" ? "rgba(74,222,128,0.3)" : "rgba(239,68,68,0.3)"}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: msg.type === "ok" ? "#4ade80" : "#f87171" }}>
          {msg.text}
        </div>
      )}

      <div style={{ padding: "0 16px" }}>
        {sorted.length === 0 && (
          <div style={{ padding: "30px 12px", textAlign: "center", fontSize: 13, color: "rgba(232,244,253,0.4)" }}>
            Noch keine Einträge — über „+ Neuer Eintrag" anlegen, oder „🔄 aus Material synchronisieren", sobald Material-Einträge mit Art="Div" vorhanden sind.
          </div>
        )}
        {sorted.map(entry => {
          const matList = materialFor(entry);
          return (
            <div key={entry.id} onClick={() => setEditing(entry)}
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 14px", marginBottom: 8, cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#7dd3fc" }}>{entry.name}</span>
                {entry.letzterCheck && <span style={{ fontSize: 11, color: "rgba(232,244,253,0.4)" }}>Check: {entry.letzterCheck}</span>}
              </div>
              <div style={{ fontSize: 12, color: "rgba(232,244,253,0.7)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span>{entry.hersteller || "— Hersteller —"}</span>
                {entry.bemerkung && <span style={{ color: "rgba(232,244,253,0.5)" }}>· {entry.bemerkung}</span>}
                {matList.length > 0 && (
                  <a href={`material.html?divId=${entry.id}`} onClick={e => e.stopPropagation()} style={{ color: "rgba(74,222,128,0.8)", textDecoration: "none" }}>🔗 {matList.length} Material-Eintrag(e)</a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <GruppeEditor
          entry={editing}
          materialList={editing.id ? materialFor(editing) : []}
          unlinkedMaterial={unlinkedMaterial}
          onLinkMaterial={linkMaterial}
          onUnlinkMaterial={unlinkMaterial}
          onCancel={() => setEditing(null)}
          onSave={async (data) => {
            const trimmedName = (data.name || "").trim();
            if (!trimmedName) { setMsg({ type: "error", text: "Ein Name ist erforderlich." }); return; }
            const isNew = !data.id;
            if (isNew) {
              const entry = { ...data, id: `div_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: trimmedName };
              await saveList([...list, entry]);
            } else {
              const next = list.map(e => e.id === data.id ? { ...data, name: trimmedName } : e);
              await saveList(next);
            }
            setEditing(null);
          }}
          onDelete={async (id) => {
            const entry = list.find(e => e.id === id);
            const affected = entry ? materialFor(entry) : [];
            if (affected.length > 0) {
              setEditing(null);
              setMsg({ type: "error", text: `„${entry.name}" kann nicht gelöscht werden — ${affected.length} Material-Eintrag(e) tragen diesen Eintrag noch. Bitte zuerst trennen. Erst ein Eintrag ohne Material-Verknüpfung lässt sich löschen.` });
              return;
            }
            const next = list.filter(e => e.id !== id);
            await saveList(next);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function GruppeEditor({ entry, materialList, unlinkedMaterial, onLinkMaterial, onUnlinkMaterial, onSave, onCancel, onDelete }) {
  const [data, setData] = React.useState({ ...entry });
  const [linkChoice, setLinkChoice] = React.useState("");
  const set = (k, v) => setData(d => ({ ...d, [k]: v }));
  const isNew = !entry.id;

  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#14253a", borderRadius: 16, padding: "20px 20px", maxWidth: 420, width: "100%", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 }}>Name</div>
          <input value={data.name || ""} onChange={e => set("name", e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14, fontWeight: 700 }} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 }}>Hersteller</div>
          <input value={data.hersteller || ""} onChange={e => set("hersteller", e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14 }} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 }}>Letzter Check</div>
          <input value={data.letzterCheck || ""} onChange={e => set("letzterCheck", e.target.value)}
            placeholder="tt.mm.jjjj"
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14 }} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 }}>Bemerkung</div>
          <input value={data.bemerkung || ""} onChange={e => set("bemerkung", e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14 }} />
        </div>

        {!isNew && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 14, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "rgba(232,244,253,0.4)" }}>Material-Einträge ({materialList.length})</div>
              {materialList.length > 0 && (
                <a href={`material.html?divId=${entry.id}`} style={{ fontSize: 11, color: "#7dd3fc", textDecoration: "none" }}>→ in Material öffnen</a>
              )}
            </div>
            {materialList.length === 0 && (
              <div style={{ fontSize: 12, color: "rgba(232,244,253,0.4)", marginBottom: 10 }}>Noch kein Material-Eintrag verknüpft.</div>
            )}
            {materialList.map(m => (
              <div key={m.id} style={{ background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 10, padding: "8px 12px", fontSize: 12, color: "rgba(232,244,253,0.8)", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span>{m.datum} · {m.was || m.wo || "—"}{m.preis != null ? " · " + m.preis.toLocaleString("de-CH") + ".-" : ""}</span>
                <button onClick={() => onUnlinkMaterial(m.id)} title="Verknüpfung aufheben"
                  style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>✕</button>
              </div>
            ))}
            {unlinkedMaterial.length > 0 && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <select value={linkChoice} onChange={e => setLinkChoice(e.target.value)}
                  style={{ flex: 1, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 8px", color: "#e8f4fd", fontSize: 11 }}>
                  <option value="" style={{ background: "#14253a" }}>— weiteren Material-Eintrag verknüpfen —</option>
                  {unlinkedMaterial.map(m => (
                    <option key={m.id} value={m.id} style={{ background: "#14253a" }}>{m.datum} · {m.typ || m.was || "?"}</option>
                  ))}
                </select>
                <button onClick={() => { if (linkChoice) { onLinkMaterial(linkChoice, entry.id); setLinkChoice(""); } }} disabled={!linkChoice}
                  style={{ background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 8, padding: "6px 12px", color: "#4ade80", fontSize: 11, fontWeight: 700, cursor: linkChoice ? "pointer" : "default" }}>
                  Verknüpfen
                </button>
              </div>
            )}
          </div>
        )}

        {!isNew && (
          <button onClick={() => onDelete(data.id)}
            style={{ width: "100%", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "9px", color: "#f87171", fontSize: 13, cursor: "pointer", marginBottom: 12, marginTop: 4 }}>
            🗑 Eintrag löschen
          </button>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel}
            style={{ flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }}>
            Abbrechen
          </button>
          <button onClick={() => onSave(data)}
            style={{ flex: 1, background: "rgba(34,197,94,0.2)", border: "1px solid rgba(34,197,94,0.4)", borderRadius: 10, padding: "11px", color: "#4ade80", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
