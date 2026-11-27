/* Automatisch erzeugt aus flugbuch.jsx (sha256 b9b50a9f7645) — nicht von Hand ändern, siehe scripts/build.js */
(function (React, ReactDOM) {
const { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;
let profileZoomActive = false;
function parseIGC(text) {
  const lines = text.split("\n");
  const track = [];
  let date = "", pilot = "", glider = "", tzOffsetHours = null;
  for (const line of lines) {
    if (line.startsWith("HFDTE")) {
      const m = line.match(/HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/);
      if (m) date = `${m[1]}.${m[2]}.20${m[3]}`;
    }
    if (line.startsWith("HFPLT")) {
      const m = line.match(/HFPLT(?:PILOTINCHARGE:|PILOT:)?(.+)/);
      if (m) pilot = m[1].trim();
    }
    if (line.startsWith("HFGTY")) {
      const m = line.match(/HFGTY(?:GLIDERTYPE:)?(.+)/);
      if (m) glider = m[1].trim();
    }
    if (line.startsWith("HFTZN")) {
      const m = line.match(/HFTZN(?:TIMEZONE:)?(-?\d+(?:\.\d+)?)/);
      if (m) tzOffsetHours = parseFloat(m[1]);
    }
    if (line.startsWith("B") && line.length >= 35) {
      const hh = +line.slice(1, 3), mm = +line.slice(3, 5), ss = +line.slice(5, 7);
      const latD = +line.slice(7, 9), latM = +line.slice(9, 14) / 1e3;
      const lonD = +line.slice(15, 18), lonM = +line.slice(18, 23) / 1e3;
      const latS = line[14], lonS = line[23];
      const lat = (latD + latM / 60) * (latS === "S" ? -1 : 1);
      const lon = (lonD + lonM / 60) * (lonS === "W" ? -1 : 1);
      const gpsAlt = +line.slice(30, 35);
      const baroAlt = +line.slice(25, 30);
      if (!isNaN(lat) && !isNaN(lon) && !isNaN(gpsAlt) && gpsAlt > 0)
        track.push({ lat, lon, gpsAlt, baroAlt: isNaN(baroAlt) ? 0 : baroAlt, timeSec: hh * 3600 + mm * 60 + ss });
    }
  }
  return { track, date, pilot, glider, tzOffsetHours };
}
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 32768;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
async function storeRawIgcFile(flightId, file) {
  if (!flightId || !file) return;
  try {
    const buf = await file.arrayBuffer();
    let toStore = buf;
    if (typeof CompressionStream !== "undefined") {
      try {
        const gz = new Blob([buf]).stream().pipeThrough(new CompressionStream("gzip"));
        toStore = await (await new Response(gz).blob()).arrayBuffer();
      } catch (e) {
        console.error("IGC-Rohdatei: gzip fehlgeschlagen, speichere unkomprimiert:", e);
      }
    }
    await window.storage.set(`igcfile:${flightId}`, arrayBufferToBase64(toStore));
  } catch (e) {
    console.error("Rohe IGC-Datei konnte nicht gespeichert werden:", e);
  }
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
  } catch (e) {
    console.error("Rohe IGC-Datei konnte nicht gelesen werden:", e);
    return null;
  }
}
async function deleteRawIgcFile(flightId) {
  try {
    await window.storage.delete(`igcfile:${flightId}`);
  } catch {
  }
}
function estimateTzOffset(firstPt, dateStr) {
  if (!firstPt) return 0;
  try {
    if (typeof window !== "undefined" && window.tzlookup) {
      const zoneName = window.tzlookup(firstPt.lat, firstPt.lon);
      const m = String(dateStr).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      const d = m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12)) : /* @__PURE__ */ new Date();
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: zoneName, timeZoneName: "shortOffset" }).formatToParts(d);
      const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || "";
      const om = tzPart.match(/GMT([+-]\d+)(?::(\d+))?/);
      if (om) {
        const h = parseInt(om[1], 10);
        const extraMin = om[2] ? parseInt(om[2], 10) / 60 : 0;
        return h >= 0 ? h + extraMin : h - extraMin;
      }
      if (tzPart === "GMT") return 0;
    }
  } catch {
  }
  return Math.round((firstPt.lon || 0) / 15);
}
const CLIMB_WINDOW_SEC = 3;
const CLIMB_WINDOW_SEC_20 = 20;
const PLAUSIBLE_MAX_VARIO_MS = 25;
function buildAltitudeGlitchPrefix(track, altKey = "gpsAlt") {
  const n = track.length;
  const prefix = new Array(n).fill(0);
  for (let k2 = 0; k2 < n - 1; k2++) {
    const dt = track[k2 + 1].timeSec - track[k2].timeSec;
    const rate = dt > 0 ? (track[k2 + 1][altKey] - track[k2][altKey]) / dt : 0;
    const isGlitch = dt > 0 && Math.abs(rate) > PLAUSIBLE_MAX_VARIO_MS;
    prefix[k2 + 1] = prefix[k2] + (isGlitch ? 1 : 0);
  }
  return prefix;
}
function altitudeGlitchWindowOverlaps(prefix, lo, hi) {
  return prefix[hi] - prefix[lo] > 0;
}
function turnSumDegBetween(track, lo, hi) {
  let totalTurn = 0, prevHeading = null;
  for (let k2 = lo; k2 < hi; k2++) {
    if ((haversineDistKm(track[k2], track[k2 + 1]) || 0) < 5e-4) continue;
    const heading = bearingDeg(track[k2], track[k2 + 1]);
    if (prevHeading != null) {
      const d = ((heading - prevHeading + 180) % 360 + 360) % 360 - 180;
      totalTurn += Math.abs(d);
    }
    prevHeading = heading;
  }
  return totalTurn;
}
const MANEUVER_TURN_RATE_DEG_S = 40;
function windowedClimbSinkExtremes(track, windowSec, maneuverPrefix, glitchPrefix, altKey = "gpsAlt") {
  let maxRate = -Infinity, minRate = Infinity;
  let j = 0;
  for (let i = 0; i < track.length; i++) {
    const t0 = track[i].timeSec;
    const target = t0 + windowSec;
    while (j < track.length && track[j].timeSec < target) j++;
    if (j >= track.length) break;
    if (j === i) continue;
    const dt = track[j].timeSec - t0;
    if (dt <= 0) continue;
    const rate = (track[j][altKey] - track[i][altKey]) / dt;
    if (Math.abs(rate) > PLAUSIBLE_MAX_VARIO_MS) continue;
    if (altitudeGlitchWindowOverlaps(glitchPrefix, i, j)) continue;
    if (maneuverWindowOverlaps(maneuverPrefix, i, j)) continue;
    if (rate > maxRate) maxRate = rate;
    if (rate < minRate) minRate = rate;
  }
  return { maxRate, minRate };
}
function hasBaroAlt(track) {
  return track.some((p) => p.baroAlt > 0);
}
function computeClimbSinkStats(track) {
  const maneuverPrefix = buildManeuverPrefix(track);
  const glitchPrefix = buildAltitudeGlitchPrefix(track);
  const { maxRate: maxClimbRaw, minRate: maxSinkRaw } = windowedClimbSinkExtremes(track, CLIMB_WINDOW_SEC, maneuverPrefix, glitchPrefix);
  const maxClimb = isFinite(maxClimbRaw) ? +maxClimbRaw.toFixed(1) : 0;
  const maxSinkRate = isFinite(maxSinkRaw) ? +maxSinkRaw.toFixed(1) : 0;
  const { maxRate: maxClimb20Raw } = windowedClimbSinkExtremes(track, CLIMB_WINDOW_SEC_20, maneuverPrefix, glitchPrefix);
  const maxClimb20 = isFinite(maxClimb20Raw) ? +maxClimb20Raw.toFixed(1) : 0;
  let maxClimbBaro = null;
  if (hasBaroAlt(track)) {
    const glitchPrefixBaro = buildAltitudeGlitchPrefix(track, "baroAlt");
    const { maxRate: maxClimbBaroRaw } = windowedClimbSinkExtremes(track, CLIMB_WINDOW_SEC, maneuverPrefix, glitchPrefixBaro, "baroAlt");
    maxClimbBaro = isFinite(maxClimbBaroRaw) ? +maxClimbBaroRaw.toFixed(1) : 0;
  }
  return { maxClimb, maxClimb20, maxSinkRate, maxClimbBaro };
}
function computeClimbSinkPoints(track, windowSec) {
  const candidates = [];
  const maneuverPrefix = buildManeuverPrefix(track);
  const glitchPrefix = buildAltitudeGlitchPrefix(track);
  let j = 0;
  for (let i = 0; i < track.length; i++) {
    const t0 = track[i].timeSec;
    const target = t0 + windowSec;
    while (j < track.length && track[j].timeSec < target) j++;
    if (j >= track.length) break;
    if (j === i) continue;
    const dt = track[j].timeSec - t0;
    if (dt <= 0) continue;
    const rate = (track[j].gpsAlt - track[i].gpsAlt) / dt;
    if (Math.abs(rate) > PLAUSIBLE_MAX_VARIO_MS) continue;
    if (altitudeGlitchWindowOverlaps(glitchPrefix, i, j)) continue;
    if (maneuverWindowOverlaps(maneuverPrefix, i, j)) continue;
    const mid = Math.round((i + j) / 2);
    candidates.push({ idx: mid, rate, timeSec: track[mid].timeSec });
  }
  if (!candidates.length) return null;
  const round1 = (v) => +v.toFixed(1);
  const maxRateRounded = round1(Math.max(...candidates.map((c) => c.rate)));
  const minRateRounded = round1(Math.min(...candidates.map((c) => c.rate)));
  const CLUSTER_GAP_SEC = 20;
  const pickExtremePoints = (roundedTarget) => {
    const matches = candidates.filter((c) => round1(c.rate) === roundedTarget).sort((a, b) => a.idx - b.idx);
    const clusters = [];
    for (const m of matches) {
      const last = clusters[clusters.length - 1];
      if (last && m.timeSec - last[last.length - 1].timeSec <= CLUSTER_GAP_SEC) last.push(m);
      else clusters.push([m]);
    }
    return clusters.map((cluster) => {
      const best = cluster.reduce((a, b) => Math.abs(b.rate - roundedTarget) < Math.abs(a.rate - roundedTarget) ? b : a);
      return { pt: track[best.idx], rate: +best.rate.toFixed(1) };
    });
  };
  return {
    climbs: pickExtremePoints(maxRateRounded),
    sinks: pickExtremePoints(minRateRounded)
  };
}
const MANEUVER_MIN_TURN_DEG = 180;
const MANEUVER_MIN_DURATION_SEC = 4;
const MANEUVER_GAP_MERGE_SEC = 5;
const SPIRAL_NET_RATIO = 0.6;
const SPIRAL_MIN_TURN_DEG = 360;
const WINGOVER_MIN_SWING_DEG = 90;
const MANEUVER_MIN_AVG_SINK = -1;
function turnNetSumDegBetween(track, lo, hi) {
  let net = 0, prevHeading = null;
  for (let k2 = lo; k2 < hi; k2++) {
    if ((haversineDistKm(track[k2], track[k2 + 1]) || 0) < 5e-4) continue;
    const heading = bearingDeg(track[k2], track[k2 + 1]);
    if (prevHeading != null) {
      net += ((heading - prevHeading + 180) % 360 + 360) % 360 - 180;
    }
    prevHeading = heading;
  }
  return net;
}
function maxSinkInRange(track, lo, hi, glitchPrefix) {
  let minRate = Infinity, j = lo;
  for (let i = lo; i <= hi; i++) {
    const t0 = track[i].timeSec, target = t0 + CLIMB_WINDOW_SEC;
    if (j < i) j = i;
    while (j <= hi && track[j].timeSec < target) j++;
    if (j > hi) break;
    if (j === i) continue;
    const dt = track[j].timeSec - t0;
    if (dt <= 0) continue;
    const rate = (track[j].gpsAlt - track[i].gpsAlt) / dt;
    if (Math.abs(rate) > PLAUSIBLE_MAX_VARIO_MS) continue;
    if (altitudeGlitchWindowOverlaps(glitchPrefix, i, j)) continue;
    if (rate < minRate) minRate = rate;
  }
  return isFinite(minRate) ? minRate : 0;
}
function countWingoverSwings(track, lo, hi) {
  let count = 0, sign = 0, sum = 0, prevHeading = null;
  const flush = () => {
    if (Math.abs(sum) >= WINGOVER_MIN_SWING_DEG) count++;
    sum = 0;
  };
  for (let k2 = lo; k2 < hi; k2++) {
    if ((haversineDistKm(track[k2], track[k2 + 1]) || 0) < 5e-4) continue;
    const heading = bearingDeg(track[k2], track[k2 + 1]);
    if (prevHeading != null) {
      const d = ((heading - prevHeading + 180) % 360 + 360) % 360 - 180;
      const s = d > 0 ? 1 : d < 0 ? -1 : 0;
      if (s !== 0 && sign !== 0 && s !== sign) {
        flush();
        sign = s;
      } else if (sign === 0 && s !== 0) sign = s;
      sum += d;
    }
    prevHeading = heading;
  }
  flush();
  return count;
}
function findRawManeuverRuns(track) {
  const steps = [];
  let prevHeading = null, prevIdx = 0;
  for (let k2 = 0; k2 < track.length - 1; k2++) {
    if ((haversineDistKm(track[k2], track[k2 + 1]) || 0) < 5e-4) continue;
    const heading = bearingDeg(track[k2], track[k2 + 1]);
    if (prevHeading != null) {
      const d = ((heading - prevHeading + 180) % 360 + 360) % 360 - 180;
      const dt = track[k2 + 1].timeSec - track[prevIdx].timeSec;
      if (dt > 0) steps.push({ fromIdx: prevIdx, toIdx: k2 + 1, rate: d / dt });
    }
    prevHeading = heading;
    prevIdx = k2 + 1;
  }
  const runs = [];
  for (const s of steps) {
    if (Math.abs(s.rate) <= MANEUVER_TURN_RATE_DEG_S) continue;
    const last = runs[runs.length - 1];
    if (last && track[s.fromIdx].timeSec - track[last.endIdx].timeSec <= MANEUVER_GAP_MERGE_SEC) {
      last.endIdx = s.toIdx;
    } else {
      runs.push({ startIdx: s.fromIdx, endIdx: s.toIdx });
    }
  }
  return runs;
}
function headingTurns(track, halfSec = 2) {
  const n = track.length, hd = new Array(n).fill(null), turn = new Float64Array(n);
  let a = 0, b = 0;
  for (let i = 1; i < n - 1; i++) {
    while (a + 1 <= i - 1 && track[i].timeSec - track[a + 1].timeSec >= halfSec) a++;
    if (b < i + 1) b = i + 1;
    while (b < n - 1 && track[b].timeSec - track[i].timeSec < halfSec) b++;
    const dt = track[b].timeSec - track[a].timeSec;
    if (dt <= 0 || dt > 12) continue;
    if ((haversineDistKm(track[a], track[b]) || 0) * 1e3 / dt < 2) continue;
    hd[i] = bearingDeg(track[a], track[b]);
  }
  for (let i = 2; i < n - 1; i++) if (hd[i] != null && hd[i - 1] != null) turn[i] = Math.abs((hd[i] - hd[i - 1] + 540) % 360 - 180);
  return turn;
}
const TOW_SEARCH_SEC = 900;
function findTowRun(track) {
  const n = track.length;
  if (n < 20) return null;
  const turn = headingTurns(track), turnCum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) turnCum[i + 1] = turnCum[i] + turn[i];
  const tEnd = track[0].timeSec + TOW_SEARCH_SEC;
  const windows = [];
  let j = 0;
  for (let i = 0; i < n && track[i].timeSec <= tEnd; i++) {
    while (j < n && track[j].timeSec < track[i].timeSec + 15) j++;
    if (j >= n) break;
    const dt = track[j].timeSec - track[i].timeSec;
    if (dt <= 0) continue;
    const climb = (track[j].gpsAlt - track[i].gpsAlt) / dt, tsum = turnCum[j + 1] - turnCum[i + 1];
    if (climb >= 1 && tsum <= 60) windows.push({ i, j });
  }
  for (let w = 0; w < windows.length; ) {
    let s = windows[w].i, e = windows[w].j, k2 = w + 1;
    while (k2 < windows.length && track[windows[k2].i].timeSec - track[e].timeSec <= 8) {
      e = Math.max(e, windows[k2].j);
      k2++;
    }
    w = k2;
    const dur = track[e].timeSec - track[s].timeSec, gain = track[e].gpsAlt - track[s].gpsAlt;
    if (dur <= 0) continue;
    if (gain / dur >= 2.5 && dur >= 30 && gain >= 60) {
      let hi = e;
      while (hi < n - 1 && track[hi + 1].timeSec <= track[e].timeSec + 5) hi++;
      return { startIdx: s, endIdx: hi };
    }
  }
  return null;
}
const MANEUVER_EDGE_PADDING_SEC = 6;
function buildManeuverPrefix(track) {
  const mask = new Uint8Array(track.length);
  const tow = findTowRun(track);
  if (tow) for (let k2 = tow.startIdx; k2 <= tow.endIdx; k2++) mask[k2] = 1;
  for (const { startIdx, endIdx } of findRawManeuverRuns(track)) {
    const tStart = track[startIdx].timeSec - MANEUVER_EDGE_PADDING_SEC;
    const tEnd = track[endIdx].timeSec + MANEUVER_EDGE_PADDING_SEC;
    let lo = startIdx;
    while (lo > 0 && track[lo - 1].timeSec >= tStart) lo--;
    let hi = endIdx;
    while (hi < track.length - 1 && track[hi + 1].timeSec <= tEnd) hi++;
    for (let k2 = lo; k2 <= hi; k2++) mask[k2] = 1;
  }
  const prefix = new Array(track.length + 1).fill(0);
  for (let k2 = 0; k2 < track.length; k2++) prefix[k2 + 1] = prefix[k2] + mask[k2];
  return prefix;
}
function maneuverWindowOverlaps(prefix, lo, hi) {
  return prefix[hi + 1] - prefix[lo] > 0;
}
function classifyManeuverRuns(track) {
  const spiralen = [], wingovers = [];
  const glitchPrefix = buildAltitudeGlitchPrefix(track);
  for (const { startIdx, endIdx } of findRawManeuverRuns(track)) {
    const durationSec = track[endIdx].timeSec - track[startIdx].timeSec;
    const totalTurn = turnSumDegBetween(track, startIdx, endIdx);
    if (durationSec < MANEUVER_MIN_DURATION_SEC || totalTurn < MANEUVER_MIN_TURN_DEG) continue;
    const avgSink = +((track[endIdx].gpsAlt - track[startIdx].gpsAlt) / durationSec).toFixed(1);
    if (avgSink > MANEUVER_MIN_AVG_SINK) continue;
    const netTurn = turnNetSumDegBetween(track, startIdx, endIdx);
    const ratio = totalTurn > 0 ? Math.abs(netTurn) / totalTurn : 0;
    const maxSink = +maxSinkInRange(track, startIdx, endIdx, glitchPrefix).toFixed(1);
    const hoehenabbau = Math.round(Math.max(0, track[startIdx].gpsAlt - track[endIdx].gpsAlt));
    if (ratio >= SPIRAL_NET_RATIO) {
      if (totalTurn < SPIRAL_MIN_TURN_DEG) continue;
      spiralen.push({ maxSink, avgSink, hoehenabbau, count: +(totalTurn / 360).toFixed(1) });
    } else {
      const swings = countWingoverSwings(track, startIdx, endIdx);
      if (swings > 0) wingovers.push({ maxSink, avgSink, hoehenabbau, count: swings });
    }
  }
  return { spiralen, wingovers };
}
function pickWorstSink(sequences) {
  if (!sequences.length) return null;
  return sequences.reduce((a, b) => b.maxSink < a.maxSink ? b : a);
}
function analyzeSpiralWingover(track) {
  if (!track || track.length < 5) return { spirale: null, wingover: null };
  const { spiralen, wingovers } = classifyManeuverRuns(track);
  return { spirale: pickWorstSink(spiralen), wingover: pickWorstSink(wingovers) };
}
function fmt1(v) {
  const n = parseFloat(v);
  return isNaN(n) ? "" : n.toFixed(1);
}
function formatDurationHM(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
const GROUND_TRANSPORT_WINDOW_SEC = 30;
const GROUND_TRANSPORT_FAST_KMH = 40;
const GROUND_TRANSPORT_IDLE_KMH = 5;
const GROUND_TRANSPORT_FLAT_VARIO_MS = 0.5;
const GROUND_TRANSPORT_ALT_TOLERANCE_M = 200;
const GROUND_TRANSPORT_GAP_TOLERANCE_SEC = 20;
const GROUND_TRANSPORT_MIN_RUN_SEC = 180;
const GROUND_TRANSPORT_MAX_TRIM_SEC = 3 * 3600;
const GROUND_TRANSPORT_MIN_REMAINING_SEC = 180;
const GROUND_TRANSPORT_SPLIT_MIN_SEGMENT_SEC = 900;
function groundTransportWindowStats(track, i, dir) {
  let j = i;
  if (dir > 0) {
    while (j < track.length - 1 && track[j + 1].timeSec - track[i].timeSec < GROUND_TRANSPORT_WINDOW_SEC) j++;
  } else {
    while (j > 0 && track[i].timeSec - track[j - 1].timeSec < GROUND_TRANSPORT_WINDOW_SEC) j--;
  }
  const lo = dir > 0 ? i : j, hi = dir > 0 ? j : i;
  const dt = track[hi].timeSec - track[lo].timeSec;
  if (dt < GROUND_TRANSPORT_WINDOW_SEC * 0.5) return null;
  let pathKm = 0;
  for (let k2 = lo; k2 < hi; k2++) pathKm += haversineDistKm(track[k2], track[k2 + 1]) || 0;
  return { speedKmh: pathKm / (dt / 3600), varioMs: Math.abs(track[hi].gpsAlt - track[lo].gpsAlt) / dt };
}
function isGroundTransportPoint(track, i, dir, groundAltRefM) {
  if (track[i].gpsAlt - groundAltRefM > GROUND_TRANSPORT_ALT_TOLERANCE_M) return false;
  const w = groundTransportWindowStats(track, i, dir);
  if (!w || w.varioMs >= GROUND_TRANSPORT_FLAT_VARIO_MS) return false;
  return w.speedKmh > GROUND_TRANSPORT_FAST_KMH || w.speedKmh < GROUND_TRANSPORT_IDLE_KMH;
}
function walkGroundTransportBoundary(track, dir, groundAltRefM) {
  const n = track.length;
  const refTime = track[dir > 0 ? 0 : n - 1].timeSec;
  let i = dir > 0 ? 0 : n - 1;
  let lastGoodIdx = -1;
  while (i >= 0 && i < n && Math.abs(track[i].timeSec - refTime) < GROUND_TRANSPORT_MAX_TRIM_SEC) {
    if (isGroundTransportPoint(track, i, dir, groundAltRefM)) {
      lastGoodIdx = i;
      i += dir;
      continue;
    }
    const sinceLastGood = lastGoodIdx === -1 ? Math.abs(track[i].timeSec - refTime) : Math.abs(track[i].timeSec - track[lastGoodIdx].timeSec);
    if (sinceLastGood > GROUND_TRANSPORT_GAP_TOLERANCE_SEC) break;
    i += dir;
  }
  return lastGoodIdx;
}
function findFlightBoundsExcludingGroundTransport(track) {
  const full = { startIdx: 0, endIdx: track.length - 1, trimmedStartSec: 0, trimmedEndSec: 0 };
  if (!track || track.length < 5) return full;
  const t0 = track[0].timeSec, tN = track[track.length - 1].timeSec;
  const groundAltRefM = Math.min(...track.map((p) => p.gpsAlt));
  const lastGoodStart = walkGroundTransportBoundary(track, 1, groundAltRefM);
  const lastGoodEnd = walkGroundTransportBoundary(track, -1, groundAltRefM);
  const startIdx = lastGoodStart === -1 ? 0 : lastGoodStart + 1;
  const endIdx = lastGoodEnd === -1 ? track.length - 1 : lastGoodEnd - 1;
  const trimmedStartSec = track[startIdx].timeSec - t0;
  const trimmedEndSec = tN - track[endIdx].timeSec;
  const effStartIdx = trimmedStartSec >= GROUND_TRANSPORT_MIN_RUN_SEC ? startIdx : 0;
  const effEndIdx = trimmedEndSec >= GROUND_TRANSPORT_MIN_RUN_SEC ? endIdx : track.length - 1;
  if (effStartIdx === 0 && effEndIdx === track.length - 1) return full;
  if (effEndIdx <= effStartIdx || track[effEndIdx].timeSec - track[effStartIdx].timeSec < GROUND_TRANSPORT_MIN_REMAINING_SEC) return full;
  return {
    startIdx: effStartIdx,
    endIdx: effEndIdx,
    trimmedStartSec: effStartIdx ? trimmedStartSec : 0,
    trimmedEndSec: effEndIdx < track.length - 1 ? trimmedEndSec : 0
  };
}
function trimGroundTransportTrack(track) {
  if (!track || track.length < 5) return track;
  const { startIdx, endIdx } = findFlightBoundsExcludingGroundTransport(track);
  return startIdx === 0 && endIdx === track.length - 1 ? track : track.slice(startIdx, endIdx + 1);
}
function detectFlightSegments(track) {
  if (!track || track.length < 5) return track && track.length ? [{ startIdx: 0, endIdx: track.length - 1 }] : [];
  const n = track.length;
  const groundAltRefM = Math.min(...track.map((p) => p.gpsAlt));
  const isGround = new Array(n);
  for (let i2 = 0; i2 < n; i2++) isGround[i2] = isGroundTransportPoint(track, i2, 1, groundAltRefM) || isGroundTransportPoint(track, i2, -1, groundAltRefM);
  const groundRuns = [];
  let i = 0;
  while (i < n) {
    if (!isGround[i]) {
      i++;
      continue;
    }
    const runStart = i;
    let lastGoodIdx = i, j = i + 1;
    while (j < n) {
      if (isGround[j]) {
        lastGoodIdx = j;
        j++;
        continue;
      }
      if (track[j].timeSec - track[lastGoodIdx].timeSec > GROUND_TRANSPORT_GAP_TOLERANCE_SEC) break;
      j++;
    }
    if (track[lastGoodIdx].timeSec - track[runStart].timeSec >= GROUND_TRANSPORT_MIN_RUN_SEC) {
      groundRuns.push({ startIdx: runStart, endIdx: lastGoodIdx });
    }
    i = j;
  }
  const segments = [];
  let cursor = 0;
  for (const run of groundRuns) {
    if (run.startIdx > cursor) segments.push({ startIdx: cursor, endIdx: run.startIdx - 1 });
    cursor = run.endIdx + 1;
  }
  if (cursor <= n - 1) segments.push({ startIdx: cursor, endIdx: n - 1 });
  return segments.filter((s) => track[s.endIdx].timeSec - track[s.startIdx].timeSec >= GROUND_TRANSPORT_SPLIT_MIN_SEGMENT_SEC);
}
function analyzeIGC(track, tzOffsetHours, dateStr) {
  const tz = tzOffsetHours != null ? tzOffsetHours : estimateTzOffset(track[0], dateStr);
  if (!track.length) return {};
  const alts = track.map((p) => p.gpsAlt);
  const maxAlt = Math.max(...alts), minAlt = Math.min(...alts);
  const startAlt = track[0].gpsAlt, endAlt = track[track.length - 1].gpsAlt;
  const startPt = track[0], endPt = track[track.length - 1];
  const { maxClimb, maxClimb20, maxSinkRate, maxClimbBaro } = computeClimbSinkStats(track);
  const glitchPrefix = buildAltitudeGlitchPrefix(track);
  const thermals = [];
  let inT = false, tStart = null;
  for (let i = 1; i < track.length; i++) {
    if (altitudeGlitchWindowOverlaps(glitchPrefix, i - 1, i)) continue;
    const rate = (track[i].gpsAlt - track[i - 1].gpsAlt) / (track[i].timeSec - track[i - 1].timeSec || 1);
    if (rate > 0.5 && !inT) {
      inT = true;
      tStart = i;
    } else if (rate <= 0.5 && inT) {
      inT = false;
      if (tStart) thermals.push({ start: tStart, end: i });
    }
  }
  let totalGain = 0;
  for (let i = 1; i < track.length; i++) {
    if (altitudeGlitchWindowOverlaps(glitchPrefix, i - 1, i)) continue;
    const diff = track[i].gpsAlt - track[i - 1].gpsAlt;
    if (diff > 0) totalGain += diff;
  }
  const fmtClock = (sec) => {
    const local = ((sec + tz * 3600) % 86400 + 86400) % 86400;
    const h = Math.floor(local / 3600), m = Math.floor(local % 3600 / 60), s = Math.floor(local % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  const startTime = fmtClock(track[0].timeSec);
  const endTime = fmtClock(track[track.length - 1].timeSec);
  let durationSec = track[track.length - 1].timeSec - track[0].timeSec;
  if (durationSec < 0) durationSec += 24 * 3600;
  const durationStr = formatDurationHM(durationSec);
  const hDiff = Math.abs(startAlt - endAlt);
  const scoreDistanceKm = computeOpenDistanceKm(track);
  const maxSpeedKmh = computeMaxStraightSpeedKmh(track);
  const { spirale, wingover } = analyzeSpiralWingover(track);
  return {
    maxAlt,
    minAlt,
    startAlt,
    endAlt,
    startPt,
    endPt,
    durationSec,
    durationStr,
    startTime,
    endTime,
    thermalCount: thermals.length,
    thermalBest: computeThermalBest(track),
    maxClimb,
    maxClimb20,
    maxSinkRate,
    maxClimbBaro,
    totalGain: Math.round(totalGain),
    hDiff,
    scoreDistanceKm,
    maxSpeedKmh,
    spiraleMaxSinken: spirale ? spirale.maxSink : null,
    spiraleSinkenSchnitt: spirale ? spirale.avgSink : null,
    spiraleAnzahlKreise: spirale ? spirale.count : null,
    spiraleHoehenabbau: spirale ? spirale.hoehenabbau : null,
    wingoverMaxSinken: wingover ? wingover.maxSink : null,
    wingoverSinkenSchnitt: wingover ? wingover.avgSink : null,
    wingoverAnzahl: wingover ? wingover.count : null,
    wingoverHoehenabbau: wingover ? wingover.hoehenabbau : null
  };
}
function angleDiffDeg(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
function timeWindowBounds(track, i, minWindowSec) {
  let lo = i;
  while (lo > 0 && track[i].timeSec - track[lo - 1].timeSec < minWindowSec) lo--;
  let hi = i;
  while (hi < track.length - 1 && track[hi + 1].timeSec - track[i].timeSec < minWindowSec) hi++;
  return { lo, hi };
}
function isWindowStraight(track, lo, hi, corridorDeg) {
  if (hi - lo < 2) return true;
  const overallHeading = bearingDeg(track[lo], track[hi]);
  for (let k2 = lo; k2 < hi; k2++) {
    if (angleDiffDeg(bearingDeg(track[k2], track[k2 + 1]), overallHeading) > corridorDeg) return false;
  }
  return true;
}
const CIRCLING_WINDOW_SEC = 12;
function circlingTurnSumDeg(track, i) {
  if (!track || track.length < 3) return 0;
  const { lo, hi } = timeWindowBounds(track, i, CIRCLING_WINDOW_SEC);
  if (hi - lo < 2) return 0;
  let totalTurn = 0, prevHeading = null;
  for (let k2 = lo; k2 < hi; k2++) {
    if ((haversineDistKm(track[k2], track[k2 + 1]) || 0) < 5e-4) continue;
    const heading = bearingDeg(track[k2], track[k2 + 1]);
    if (prevHeading != null) {
      const d = ((heading - prevHeading + 180) % 360 + 360) % 360 - 180;
      totalTurn += Math.abs(d);
    }
    prevHeading = heading;
  }
  return totalTurn;
}
const SPEED_WINDOW_SEC = 4;
const SPEED_CORRIDOR_DEG = 15;
const PLAUSIBLE_MAX_SPEED_KMH = 100;
const GAP_FACTOR = 3;
const GAP_MIN_SEC = 3;
const LOCAL_CONTEXT_SEC = 20;
const LOCAL_SPEED_FACTOR = 1.5;
const LOCAL_MIN_KMH = 55;
const DESCENT_CONTEXT_SEC = 45;
const FLAT_ALT_TOLERANCE_M = 5;
function medianFixIntervalSec(track) {
  const dts = [];
  for (let k2 = 1; k2 < track.length; k2++) {
    const dt = track[k2].timeSec - track[k2 - 1].timeSec;
    if (dt > 0) dts.push(dt);
  }
  if (!dts.length) return 1;
  dts.sort((a, b) => a - b);
  return dts[Math.floor(dts.length / 2)];
}
function computeSpeedBreaks(track, medianDt) {
  const gapLimitSec = Math.max(GAP_MIN_SEC, medianDt * GAP_FACTOR);
  const breaks = new Array(track.length - 1).fill(false);
  for (let k2 = 0; k2 < track.length - 1; k2++) {
    const dt = track[k2 + 1].timeSec - track[k2].timeSec;
    if (dt <= 0) continue;
    if (dt > gapLimitSec) {
      breaks[k2] = true;
      continue;
    }
    const distKm = haversineDistKm(track[k2], track[k2 + 1]) || 0;
    if (distKm / (dt / 3600) > PLAUSIBLE_MAX_SPEED_KMH) breaks[k2] = true;
  }
  return breaks;
}
function rangeHasBreak(breaks, lo, hi) {
  for (let k2 = lo; k2 < hi; k2++) if (breaks[k2]) return true;
  return false;
}
function computeTrackBreakTimes(track) {
  const medianDt = medianFixIntervalSec(track);
  const breaks = computeSpeedBreaks(track, medianDt);
  const times = [];
  for (let k2 = 0; k2 < breaks.length; k2++) if (breaks[k2]) times.push(track[k2].timeSec);
  return times;
}
function anyBreakBetween(sortedBreakTimes, lo, hi) {
  if (!sortedBreakTimes.length) return false;
  let left = 0, right = sortedBreakTimes.length;
  while (left < right) {
    const mid = left + right >> 1;
    if (sortedBreakTimes[mid] < lo) left = mid + 1;
    else right = mid;
  }
  return left < sortedBreakTimes.length && sortedBreakTimes[left] < hi;
}
function stepSpeedsKmh(track) {
  const speeds = new Array(track.length - 1);
  for (let k2 = 0; k2 < track.length - 1; k2++) {
    const dt = track[k2 + 1].timeSec - track[k2].timeSec;
    const distKm = haversineDistKm(track[k2], track[k2 + 1]) || 0;
    speeds[k2] = dt > 0 ? distKm / (dt / 3600) : 0;
  }
  return speeds;
}
function isSpeedLocallyPlausible(track, speeds, breaks, i, lo, hi, windowSpeedKmh) {
  if (windowSpeedKmh < LOCAL_MIN_KMH) return true;
  const { lo: nlo, hi: nhi } = timeWindowBounds(track, i, LOCAL_CONTEXT_SEC);
  const context = [];
  for (let k2 = nlo; k2 < nhi; k2++) {
    if (k2 >= lo && k2 < hi) continue;
    if (breaks[k2]) continue;
    context.push(speeds[k2]);
  }
  if (context.length < 3) return true;
  context.sort((a, b) => a - b);
  const localMedian = context[Math.floor(context.length / 2)];
  return windowSpeedKmh <= localMedian * LOCAL_SPEED_FACTOR;
}
function hasPlausibleDescent(track, breaks, i, windowSpeedKmh) {
  if (windowSpeedKmh < LOCAL_MIN_KMH) return true;
  const { lo: nlo, hi: nhi } = timeWindowBounds(track, i, DESCENT_CONTEXT_SEC);
  if (rangeHasBreak(breaks, nlo, nhi)) return false;
  const altLoss = track[nlo].gpsAlt - track[nhi].gpsAlt;
  return altLoss > FLAT_ALT_TOLERANCE_M;
}
function computeMaxStraightSpeedKmh(track) {
  if (!track || track.length < 3) return 0;
  let maxSpeed = 0;
  const medianDt = medianFixIntervalSec(track);
  const speeds = stepSpeedsKmh(track);
  const breaks = computeSpeedBreaks(track, medianDt);
  for (let i = 1; i < track.length - 1; i++) {
    const { lo, hi } = timeWindowBounds(track, i, SPEED_WINDOW_SEC);
    if (hi === lo) continue;
    if (!isWindowStraight(track, lo, hi, SPEED_CORRIDOR_DEG)) continue;
    if (rangeHasBreak(breaks, lo, hi)) continue;
    const dt = track[hi].timeSec - track[lo].timeSec;
    const speedKmh = (haversineDistKm(track[lo], track[hi]) || 0) / (dt / 3600);
    if (speedKmh > PLAUSIBLE_MAX_SPEED_KMH) continue;
    if (!isSpeedLocallyPlausible(track, speeds, breaks, i, lo, hi, speedKmh)) continue;
    if (!hasPlausibleDescent(track, breaks, i, speedKmh)) continue;
    if (speedKmh > maxSpeed) maxSpeed = speedKmh;
  }
  return +maxSpeed.toFixed(1);
}
function buildGpxFromFlight(flight) {
  const track = flight?.track || [];
  if (!track.length) return null;
  const points = track.map((p) => {
    const h = Math.floor(p.timeSec / 3600) % 24, m = Math.floor(p.timeSec % 3600 / 60), s = p.timeSec % 60;
    const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}Z`;
    return `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.gpsAlt}</ele><time>1970-01-01T${timeStr}</time></trkpt>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="meinflugApp" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${String(flight?.name || "Flug").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</name><trkseg>${points}</trkseg></trk>
</gpx>`;
}
const GLIDER_VARIANTS = [
  { id: "custom", label: "Eigenes Symbol", type: "text", char: "" },
  { id: "parachute", label: "Schirm-Emoji", type: "text", char: "🪂" },
  { id: "v1", label: "Dunkelblau", type: "image", dataUrl: "data:image/png;base64,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" },
  { id: "v2", label: "Türkis", type: "image", dataUrl: "data:image/png;base64,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" },
  { id: "v3", label: "Gelb", type: "image", dataUrl: "data:image/png;base64,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" },
  { id: "v4", label: "Weiss/Blau", type: "image", dataUrl: "data:image/png;base64,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" },
  { id: "v7", label: "Blau/Rot", type: "image", dataUrl: "data:image/png;base64,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" },
  { id: "v8", label: "Orange/Blau", type: "image", dataUrl: "data:image/png;base64,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" },
  { id: "v9", label: "Rot/Weiss/Blau", type: "image", dataUrl: "data:image/png;base64,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" }
];
const DEFAULT_GLIDER_VARIANT = "v1";
function removeStrayMapTilerWarnings() {
  try {
    document.querySelectorAll("body *").forEach((el) => {
      if (el.children.length === 0 && /WebGL context was lost/i.test(el.textContent || "")) {
        el.remove();
      }
    });
  } catch (e) {
  }
}
function WorldMapView({ flights, selectedIds, onBack, mapTilerKey, allFlights, setFlights, saveFlight, placeMatchRadiusKm }) {
  const mapDivRef = useRef(null);
  const [showAssign, setShowAssign] = useState(false);
  const missingPlaces = useMemo(() => allFlights ? paCollectGroups(allFlights) : [], [allFlights]);
  const mapRef = useRef(null);
  const [showSP, setShowSP] = useState(true);
  const [showLP, setShowLP] = useState(true);
  const [search, setSearch] = useState("");
  const relevantFlights = selectedIds && selectedIds.size > 0 ? flights.filter((f) => selectedIds.has(f.id)) : flights;
  const points = useMemo(() => {
    const searched = search.trim() ? matchFlights(relevantFlights, search) : relevantFlights;
    const seen = /* @__PURE__ */ new Map();
    for (const f of searched) {
      if (showSP && f.startPt && f.startPt.lat != null) {
        const name = f.site || "";
        const key = `SP:${f.startPt.lat.toFixed(3)},${f.startPt.lon.toFixed(3)}`;
        if (!seen.has(key)) seen.set(key, { lat: f.startPt.lat, lon: f.startPt.lon, type: "SP", name });
      }
      if (showLP && f.endPt && f.endPt.lat != null) {
        const name = f.customFields?.landung || "";
        const key = `LP:${f.endPt.lat.toFixed(3)},${f.endPt.lon.toFixed(3)}`;
        if (!seen.has(key)) seen.set(key, { lat: f.endPt.lat, lon: f.endPt.lon, type: "LP", name });
      }
    }
    return [...seen.values()];
  }, [relevantFlights, showSP, showLP, search]);
  const pointsKey = JSON.stringify(points);
  useEffect(() => {
    if (!mapDivRef.current || !window.maptilersdk || !points.length || !mapTilerKey) return;
    const sdk = window.maptilersdk;
    const initMap = () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      if (mapDivRef.current) mapDivRef.current.innerHTML = "";
      const map = new sdk.Map({
        container: mapDivRef.current,
        apiKey: mapTilerKey,
        style: sdk.MapStyle.OUTDOOR,
        language: "de",
        center: [points[0].lon, points[0].lat],
        zoom: 8
      });
      mapRef.current = map;
      const canvas = map.getCanvas && map.getCanvas();
      if (canvas) {
        canvas.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          removeStrayMapTilerWarnings();
          if (mapRef.current === map) initMap();
        }, { once: true });
      }
      points.forEach((p) => {
        const el = document.createElement("div");
        el.style.cssText = `width:16px;height:16px;border-radius:50%;background:${p.type === "SP" ? "#4ade80" : "#f87171"};border:2px solid rgba(255,255,255,0.85);box-shadow:0 1px 4px rgba(0,0,0,0.5);`;
        const marker = new sdk.Marker({ element: el }).setLngLat([p.lon, p.lat]);
        marker.setPopup(new sdk.Popup({ offset: 14 }).setText(p.name || (p.type === "SP" ? "Startplatz" : "Landeplatz")));
        marker.addTo(map);
      });
      if (points.length > 1) {
        const lons = points.map((p) => p.lon), lats = points.map((p) => p.lat);
        map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 40 });
      }
      map.on("load", () => removeStrayMapTilerWarnings());
    };
    initMap();
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [pointsKey]);
  return /* @__PURE__ */ React.createElement("div", { style: { minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "system-ui,sans-serif", paddingBottom: 24 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "calc(20px + env(safe-area-inset-top, 0px)) 16px 14px", borderBottom: "1px solid rgba(100,180,255,0.1)", marginBottom: 12 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        window.location.href = "index.html";
      },
      title: "Zur Startseite",
      style: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "rgba(232,244,253,0.8)", cursor: "pointer", flexShrink: 0 }
    },
    "🏠"
  ), /* @__PURE__ */ React.createElement("button", { onClick: onBack, style: { background: "none", border: "none", color: "#7dd3fc", fontSize: 22, cursor: "pointer", padding: 0 } }, "‹"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: "#7dd3fc", letterSpacing: 1.5, textTransform: "uppercase" } }, "Weltkarte"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "rgba(232,244,253,0.35)", marginTop: 1 } }, selectedIds && selectedIds.size > 0 ? `${selectedIds.size} ausgewählte Flüge` : `Alle ${flights.length} Flüge`, " · ", points.length, " Orte"))), /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px 10px", display: "flex", gap: 8, alignItems: "center", flexWrap: "nowrap", overflowX: "auto" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setShowSP((s) => !s),
      style: { background: showSP ? "rgba(74,222,128,0.18)" : "rgba(255,255,255,0.05)", border: `1px solid ${showSP ? "rgba(74,222,128,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: 20, padding: "7px 14px", color: showSP ? "#4ade80" : "rgba(232,244,253,0.5)", fontSize: 13, fontWeight: 700, cursor: "pointer" }
    },
    "🛫 Startplätze"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setShowLP((s) => !s),
      style: { background: showLP ? "rgba(248,113,113,0.18)" : "rgba(255,255,255,0.05)", border: `1px solid ${showLP ? "rgba(248,113,113,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: 20, padding: "7px 14px", color: showLP ? "#f87171" : "rgba(232,244,253,0.5)", fontSize: 13, fontWeight: 700, cursor: "pointer" }
    },
    "🛬 Landeplätze"
  ), allFlights && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setShowAssign(true),
      title: "Start-/Landeplätze ohne Koordinaten zuordnen",
      style: { background: missingPlaces.length ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${missingPlaces.length ? "rgba(251,191,36,0.45)" : "rgba(255,255,255,0.1)"}`, borderRadius: 20, padding: "7px 14px", color: missingPlaces.length ? "#fbbf24" : "rgba(232,244,253,0.5)", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }
    },
    "📌 Orte zuordnen",
    missingPlaces.length ? ` (${missingPlaces.length})` : ""
  )), showAssign && /* @__PURE__ */ React.createElement(PlaceAssignDialog, { flights: allFlights, setFlights, saveFlight, mapTilerKey, radiusKm: placeMatchRadiusKm, onClose: () => setShowAssign(false) }), /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px 12px" } }, /* @__PURE__ */ React.createElement(SearchBar, { filterText: search, setFilterText: setSearch, knownGliders: [...new Set(flights.map((f) => f.glider).filter(Boolean))].sort() })), /* @__PURE__ */ React.createElement("div", { style: { margin: "0 16px", position: "relative", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(100,180,255,0.12)" } }, /* @__PURE__ */ React.createElement("div", { ref: mapDivRef, style: { width: "100%", height: "60vh", background: "#040e20" } }), !mapTilerKey && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: "rgba(4,14,32,0.92)", color: "rgba(232,244,253,0.6)", fontSize: 13, textAlign: "center", padding: 24 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 28 } }, "🗺️"), /* @__PURE__ */ React.createElement("div", null, "Kein MapTiler-Schlüssel hinterlegt."), /* @__PURE__ */ React.createElement("a", { href: "service.html", style: { color: "#7dd3fc", fontSize: 12 } }, "→ Unter Service eintragen")), mapTilerKey && points.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,14,32,0.85)", color: "rgba(232,244,253,0.5)", fontSize: 14, pointerEvents: "none" } }, "Keine Orte gefunden.")));
}
const PA_hasPt = (p) => !!p && typeof p.lat === "number" && typeof p.lon === "number" && isFinite(p.lat) && isFinite(p.lon);
function paNorm(s) {
  return String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim();
}
function paCleanQuery(s) {
  return String(s || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}
function paCollectGroups(flights) {
  const m = /* @__PURE__ */ new Map();
  for (const f of flights) {
    for (const kind of ["start", "end"]) {
      const name = String((kind === "start" ? f.site : f.customFields?.landung) || "").trim();
      const norm = paNorm(name);
      if (!norm) continue;
      if (PA_hasPt(kind === "start" ? f.startPt : f.endPt)) continue;
      const key = kind + ":" + norm;
      let g = m.get(key);
      if (!g) {
        g = { key, kind, norm, name, flights: [], variants: /* @__PURE__ */ new Map() };
        m.set(key, g);
      }
      g.flights.push(f);
      g.variants.set(name, (g.variants.get(name) || 0) + 1);
    }
  }
  return [...m.values()].map((g) => {
    let best = g.name, bc = 0;
    for (const [v, c] of g.variants) if (c > bc) {
      best = v;
      bc = c;
    }
    return { ...g, name: best };
  }).sort((a, b) => b.flights.length - a.flights.length || a.name.localeCompare(b.name, "de"));
}
function paBuildKnown(flights) {
  const m = /* @__PURE__ */ new Map();
  for (const f of flights) {
    for (const kind of ["start", "end"]) {
      const pt = kind === "start" ? f.startPt : f.endPt;
      if (!PA_hasPt(pt)) continue;
      const name = String((kind === "start" ? f.site : f.customFields?.landung) || "").trim();
      const alt = kind === "start" ? f.startAlt : f.endAlt;
      const key = kind + ":" + paNorm(name) + ":" + pt.lat.toFixed(3) + "," + pt.lon.toFixed(3);
      let e = m.get(key);
      if (!e) {
        e = { kind, name, norm: paNorm(name), lat: 0, lon: 0, n: 0, alt: 0 };
        m.set(key, e);
      }
      e.lat += pt.lat;
      e.lon += pt.lon;
      e.n++;
      if (alt > 0) e.alt = alt;
    }
  }
  return [...m.values()].map((e) => ({ ...e, lat: e.lat / e.n, lon: e.lon / e.n }));
}
function paOwnCandidates(group, known) {
  const out = [];
  const add = (k2, exact) => {
    const near = out.find((c) => c.exact === exact && haversineDistKm(c, k2) < 0.3);
    if (near) {
      const t = near.n + k2.n;
      near.lat = (near.lat * near.n + k2.lat * k2.n) / t;
      near.lon = (near.lon * near.n + k2.lon * k2.n) / t;
      near.n = t;
      if (k2.alt > 0) near.alt = k2.alt;
      return;
    }
    out.push({ id: "own:" + (exact ? "x" : "f") + ":" + out.length, source: "own", exact, lat: k2.lat, lon: k2.lon, alt: k2.alt || 0, n: k2.n, srcName: k2.name });
  };
  for (const k2 of known) {
    if (!k2.norm) continue;
    if (k2.norm === group.norm) add(k2, true);
    else if (group.norm.length >= 4 && k2.norm.length >= 4 && (k2.norm.includes(group.norm) || group.norm.includes(k2.norm))) add(k2, false);
  }
  return out.map((c) => ({
    ...c,
    label: c.exact ? "Eigene Flüge: gleicher Name" : "Eigene Flüge: ähnlicher Name «" + c.srcName + "»",
    detail: c.n + " Flug-Eintrag" + (c.n === 1 ? "" : "e") + " mit Koordinaten"
  }));
}
async function paFetchJson(url, ms = 12e3) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}
function paAnchor(group, flights) {
  const withPt = flights.filter((f) => PA_hasPt(f.startPt));
  if (!withPt.length) return null;
  const mid = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const center = (list) => list.length ? { lat: mid(list.map((f) => f.startPt.lat)), lon: mid(list.map((f) => f.startPt.lon)) } : null;
  const ts = group.flights.map((f) => parseDateToTs(f.date || f.rawDate)).filter((t) => isFinite(t) && t > 0);
  if (ts.length) {
    const DAY = 864e5;
    const near = withPt.filter((f) => {
      const t = parseDateToTs(f.date || f.rawDate);
      return ts.some((x) => Math.abs(x - t) <= 5 * DAY);
    });
    if (near.length) return center(near);
  }
  const reisen = new Set(group.flights.map((f) => f.customFields?.reise).filter(Boolean));
  if (reisen.size) {
    const l = withPt.filter((f) => reisen.has(f.customFields?.reise));
    if (l.length) return center(l);
  }
  const laender = new Set(group.flights.map((f) => f.customFields?.land).filter(Boolean));
  if (laender.size) {
    const l = withPt.filter((f) => laender.has(f.customFields?.land));
    if (l.length) return center(l);
  }
  return null;
}
async function paSearchOnline(group, anchor, apiKey) {
  const base = paCleanQuery(group.name) || group.name;
  const land = group.flights.map((f) => f.customFields?.land).find(Boolean) || "";
  const queries = [base];
  if (land) queries.push(base + ", " + land);
  const seg = base.split(/\s+[-–\/]\s+/)[0];
  if (seg && seg !== base) queries.push(seg);
  const out = [];
  const push = (c) => {
    if (isFinite(c.lat) && isFinite(c.lon)) out.push(c);
  };
  if (apiKey) {
    for (const q of queries) {
      const data = await paFetchJson(`https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${apiKey}&language=de&limit=5${anchor ? `&proximity=${anchor.lon},${anchor.lat}` : ""}`);
      const feats = data?.features || [];
      feats.forEach((ft, i) => {
        const c = ft.center || ft.geometry?.coordinates;
        if (c) push({ source: "maptiler", lat: c[1], lon: c[0], alt: 0, label: "MapTiler: " + (ft.place_name_de || ft.place_name || ft.text || q), q });
      });
      if (feats.length) break;
    }
  }
  for (const q of queries) {
    const vb = anchor ? `&viewbox=${anchor.lon - 1.5},${anchor.lat + 1.5},${anchor.lon + 1.5},${anchor.lat - 1.5}` : "";
    const data = await paFetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=de&q=${encodeURIComponent(q)}${vb}`);
    const arr = Array.isArray(data) ? data : [];
    arr.forEach((r) => push({ source: "osm", lat: parseFloat(r.lat), lon: parseFloat(r.lon), alt: 0, label: "OpenStreetMap: " + (r.display_name || r.name || q), q }));
    if (arr.length) break;
    await new Promise((r) => setTimeout(r, 1100));
  }
  if (anchor && group.kind === "start") {
    const data = await paFetchJson(`https://www.paraglidingearth.com/api/geojson/getAroundLatLngSites.php?lat=${anchor.lat}&lng=${anchor.lon}&distance=150&limit=300&style=detailed`, 15e3);
    const tokens = paNorm(base).split(" ").filter((t) => t.length >= 4);
    (data?.features || []).forEach((ft) => {
      const nm = paNorm(ft.properties?.name);
      const c = ft.geometry?.coordinates;
      if (!nm || !c) return;
      if (nm === paNorm(base) || nm.includes(paNorm(seg || base)) || paNorm(base).includes(nm) || tokens.some((t) => nm.includes(t))) {
        push({ source: "pge", lat: c[1], lon: c[0], alt: parseFloat(ft.properties?.takeoff_altitude) || 0, label: "ParaglidingEarth: " + ft.properties.name });
      }
    });
  }
  const merged = [];
  for (const c of out) {
    const dup = merged.find((m) => haversineDistKm(m, c) < 0.15);
    if (dup) {
      if (c.alt > 0 && !(dup.alt > 0)) dup.alt = c.alt;
      if (!dup.label.includes(c.label.split(":")[0])) dup.label += " · " + c.label.split(":")[0];
      continue;
    }
    merged.push({ ...c });
  }
  merged.forEach((c, i) => {
    const d = anchor ? haversineDistKm(anchor, c) : null;
    c.dist = d;
    c.detail = d != null ? `${d < 10 ? d.toFixed(1) : Math.round(d)} km vom Umfeld ähnlicher Flüge` : "";
  });
  merged.sort((a, b) => anchor ? (a.dist ?? 1e9) - (b.dist ?? 1e9) : 0);
  return merged.slice(0, 8).map((c, i) => ({ ...c, id: "ext:" + i + ":" + c.source }));
}
function PlaceAssignDialog({ flights, setFlights, saveFlight, mapTilerKey, radiusKm, onClose }) {
  const isWide = useIsWide();
  const flightsRef = useRef(flights);
  flightsRef.current = flights;
  const groups = useMemo(() => paCollectGroups(flights), [flights]);
  const known = useMemo(() => paBuildKnown(flights), [flights]);
  const [ext, setExt] = useState({});
  const [choice, setChoice] = useState({});
  const [selKey, setSelKey] = useState(null);
  const [skipped, setSkipped] = useState(() => /* @__PURE__ */ new Set());
  const [excl, setExcl] = useState(() => /* @__PURE__ */ new Set());
  const [done, setDone] = useState([]);
  const [kindFilter, setKindFilter] = useState("all");
  const [showSkipped, setShowSkipped] = useState(false);
  const [busyMsg, setBusyMsg] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const cancelRef = useRef(false);
  useEffect(() => () => {
    cancelRef.current = true;
  }, []);
  const candsFor = (g) => {
    const own = paOwnCandidates(g, known);
    const exact = own.filter((c) => c.exact), fuzzy = own.filter((c) => !c.exact);
    return [...exact, ...ext[g.key]?.cands || [], ...fuzzy];
  };
  const posFor = (g) => {
    const ch = choice[g.key];
    if (ch) return ch;
    const c = candsFor(g)[0];
    return c ? { id: c.id, lat: c.lat, lon: c.lon, alt: c.alt || 0 } : null;
  };
  const live = useRef({});
  live.current.setPos = (lat, lon, id) => {
    if (!live.current.selKey) return;
    const k2 = live.current.selKey;
    setChoice((c) => ({ ...c, [k2]: { id: id || "manual", lat, lon, alt: id && id !== "manual" ? live.current.altOf?.(id) || 0 : 0 } }));
  };
  live.current.selKey = selKey;
  const visible = groups.filter((g) => (kindFilter === "all" || g.kind === kindFilter) && (showSkipped || !skipped.has(g.key)));
  const selGroup = groups.find((g) => g.key === selKey) || null;
  const selCands = selGroup ? candsFor(selGroup) : [];
  const selPos = selGroup ? posFor(selGroup) : null;
  live.current.altOf = (id) => selCands.find((c) => c.id === id)?.alt || 0;
  const searchOne = async (g) => {
    setExt((e) => ({ ...e, [g.key]: { ...e[g.key] || {}, busy: true } }));
    const anchor = paAnchor(g, flightsRef.current);
    const cands = await paSearchOnline(g, anchor, mapTilerKey);
    setExt((e) => ({ ...e, [g.key]: { busy: false, done: true, cands, anchor } }));
  };
  const searchAll = async () => {
    const todo = visible.filter((g) => !ext[g.key]?.done);
    cancelRef.current = false;
    for (let i = 0; i < todo.length; i++) {
      if (cancelRef.current) break;
      setBusyMsg(`Online-Suche ${i + 1}/${todo.length}: ${todo[i].name}`);
      await searchOne(todo[i]);
      await new Promise((r) => setTimeout(r, 1100));
    }
    setBusyMsg("");
  };
  const confirmGroup = async (g, pos) => {
    if (!pos || !PA_hasPt(pos)) return false;
    const ids = new Set(g.flights.filter((f) => !excl.has(g.kind + ":" + f.id)).map((f) => f.id));
    if (!ids.size) return false;
    const pt = { lat: pos.lat, lon: pos.lon, gpsAlt: pos.alt || 0 };
    const targets = flightsRef.current.filter((f) => ids.has(f.id));
    const updated = /* @__PURE__ */ new Map(), prevAlt = {}, landSet = {};
    let land = "";
    if (g.kind === "start" && targets.some((f) => !(f.customFields?.land || "").trim())) {
      land = findNearbyFieldValue(pt, flightsRef.current, (f) => f.startPt, (f) => f.customFields?.land, radiusKm || 0.5);
      if (!land) land = await reverseGeocodeCountry(pt, mapTilerKey);
    }
    for (const f of targets) {
      let upd = g.kind === "start" ? { ...f, startPt: pt, ...pos.alt > 0 && !(f.startAlt > 0) ? { startAlt: pos.alt } : {} } : { ...f, endPt: pt, ...pos.alt > 0 && !(f.endAlt > 0) ? { endAlt: pos.alt } : {} };
      if (land && !(f.customFields?.land || "").trim()) {
        upd = { ...upd, customFields: { ...f.customFields || {}, land } };
        landSet[f.id] = land;
      }
      const r = await saveFlight(upd);
      if (!r.ok) {
        alert("Speichern fehlgeschlagen für Flug " + (f.name || f.id) + " — Vorgang abgebrochen.");
        break;
      }
      updated.set(f.id, upd);
      prevAlt[f.id] = g.kind === "start" ? f.startAlt : f.endAlt;
    }
    if (updated.size) {
      setFlights((prev) => prev.map((f) => updated.get(f.id) || f));
      setExcl((prev) => {
        const n = new Set(prev);
        g.flights.forEach((f) => n.delete(g.kind + ":" + f.id));
        return n;
      });
      setDone((d) => [{ key: g.key, kind: g.kind, name: g.name, pos: pt, prevAlt, landSet, ids: [...updated.keys()] }, ...d]);
    }
    return updated.size === targets.length;
  };
  const confirmOne = async (g) => {
    setBusyMsg("Speichere «" + g.name + "» …");
    const ok = await confirmGroup(g, posFor(g));
    setBusyMsg("");
    if (ok && selKey === g.key) setSelKey(null);
  };
  const confirmSure = async () => {
    const sure = groups.filter((g) => {
      const o = paOwnCandidates(g, known).filter((c) => c.exact);
      return o.length === 1 && !choice[g.key];
    });
    if (!sure.length) return;
    if (!confirm(sure.length + " Plätze mit eindeutigem Treffer aus den eigenen Flügen übernehmen?")) return;
    for (let i = 0; i < sure.length; i++) {
      const o = paOwnCandidates(sure[i], known).filter((c) => c.exact)[0];
      setBusyMsg(`Speichere ${i + 1}/${sure.length}: ${sure[i].name}`);
      await confirmGroup(sure[i], { lat: o.lat, lon: o.lon, alt: o.alt || 0 });
    }
    setBusyMsg("");
  };
  const undo = async (d) => {
    const ids = new Set(d.ids);
    const targets = flightsRef.current.filter((f) => ids.has(f.id));
    const updated = /* @__PURE__ */ new Map();
    for (const f of targets) {
      let upd = d.kind === "start" ? { ...f, startPt: null, startAlt: d.prevAlt[f.id] ?? 0 } : { ...f, endPt: null, endAlt: d.prevAlt[f.id] ?? 0 };
      if (d.landSet?.[f.id] && f.customFields?.land === d.landSet[f.id]) upd = { ...upd, customFields: { ...f.customFields || {}, land: "" } };
      const r = await saveFlight(upd);
      if (r.ok) updated.set(f.id, upd);
    }
    if (updated.size) setFlights((prev) => prev.map((f) => updated.get(f.id) || f));
    setDone((list) => list.filter((x) => x !== d));
  };
  const mapDivRef = useRef(null), mapRef = useRef(null);
  const knownMk = useRef([]), candMk = useRef([]);
  useEffect(() => {
    if (!mapDivRef.current || !window.maptilersdk || !mapTilerKey) return;
    const sdk = window.maptilersdk;
    const map = new sdk.Map({ container: mapDivRef.current, apiKey: mapTilerKey, style: sdk.MapStyle.OUTDOOR, language: "de", center: [8.2, 46.8], zoom: 6 });
    mapRef.current = map;
    map.on("load", () => {
      removeStrayMapTilerWarnings();
      map.resize();
      setMapReady(true);
    });
    let ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => {
        try {
          map.resize();
        } catch {
        }
      });
      ro.observe(mapDivRef.current);
    }
    setTimeout(() => {
      try {
        map.resize();
      } catch {
      }
    }, 300);
    map.on("click", (e) => {
      if (e.originalEvent?.target?.closest?.("[data-pm]")) return;
      live.current.setPos(e.lngLat.lat, e.lngLat.lng, "manual");
    });
    return () => {
      if (ro) ro.disconnect();
      try {
        map.remove();
      } catch {
      }
      mapRef.current = null;
      setMapReady(false);
    };
  }, [mapTilerKey]);
  useEffect(() => {
    const map = mapRef.current, sdk = window.maptilersdk;
    if (!map || !mapReady || !sdk) return;
    knownMk.current.forEach((m) => m.remove());
    knownMk.current = [];
    known.forEach((k2) => {
      const el = document.createElement("div");
      el.setAttribute("data-pm", "1");
      el.style.cssText = `width:11px;height:11px;border-radius:50%;background:${k2.kind === "start" ? "#4ade80" : "#f87171"};border:1.5px solid rgba(255,255,255,0.9);box-shadow:0 1px 3px rgba(0,0,0,0.5);cursor:pointer;`;
      const mk = new sdk.Marker({ element: el }).setLngLat([k2.lon, k2.lat]).setPopup(new sdk.Popup({ offset: 10 }).setText((k2.kind === "start" ? "🛫 " : "🛬 ") + (k2.name || "(ohne Namen)") + (k2.alt > 0 ? " · " + k2.alt + " m" : "")));
      mk.addTo(map);
      knownMk.current.push(mk);
    });
  }, [mapReady, known]);
  const candKey = selKey + "|" + selCands.map((c) => c.id + c.lat.toFixed(5) + c.lon.toFixed(5)).join(",");
  const posKey = selPos ? selPos.lat.toFixed(6) + "," + selPos.lon.toFixed(6) : "";
  useEffect(() => {
    const map = mapRef.current, sdk = window.maptilersdk;
    if (!map || !mapReady || !sdk) return;
    candMk.current.forEach((m) => m.remove());
    candMk.current = [];
    if (!selGroup) return;
    selCands.forEach((c, i) => {
      const el = document.createElement("div");
      el.setAttribute("data-pm", "1");
      el.textContent = String(i + 1);
      el.style.cssText = "width:22px;height:22px;border-radius:50%;background:#38bdf8;color:#04122a;font:700 12px system-ui;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.6);cursor:pointer;";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        live.current.setPos(c.lat, c.lon, c.id);
      });
      const mk = new sdk.Marker({ element: el }).setLngLat([c.lon, c.lat]);
      mk.addTo(map);
      candMk.current.push(mk);
    });
    if (selPos) {
      const el = document.createElement("div");
      el.setAttribute("data-pm", "1");
      el.style.cssText = "width:26px;height:26px;border-radius:50%;background:rgba(251,191,36,0.35);border:3px solid #fbbf24;box-shadow:0 0 0 2px rgba(0,0,0,0.5);cursor:grab;";
      const mk = new sdk.Marker({ element: el, draggable: true }).setLngLat([selPos.lon, selPos.lat]);
      mk.on("dragend", () => {
        const p = mk.getLngLat();
        live.current.setPos(p.lat, p.lng, "manual");
      });
      mk.addTo(map);
      candMk.current.push(mk);
    }
  }, [mapReady, candKey, posKey]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selGroup) return;
    const pts = selCands.map((c) => [c.lon, c.lat]);
    if (selPos) pts.push([selPos.lon, selPos.lat]);
    if (!pts.length) return;
    if (pts.length === 1) {
      map.flyTo({ center: pts[0], zoom: Math.max(map.getZoom(), 12) });
      return;
    }
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 50, maxZoom: 13 });
  }, [mapReady, selKey, selCands.map((c) => c.id).join(",")]);
  const nFlights = groups.reduce((s, g) => s + g.flights.length, 0);
  const sureCount = groups.filter((g) => paOwnCandidates(g, known).filter((c) => c.exact).length === 1 && !choice[g.key]).length;
  const btn = (extra) => ({ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "6px 11px", color: "#e8f4fd", fontSize: 12, fontWeight: 600, cursor: "pointer", ...extra });
  const chip = (on) => btn({ borderRadius: 20, background: on ? "rgba(125,211,252,0.18)" : "rgba(255,255,255,0.05)", border: `1px solid ${on ? "rgba(125,211,252,0.45)" : "rgba(255,255,255,0.1)"}`, color: on ? "#7dd3fc" : "rgba(232,244,253,0.55)" });
  const parseLatLon = (txt) => {
    const m = String(txt).replace(/;/g, ",").match(/(-?\d+(?:[.,]\d+)?)\s*[,\s]\s*(-?\d+(?:[.,]\d+)?)/);
    if (!m) return null;
    const lat = parseFloat(m[1].replace(",", ".")), lon = parseFloat(m[2].replace(",", "."));
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  };
  const renderRow = (g) => {
    const open = selKey === g.key;
    const cands = candsFor(g), pos = posFor(g), e = ext[g.key];
    const isSkipped = skipped.has(g.key);
    const sortedFl = g.flights.slice().sort((a, b) => parseDateToTs(a.date || a.rawDate) - parseDateToTs(b.date || b.rawDate));
    const uniq = (fn) => [...new Set(g.flights.map(fn).filter(Boolean))];
    const laender = uniq((f) => f.customFields?.land), reisen = uniq((f) => f.customFields?.reise);
    const d0 = sortedFl[0]?.date || "", d1 = sortedFl[sortedFl.length - 1]?.date || "";
    const summary = [d0 && (d0 === d1 ? d0 : d0 + " – " + d1), laender.join(", "), reisen.join(", ")].filter(Boolean).join(" · ");
    const chk = (f) => !excl.has(g.kind + ":" + f.id);
    const nSel = g.flights.filter(chk).length;
    const toggleFl = (f) => setExcl((prev) => {
      const n = new Set(prev), k2 = g.kind + ":" + f.id;
      n.has(k2) ? n.delete(k2) : n.add(k2);
      return n;
    });
    const setAll = (on) => setExcl((prev) => {
      const n = new Set(prev);
      g.flights.forEach((f) => on ? n.delete(g.kind + ":" + f.id) : n.add(g.kind + ":" + f.id));
      return n;
    });
    const otherOf = (f) => g.kind === "start" ? f.customFields?.landung : f.site;
    const bestLabel = pos ? cands.find((c) => c.id === pos.id)?.label || (pos.id === "manual" ? "Eigene Position" : "") : "";
    return /* @__PURE__ */ React.createElement("div", { key: g.key, style: { borderRadius: 12, marginBottom: 8, border: `1px solid ${open ? "rgba(125,211,252,0.45)" : "rgba(255,255,255,0.08)"}`, background: open ? "rgba(125,211,252,0.06)" : "rgba(255,255,255,0.03)", opacity: isSkipped ? 0.55 : 1 } }, /* @__PURE__ */ React.createElement("div", { onClick: () => setSelKey(open ? null : g.key), style: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", cursor: "pointer" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 16 } }, g.kind === "start" ? "🛫" : "🛬"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, g.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.5)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, g.flights.length, " Flug", g.flights.length === 1 ? "" : "e", g.variants.size > 1 ? ` · ${g.variants.size} Schreibweisen` : "", pos ? ` · ${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}` : " · kein Vorschlag", bestLabel ? ` · ${bestLabel}` : ""), summary && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, summary)), pos && !open && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: (ev) => {
          ev.stopPropagation();
          confirmOne(g);
        },
        title: "Vorschlag bestätigen (gilt für alle Flüge mit diesem Namen)",
        style: btn({ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.35)", color: "#4ade80", padding: "5px 10px" })
      },
      "✓"
    ), /* @__PURE__ */ React.createElement("span", { style: { color: "rgba(232,244,253,0.35)", fontSize: 12 } }, open ? "▲" : "▼")), open && /* @__PURE__ */ React.createElement("div", { style: { padding: "0 12px 12px" } }, g.variants.size > 1 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.45)", marginBottom: 8 } }, "Schreibweisen: ", [...g.variants.entries()].map(([v, c]) => `«${v}» (${c}×)`).join(", ")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: 11, color: "rgba(232,244,253,0.55)" } }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }, nSel, " von ", g.flights.length, " Flügen angehakt — die Zuordnung gilt nur für diese"), /* @__PURE__ */ React.createElement("button", { onClick: () => setAll(true), style: btn({ padding: "2px 8px", fontSize: 11 }) }, "Alle"), /* @__PURE__ */ React.createElement("button", { onClick: () => setAll(false), style: btn({ padding: "2px 8px", fontSize: 11 }) }, "Keine")), /* @__PURE__ */ React.createElement("div", { style: { maxHeight: 170, overflowY: "auto", marginBottom: 8, borderRadius: 9, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)" } }, sortedFl.map((f) => /* @__PURE__ */ React.createElement("label", { key: f.id, style: { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, padding: "6px 8px", borderBottom: "1px solid rgba(255,255,255,0.04)", color: "rgba(232,244,253,0.75)", cursor: "pointer", opacity: chk(f) ? 1 : 0.45 } }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: chk(f), onChange: () => toggleFl(f), style: { marginTop: 2, width: 17, height: 17, flexShrink: 0, accentColor: "#38bdf8" } }), /* @__PURE__ */ React.createElement("span", { style: { minWidth: 0, wordBreak: "break-word" } }, /* @__PURE__ */ React.createElement("b", { style: { color: "#e8f4fd" } }, f.date || "—"), [otherOf(f), f.customFields?.land, f.customFields?.reise].filter(Boolean).map((v, i) => /* @__PURE__ */ React.createElement("span", { key: i }, " · ", v)))))), cands.length === 0 && !e?.busy && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.5)", marginBottom: 8 } }, "Noch keine Vorschläge. «Online suchen» startet die Suche — oder in die Karte klicken, um die Position selbst zu setzen."), cands.map((c, i) => /* @__PURE__ */ React.createElement(
      "div",
      {
        key: c.id,
        onClick: () => setChoice((ch) => ({ ...ch, [g.key]: { id: c.id, lat: c.lat, lon: c.lon, alt: c.alt || 0 } })),
        style: {
          display: "flex",
          gap: 9,
          alignItems: "flex-start",
          padding: "7px 8px",
          borderRadius: 9,
          marginBottom: 4,
          cursor: "pointer",
          background: pos?.id === c.id ? "rgba(251,191,36,0.12)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${pos?.id === c.id ? "rgba(251,191,36,0.45)" : "rgba(255,255,255,0.06)"}`
        }
      },
      /* @__PURE__ */ React.createElement("span", { style: { flexShrink: 0, width: 20, height: 20, borderRadius: "50%", background: "#38bdf8", color: "#04122a", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" } }, i + 1),
      /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 600, wordBreak: "break-word" } }, c.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.5)", fontFamily: "monospace" } }, c.lat.toFixed(5), ", ", c.lon.toFixed(5), c.alt > 0 ? ` · ${Math.round(c.alt)} m` : "", c.detail ? ` · ${c.detail}` : ""))
    )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, margin: "8px 0", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)" } }, "Position:"), /* @__PURE__ */ React.createElement(
      "input",
      {
        key: g.key + ":" + (pos ? pos.lat.toFixed(5) + "," + pos.lon.toFixed(5) : ""),
        defaultValue: pos ? `${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}` : "",
        placeholder: "Breite, Länge  (z.B. 46.4123, 8.1054)",
        onClick: (ev) => ev.stopPropagation(),
        onBlur: (ev) => {
          const p = parseLatLon(ev.target.value);
          if (p && (!pos || p.lat !== pos.lat || p.lon !== pos.lon)) setChoice((ch) => ({ ...ch, [g.key]: { id: "manual", lat: p.lat, lon: p.lon, alt: 0 } }));
        },
        onKeyDown: (ev) => {
          if (ev.key === "Enter") ev.target.blur();
        },
        style: { flex: 1, minWidth: 160, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(125,211,252,0.35)", borderRadius: 8, padding: "6px 9px", color: "#e8f4fd", fontSize: 13, fontFamily: "monospace" }
      }
    )), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 8 } }, "Tipp: gelben Ring auf der Karte ziehen oder in die Karte klicken, um die Position anzupassen. Blaue Zahlen = Vorschläge, grüne/rote Punkte = bekannte Plätze."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => confirmOne(g),
        disabled: !pos || !nSel,
        style: btn({ background: pos && nSel ? "rgba(34,197,94,0.18)" : "rgba(255,255,255,0.04)", border: "1px solid rgba(34,197,94,0.4)", color: pos && nSel ? "#4ade80" : "rgba(232,244,253,0.3)", fontWeight: 700 })
      },
      "✓ Bestätigen (",
      nSel,
      " Flug",
      nSel === 1 ? "" : "e",
      ")"
    ), /* @__PURE__ */ React.createElement("button", { onClick: () => searchOne(g), disabled: e?.busy, style: btn() }, e?.busy ? "Suche …" : e?.done ? "🔎 Erneut suchen" : "🔎 Online suchen"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
      setSkipped((s) => {
        const n = new Set(s);
        n.has(g.key) ? n.delete(g.key) : n.add(g.key);
        return n;
      });
      if (!isSkipped) setSelKey(null);
    }, style: btn({ color: "rgba(232,244,253,0.6)" }) }, isSkipped ? "Wieder einblenden" : "Ausblenden")), e?.done && !e.cands.length && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#fbbf24", marginTop: 8 } }, "Online nichts gefunden — Position bitte in der Karte setzen oder Namen prüfen.")));
  };
  const mapPane = /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", ...isWide ? { flex: "1 1 55%", minWidth: 0 } : { height: "42vh", flexShrink: 0 }, background: "#040e20" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", flex: 1, minHeight: 0, background: "#dfe6ea" } }, /* @__PURE__ */ React.createElement("div", { ref: mapDivRef, style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" } }), !mapTilerKey && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: "rgba(4,14,32,0.92)", color: "rgba(232,244,253,0.6)", fontSize: 13, textAlign: "center", padding: 24 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 28 } }, "🗺️"), /* @__PURE__ */ React.createElement("div", null, "Kein MapTiler-Schlüssel hinterlegt."), /* @__PURE__ */ React.createElement("a", { href: "service.html", style: { color: "#7dd3fc", fontSize: 12 } }, "→ Unter Service eintragen"))), /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, fontSize: 12, lineHeight: 1.4, color: "rgba(232,244,253,0.85)", background: "#0a1c36", borderTop: "1px solid rgba(100,180,255,0.18)", padding: "6px 12px", textAlign: "center" } }, selGroup ? "🟡 Ring ziehen oder in die Karte tippen = Position setzen · 🔵 Zahlen = Vorschläge" : "Zeile antippen für Vorschläge · 🟢 Start / 🔴 Landung = bekannte Plätze"));
  return /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 300, background: "#040e20", color: "#e8f4fd", display: "flex", flexDirection: "column", fontFamily: "system-ui,sans-serif" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "calc(12px + env(safe-area-inset-top, 0px)) 14px 10px", borderBottom: "1px solid rgba(100,180,255,0.12)" } }, /* @__PURE__ */ React.createElement("button", { onClick: onClose, style: { background: "none", border: "none", color: "#7dd3fc", fontSize: 24, cursor: "pointer", padding: 0 } }, "‹"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "#7dd3fc", letterSpacing: 1.5, textTransform: "uppercase" } }, "Orte zuordnen"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.45)", marginTop: 1 } }, groups.length, " Plätze ohne Koordinaten · ", nFlights, " Flug-Einträge", done.length ? ` · ${done.length} bestätigt` : ""))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: isWide ? "row" : "column" } }, mapPane, /* @__PURE__ */ React.createElement("div", { style: { flex: isWide ? "1 1 45%" : "1 1 auto", minWidth: 0, minHeight: 0, overflowY: "auto", padding: "10px 12px 40px", borderLeft: isWide ? "1px solid rgba(100,180,255,0.12)" : "none" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" } }, /* @__PURE__ */ React.createElement("button", { onClick: () => setKindFilter("all"), style: chip(kindFilter === "all") }, "Alle"), /* @__PURE__ */ React.createElement("button", { onClick: () => setKindFilter("start"), style: chip(kindFilter === "start") }, "🛫 Start"), /* @__PURE__ */ React.createElement("button", { onClick: () => setKindFilter("end"), style: chip(kindFilter === "end") }, "🛬 Landung"), skipped.size > 0 && /* @__PURE__ */ React.createElement("button", { onClick: () => setShowSkipped((s) => !s), style: chip(showSkipped) }, "Ausgeblendete (", skipped.size, ")")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 } }, /* @__PURE__ */ React.createElement("button", { onClick: searchAll, disabled: !!busyMsg || !visible.length, style: btn({ background: "rgba(125,211,252,0.12)", border: "1px solid rgba(125,211,252,0.35)", color: "#7dd3fc" }) }, "🔎 Alle online suchen"), sureCount > 0 && /* @__PURE__ */ React.createElement("button", { onClick: confirmSure, disabled: !!busyMsg, style: btn({ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.35)", color: "#4ade80" }) }, "✓ ", sureCount, " eindeutige aus eigenen Flügen übernehmen")), busyMsg && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#fbbf24", marginBottom: 10 } }, "⏳ ", busyMsg), !groups.length && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", color: "rgba(232,244,253,0.5)", fontSize: 14, padding: "30px 10px" } }, "🎉 Alle Start- und Landeplätze haben Koordinaten."), visible.map(renderRow), done.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 18 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "#4ade80", letterSpacing: 1.3, textTransform: "uppercase", marginBottom: 6 } }, "Bestätigt (", done.length, ")"), done.map((d, i) => /* @__PURE__ */ React.createElement("div", { key: d.key + i, style: { display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 10, marginBottom: 5, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" } }, /* @__PURE__ */ React.createElement("span", null, d.kind === "start" ? "🛫" : "🛬"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, fontSize: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, d.name), /* @__PURE__ */ React.createElement("div", { style: { color: "rgba(232,244,253,0.5)", fontFamily: "monospace", fontSize: 11 } }, d.pos.lat.toFixed(5), ", ", d.pos.lon.toFixed(5), " · ", d.ids.length, " Flug", d.ids.length === 1 ? "" : "e", (() => {
    const l = Object.values(d.landSet || {})[0];
    return l ? " · Land: " + l : "";
  })())), /* @__PURE__ */ React.createElement("button", { onClick: () => undo(d), style: btn({ padding: "4px 9px", fontSize: 11 }) }, "↶ Rückgängig")))))));
}
function warmClimbColor(pts, i) {
  const a = pts[Math.max(0, i - 3)], b = pts[Math.min(pts.length - 1, i + 3)], dt = b.timeSec - a.timeSec;
  const rate = dt > 0 ? (b.gpsAlt - a.gpsAlt) / dt : 0;
  const h = rate >= 0 ? 55 - 50 * Math.min(rate, 4) / 4 : rate > -0.3 ? 55 : 185, s = 0.95, l = 0.5;
  const k2 = (n) => (n + h / 30) % 12, aa = s * Math.min(l, 1 - l), f = (n) => l - aa * Math.max(-1, Math.min(k2(n) - 3, Math.min(9 - k2(n), 1)));
  return [f(0), f(8), f(4)];
}
function createAltitudeTrackLayer(pts, lineWidthPx = 3, warm = false) {
  const stride = Math.max(1, Math.ceil(pts.length / 12e3));
  const base = [];
  for (let i = 0; i < pts.length; i += stride) base.push(i);
  if (base[base.length - 1] !== pts.length - 1) base.push(pts.length - 1);
  const merc = (p) => {
    const lat = p.lat * Math.PI / 180;
    const x = (p.lon + 180) / 360;
    const y = 0.5 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI);
    const z = (p.gpsAlt || 0) / (40075016686e-3 * Math.cos(lat));
    return [x, y, z];
  };
  const hslToRgb = (h, s, l) => {
    const k2 = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k2(n) - 3, Math.min(9 - k2(n), 1)));
    return [f(0), f(8), f(4)];
  };
  const bxyz = base.map((i) => merc(pts[i]));
  const bcol = base.map((i, k2) => {
    if (warm) return warmClimbColor(pts, i);
    if (k2 === 0) return hslToRgb(70, 0.9, 0.5);
    const a = pts[base[k2 - 1]], b = pts[i], dt = b.timeSec - a.timeSec;
    const rate = dt > 0 ? (b.gpsAlt - a.gpsAlt) / dt : 0;
    return hslToRgb((Math.max(-4, Math.min(4, rate)) + 4) / 8 * 140, 0.9, 0.5);
  });
  const P = [base[0]], xyz = [bxyz[0]], colors = [bcol[0]];
  const turnDeg = (u, v) => {
    const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
    if (lu < 1e-12 || lv < 1e-12) return 0;
    return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)))) * 180 / Math.PI;
  };
  for (let k2 = 0; k2 < base.length - 1; k2++) {
    const p0 = bxyz[Math.max(k2 - 1, 0)], p1 = bxyz[k2], p2 = bxyz[k2 + 1], p3 = bxyz[Math.min(k2 + 2, base.length - 1)];
    const d01 = [p1[0] - p0[0], p1[1] - p0[1]], d12 = [p2[0] - p1[0], p2[1] - p1[1]], d23 = [p3[0] - p2[0], p3[1] - p2[1]];
    const ang = Math.max(turnDeg(d01, d12), turnDeg(d12, d23));
    const m = Math.max(1, Math.min(8, Math.ceil(ang / 6)));
    for (let s = 1; s <= m; s++) {
      const t = s / m, t2 = t * t, t3 = t2 * t;
      const q = [0, 1, 2].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3));
      xyz.push(s === m ? p2 : q);
      P.push(s === m ? base[k2 + 1] : base[k2]);
      colors.push(bcol[k2 + 1]);
    }
  }
  const cx = xyz.reduce((a, v) => a + v[0], 0) / xyz.length;
  const cy = xyz.reduce((a, v) => a + v[1], 0) / xyz.length;
  const cz = 0;
  const data = [];
  for (let k2 = 0; k2 < P.length - 1; k2++) {
    const a = xyz[k2], b = xyz[k2 + 1], c = colors[k2 + 1];
    const A = [a[0] - cx, a[1] - cy, a[2] - cz], B = [b[0] - cx, b[1] - cy, b[2] - cz];
    for (const [t, sd] of [[0, -1], [0, 1], [1, -1], [1, -1], [0, 1], [1, 1]]) data.push(...A, ...B, t, sd, ...c);
  }
  const vertCount = (P.length - 1) * 6;
  let prog = null, buf = null, mapRef = null;
  let drawSegs = P.length - 1;
  return {
    // Zeigt nur den Teil des Tracks bis Trackindex idx (Flug-Video: Linie wächst mit).
    setProgress(idx) {
      let k2 = 0;
      while (k2 < P.length - 1 && P[k2 + 1] <= idx) k2++;
      drawSegs = k2;
    },
    id: "track-altitude",
    type: "custom",
    renderingMode: "3d",
    onAdd(map, gl) {
      const sh = (type, src) => {
        const o = gl.createShader(type);
        gl.shaderSource(o, src);
        gl.compileShader(o);
        return o;
      };
      const vs = sh(gl.VERTEX_SHADER, `
        uniform mat4 u_m; uniform vec2 u_res; uniform float u_w;
        attribute vec3 a_a; attribute vec3 a_b; attribute float a_t; attribute float a_s; attribute vec3 a_c;
        varying vec3 v_c;
        void main() {
          vec4 ca = u_m * vec4(a_a, 1.0), cb = u_m * vec4(a_b, 1.0);
          vec4 cp = a_t < 0.5 ? ca : cb;
          vec2 sa = ca.xy / ca.w * u_res * 0.5, sb = cb.xy / cb.w * u_res * 0.5;
          vec2 d = sb - sa; float l = length(d);
          d = l > 0.0001 ? d / l : vec2(1.0, 0.0);
          vec2 n = vec2(-d.y, d.x);
          cp.xy += n * a_s * u_w * 0.5 / (u_res * 0.5) * cp.w;
          gl_Position = cp; v_c = a_c;
        }`);
      const fs = sh(gl.FRAGMENT_SHADER, `precision mediump float; varying vec3 v_c; void main(){ gl_FragColor = vec4(v_c, 1.0); }`);
      prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      mapRef = map;
      buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    },
    render(gl, args) {
      const M = args && args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : args;
      if (!prog || !M) return;
      const m = Array.from(M);
      for (let r = 0; r < 4; r++) m[12 + r] = M[r] * cx + M[4 + r] * cy + M[8 + r] * cz + M[12 + r];
      gl.useProgram(prog);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "u_m"), false, m);
      gl.uniform2f(gl.getUniformLocation(prog, "u_res"), gl.drawingBufferWidth, gl.drawingBufferHeight);
      const ratio = mapRef ? gl.drawingBufferWidth / Math.max(1, mapRef.getContainer().clientWidth) : window.devicePixelRatio || 1;
      gl.uniform1f(gl.getUniformLocation(prog, "u_w"), lineWidthPx * ratio);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const F = 4, stride2 = 11 * F;
      [["a_a", 3, 0], ["a_b", 3, 3], ["a_t", 1, 6], ["a_s", 1, 7], ["a_c", 3, 8]].forEach(([n, size, off]) => {
        const loc = gl.getAttribLocation(prog, n);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride2, off * F);
      });
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      gl.drawArrays(gl.TRIANGLES, 0, drawSegs * 6);
    },
    onRemove(map, gl) {
      if (buf) gl.deleteBuffer(buf);
      if (prog) gl.deleteProgram(prog);
      buf = prog = null;
    }
  };
}
function createAltitudeCurtainLayer(pts, groundAt, warm = false) {
  const step = Math.max(1, Math.ceil(pts.length / 400)), idx = [];
  for (let i = 0; i < pts.length; i += step) idx.push(i);
  if (idx[idx.length - 1] !== pts.length - 1) idx.push(pts.length - 1);
  const R = Math.PI / 180, CIRC = 40075016686e-3;
  const merc = (p, alt) => {
    const la = p.lat * R;
    return [(p.lon + 180) / 360, 0.5 - Math.log(Math.tan(Math.PI / 4 + la / 2)) / (2 * Math.PI), alt / (CIRC * Math.cos(la))];
  };
  const hsl = (h, s, l) => {
    const k2 = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k2(n) - 3, Math.min(9 - k2(n), 1)));
    return [f(0), f(8), f(4)];
  };
  const minAlt = Math.min(...pts.map((p) => p.gpsAlt));
  const gr = idx.map((i) => {
    const q = groundAt ? groundAt(pts[i].lon, pts[i].lat) : null;
    return q != null && isFinite(q) ? Math.min(q, pts[i].gpsAlt - 3) : null;
  });
  const useG = gr.filter((v) => v != null).length >= idx.length * 0.7;
  const top = idx.map((i) => merc(pts[i], pts[i].gpsAlt));
  const bot = idx.map((i, k2) => merc(pts[i], useG && gr[k2] != null ? gr[k2] : minAlt - 40));
  const col = idx.map((i, k2) => {
    if (warm) return warmClimbColor(pts, i);
    if (k2 === 0) return hsl(70, 0.9, 0.5);
    const a = pts[idx[k2 - 1]], b = pts[i], dt = b.timeSec - a.timeSec, rate = dt > 0 ? (b.gpsAlt - a.gpsAlt) / dt : 0;
    return hsl((Math.max(-4, Math.min(4, rate)) + 4) / 8 * 140, 0.9, 0.5);
  });
  const cx = top.reduce((a, v) => a + v[0], 0) / top.length, cy = top.reduce((a, v) => a + v[1], 0) / top.length;
  const data = [];
  const vtx = (v, c, a) => data.push(v[0] - cx, v[1] - cy, v[2], c[0], c[1], c[2], a);
  for (let k2 = 0; k2 < idx.length - 1; k2++) {
    const c = col[k2 + 1];
    vtx(top[k2], c, 0.1);
    vtx(bot[k2], c, 0.01);
    vtx(top[k2 + 1], c, 0.1);
    vtx(top[k2 + 1], c, 0.1);
    vtx(bot[k2], c, 0.01);
    vtx(bot[k2 + 1], c, 0.01);
  }
  let prog = null, buf = null, drawSegs = idx.length - 1;
  return {
    setProgress(i) {
      let k2 = 0;
      while (k2 < idx.length - 1 && idx[k2 + 1] <= i) k2++;
      drawSegs = k2;
    },
    id: "track-curtain",
    type: "custom",
    renderingMode: "3d",
    usesGround: useG,
    onAdd(map, gl) {
      const sh = (type, src) => {
        const o = gl.createShader(type);
        gl.shaderSource(o, src);
        gl.compileShader(o);
        return o;
      };
      const vs = sh(gl.VERTEX_SHADER, `uniform mat4 u_m; attribute vec3 a_p; attribute vec4 a_c; varying vec4 v_c; void main(){ gl_Position = u_m * vec4(a_p, 1.0); v_c = a_c; }`);
      const fs = sh(gl.FRAGMENT_SHADER, `precision mediump float; varying vec4 v_c; void main(){ gl_FragColor = vec4(v_c.rgb * v_c.a, v_c.a); }`);
      prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    },
    render(gl, args) {
      const M = args && args.defaultProjectionData ? args.defaultProjectionData.mainMatrix : args;
      if (!prog || !M || drawSegs < 1) return;
      const m = Array.from(M);
      for (let r = 0; r < 4; r++) m[12 + r] = M[r] * cx + M[4 + r] * cy + M[12 + r];
      gl.useProgram(prog);
      gl.uniformMatrix4fv(gl.getUniformLocation(prog, "u_m"), false, m);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const F = 4, stride = 7 * F;
      [["a_p", 3, 0], ["a_c", 4, 3]].forEach(([n, size, off]) => {
        const loc = gl.getAttribLocation(prog, n);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * F);
      });
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, drawSegs * 6);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    },
    onRemove(map, gl) {
      if (buf) gl.deleteBuffer(buf);
      if (prog) gl.deleteProgram(prog);
      buf = prog = null;
    }
  };
}
function makeDemSampler(z, tiles) {
  const n = Math.pow(2, z);
  return function elev(lat, lon) {
    const fx = (lon + 180) / 360 * n;
    const s = Math.sin(lat * Math.PI / 180);
    const fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    const tx = Math.floor(fx), ty = Math.floor(fy);
    const t = tiles.get(tx + "," + ty);
    if (!t) return null;
    const px = (fx - tx) * t.size - 0.5, py = (fy - ty) * t.size - 0.5;
    const x0 = Math.max(0, Math.min(t.size - 1, Math.floor(px))), y0 = Math.max(0, Math.min(t.size - 1, Math.floor(py)));
    const x1 = Math.min(t.size - 1, x0 + 1), y1 = Math.min(t.size - 1, y0 + 1);
    const ax = Math.max(0, Math.min(1, px - x0)), ay = Math.max(0, Math.min(1, py - y0));
    const d = t.data;
    const a = d[y0 * t.size + x0] * (1 - ax) + d[y0 * t.size + x1] * ax;
    const b = d[y1 * t.size + x0] * (1 - ax) + d[y1 * t.size + x1] * ax;
    return a * (1 - ay) + b * ay;
  };
}
async function loadVideoDem(track, apiKey, pad = 0.012) {
  if (!apiKey || typeof createImageBitmap === "undefined") return null;
  const lats = track.map((p) => p.lat), lons = track.map((p) => p.lon);
  const bb = { s: Math.min(...lats) - pad, n: Math.max(...lats) + pad, w: Math.min(...lons) - pad, e: Math.max(...lons) + pad };
  const tileXY = (lat, lon, z2) => {
    const n = Math.pow(2, z2), s = Math.sin(lat * Math.PI / 180);
    return [Math.floor((lon + 180) / 360 * n), Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n)];
  };
  let z = 12, list = [];
  for (; z >= 8; z--) {
    const [x0, y0] = tileXY(bb.n, bb.w, z), [x1, y1] = tileXY(bb.s, bb.e, z);
    list = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) list.push([x, y]);
    if (list.length <= 30) break;
  }
  const tiles = /* @__PURE__ */ new Map();
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  await Promise.all(list.map(async ([x, y]) => {
    for (const ext of ["webp", "png"]) {
      try {
        const r = await fetch(`https://api.maptiler.com/tiles/terrain-rgb-v2/${z}/${x}/${y}.${ext}?key=${apiKey}`);
        if (!r.ok) continue;
        const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: "none" });
        cv.width = bmp.width;
        cv.height = bmp.height;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(bmp, 0, 0);
        const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
        const data = new Float32Array(bmp.width * bmp.height);
        for (let i = 0; i < data.length; i++) data[i] = -1e4 + (px[i * 4] * 65536 + px[i * 4 + 1] * 256 + px[i * 4 + 2]) * 0.1;
        tiles.set(x + "," + y, { size: bmp.width, data });
        return;
      } catch (e) {
      }
    }
  }));
  if (!tiles.size) return null;
  return { elev: makeDemSampler(z, tiles), tiles: tiles.size, z };
}
function computeVideoHighlights(track, elev, maxPicks = 3, strict = true) {
  const n = track.length;
  if (n < 30) return [];
  const t0 = track[0].timeSec, t1 = track[n - 1].timeSec, total = t1 - t0;
  if (total < 180) return [];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mLat = 111320;
  const ground = (lat, lon) => {
    if (!elev) return null;
    const g = elev(lat, lon);
    return g != null && isFinite(g) ? g : null;
  };
  const offs = (lat, lon, bearing, m) => {
    const b = bearing * Math.PI / 180;
    return [lat + Math.cos(b) * m / mLat, lon + Math.sin(b) * m / (mLat * Math.cos(lat * Math.PI / 180))];
  };
  const rugged = (lat, lon) => {
    const c = ground(lat, lon);
    if (c == null) return 0;
    let mn = c, mx = c, maxD = 0;
    for (let k2 = 0; k2 < 8; k2++) {
      const [la, lo] = offs(lat, lon, k2 * 45, 500);
      const g = ground(la, lo);
      if (g == null) continue;
      mn = Math.min(mn, g);
      mx = Math.max(mx, g);
      maxD = Math.max(maxD, Math.abs(g - c));
    }
    const slope = Math.atan(maxD / 500) * 180 / Math.PI;
    return 0.6 * clamp((mx - mn - 300) / 700, 0, 1) + 0.4 * clamp((slope - 25) / 20, 0, 1);
  };
  const RUGGED = 0.5;
  const meanPos = (i, j) => {
    let la = 0, lo = 0, c = 0;
    for (let k2 = i; k2 <= j; k2++) {
      la += track[k2].lat;
      lo += track[k2].lon;
      c++;
    }
    return { lat: la / c, lon: lo / c };
  };
  const at = (tc) => {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const m = lo + hi >> 1;
      if (track[m].timeSec <= tc) lo = m;
      else hi = m;
    }
    return lo;
  };
  const headingOver = (i, j) => bearingDeg(track[i], track[j]);
  let maxAlt = -Infinity;
  for (let i = 4; i < n - 4; i++) {
    let s = 0;
    for (let k2 = -4; k2 <= 4; k2++) s += track[i + k2].gpsAlt;
    maxAlt = Math.max(maxAlt, s / 9);
  }
  const startAlt = track[0].gpsAlt;
  const altBonus = (alt) => {
    const rel = maxAlt > startAlt + 200 ? clamp((alt - startAlt) / (maxAlt - startAlt), 0, 1) : 0;
    return 4 * rel * rel + (alt >= 3500 ? 1.5 : 0);
  };
  const cands = [];
  const tow = findTowRun(track), towEndT = tow ? track[tow.endIdx].timeSec : -1;
  const push = (e) => {
    if (e.f0 < towEndT) return;
    cands.push(e);
  };
  const W = 60;
  {
    let j = 0;
    for (let i = 0; i < n - 1; i += 2) {
      if (j < i) j = i;
      while (j < n - 1 && track[j].timeSec - track[i].timeSec < W) j++;
      const dt = track[j].timeSec - track[i].timeSec;
      if (dt < W * 0.8) break;
      const gain = track[j].gpsAlt - track[i].gpsAlt;
      if (gain < 40) continue;
      const rate = gain / dt;
      if (rate < 1) continue;
      if (turnSumDegBetween(track, i, j) < 270) continue;
      const m = meanPos(i, j);
      const rg = rugged(m.lat, m.lon);
      const strong = rate >= 3, rough = rg >= RUGGED;
      if (!strong && !rough) continue;
      push({
        kind: "thermal",
        primary: true,
        score: (strong ? 5 + rate * 1.2 + rg * 2 : 4 + rg * 3 + rate) + altBonus((track[i].gpsAlt + track[j].gpsAlt) / 2),
        center: (track[i].timeSec + track[j].timeSec) / 2,
        f0: track[i].timeSec - 8,
        f1: track[j].timeSec + 8,
        lat: m.lat,
        lon: m.lon,
        orbit: true,
        label: `${strong ? "Starke Thermik" : "Thermik am Berg"} · +${rate.toFixed(1)} m/s`
      });
    }
  }
  if (elev) {
    for (let i = 0; i < n - 1; i += 5) {
      const j = at(track[i].timeSec + 45);
      if (track[j].timeSec - track[i].timeSec < 36) break;
      if (turnSumDegBetween(track, i, j) > 150) continue;
      const kmh = (haversineDistKm(track[i], track[j]) || 0) / ((track[j].timeSec - track[i].timeSec) / 3600);
      if (kmh < 15) continue;
      let sum = 0, cnt = 0, bad = false;
      for (let k2 = i; k2 <= j; k2 += Math.max(1, Math.floor((j - i) / 8))) {
        const g = ground(track[k2].lat, track[k2].lon);
        if (g == null) {
          bad = true;
          break;
        }
        const a = track[k2].gpsAlt - g;
        if (a < -30 || a > 300) {
          bad = true;
          break;
        }
        sum += a;
        cnt++;
      }
      if (bad || !cnt) continue;
      const mid = Math.floor((i + j) / 2);
      const rg = rugged(track[mid].lat, track[mid].lon);
      if (rg < 0.45) continue;
      const h = headingOver(i, j);
      const L = offs(track[mid].lat, track[mid].lon, h - 90, 400), R = offs(track[mid].lat, track[mid].lon, h + 90, 400);
      const gl = ground(L[0], L[1]), gr = ground(R[0], R[1]);
      const bSide = gl != null && gr != null && gl > gr ? h - 90 : h + 90;
      push({
        kind: "ridge",
        primary: true,
        score: 4 + rg * 3 + (300 - sum / cnt) / 150 + altBonus(track[mid].gpsAlt),
        center: (track[i].timeSec + track[j].timeSec) / 2,
        f0: track[i].timeSec - 6,
        f1: track[j].timeSec + 6,
        lat: track[mid].lat,
        lon: track[mid].lon,
        bSide,
        label: "Hangflug am Grat"
      });
    }
    for (let i = 0; i < n; i += 5) {
      const p = track[i];
      const g = ground(p.lat, p.lon);
      if (g == null) continue;
      const agl = p.gpsAlt - g;
      if (agl < -20 || agl > 450) continue;
      let ringMin = g, ringMax = g, ok = true;
      for (let k2 = 0; k2 < 8; k2++) {
        const [la, lo] = offs(p.lat, p.lon, k2 * 45, 700);
        const e = ground(la, lo);
        if (e == null) {
          ok = false;
          break;
        }
        ringMin = Math.min(ringMin, e);
        ringMax = Math.max(ringMax, e);
      }
      if (!ok || ringMax > g + 25 || ringMin > g - 150) continue;
      if (agl > 220 && ringMin > g - 400) continue;
      const k0 = Math.max(0, i - 8), k1 = Math.min(n - 1, i + 8);
      const h = headingOver(k0, k1);
      push({
        kind: "summit",
        primary: true,
        score: 5 + (450 - Math.max(0, agl)) / 200 + (g - ringMin) / 400 + altBonus(p.gpsAlt),
        center: p.timeSec,
        f0: p.timeSec - 38,
        f1: p.timeSec + 18,
        lat: p.lat,
        lon: p.lon,
        heading: h,
        label: `Gipfelüberflug · ${Math.round(g).toLocaleString("de-CH")} m`
      });
    }
    for (let i = 0; i < n - 1; i += 5) {
      const j = at(track[i].timeSec + 60);
      if (track[j].timeSec - track[i].timeSec < 48) break;
      if (turnSumDegBetween(track, i, j) > 45) continue;
      const gs = [];
      for (let s = 0; s <= 6; s++) {
        const k2 = i + Math.round((j - i) * s / 6);
        gs.push(ground(track[k2].lat, track[k2].lon));
      }
      if (gs.some((v) => v == null)) continue;
      const mid = Math.min(gs[2], gs[3], gs[4]);
      const rim = Math.min(Math.max(gs[0], gs[1]), Math.max(gs[5], gs[6]));
      if (rim - mid < 250 || Math.max(...gs) - Math.min(...gs) < 450) continue;
      const km = Math.floor((i + j) / 2);
      if (track[km].gpsAlt - mid < 250) continue;
      push({
        kind: "crossing",
        primary: true,
        score: 3.5 + (rim - mid) / 400,
        center: (track[i].timeSec + track[j].timeSec) / 2,
        f0: track[i].timeSec - 4,
        f1: track[j].timeSec + 4,
        lat: track[km].lat,
        lon: track[km].lon,
        bSide: headingOver(i, j) + 90,
        label: "Talquerung"
      });
    }
  }
  {
    let best = -1, bestAlt = -Infinity;
    for (let i = 4; i < n - 4; i++) {
      let s = 0;
      for (let k2 = -4; k2 <= 4; k2++) s += track[i + k2].gpsAlt;
      if (s / 9 > bestAlt) {
        bestAlt = s / 9;
        best = i;
      }
    }
    if (best >= 0) push({
      kind: "peak",
      primary: true,
      score: 5 + altBonus(bestAlt),
      center: track[best].timeSec,
      f0: track[best].timeSec - 22,
      f1: track[best].timeSec + 22,
      lat: track[best].lat,
      lon: track[best].lon,
      label: `Höchster Punkt · ${Math.round(bestAlt).toLocaleString("de-CH")} m`
    });
  }
  {
    let bestG = null, k2 = 0;
    for (let i = 0; i < n - 1; i += 2) {
      if (k2 < i) k2 = i;
      while (k2 < n - 1 && track[k2].timeSec - track[i].timeSec < 40) k2++;
      const dt = track[k2].timeSec - track[i].timeSec;
      if (dt < 32) break;
      const kmh = (haversineDistKm(track[i], track[k2]) || 0) / (dt / 3600);
      if ((!bestG || kmh > bestG.kmh) && turnSumDegBetween(track, i, k2) < 60) bestG = { kmh, i, k: k2 };
    }
    if (bestG) {
      const c = (track[bestG.i].timeSec + track[bestG.k].timeSec) / 2, m = track[at(c)];
      push({ kind: "glide", primary: false, score: 2.5, center: c, f0: c - 20, f1: c + 20, lat: m.lat, lon: m.lon, label: `Schnelle Gleitphase · ${Math.round(bestG.kmh)} km/h` });
    }
  }
  const maneuvers = [];
  if (!cands.some((c) => c.primary && c.kind !== "peak")) {
    const glitch = buildAltitudeGlitchPrefix(track);
    for (const { startIdx, endIdx } of findRawManeuverRuns(track)) {
      const dur = track[endIdx].timeSec - track[startIdx].timeSec;
      const totalTurn = turnSumDegBetween(track, startIdx, endIdx);
      if (dur < MANEUVER_MIN_DURATION_SEC || totalTurn < MANEUVER_MIN_TURN_DEG) continue;
      const avgSink = (track[endIdx].gpsAlt - track[startIdx].gpsAlt) / dur;
      if (avgSink > MANEUVER_MIN_AVG_SINK) continue;
      const ratio = totalTurn > 0 ? Math.abs(turnNetSumDegBetween(track, startIdx, endIdx)) / totalTurn : 0;
      const spiral = ratio >= SPIRAL_NET_RATIO;
      if (spiral && totalTurn < SPIRAL_MIN_TURN_DEG) continue;
      if (!spiral && countWingoverSwings(track, startIdx, endIdx) < 1) continue;
      const maxSink = maxSinkInRange(track, startIdx, endIdx, glitch);
      const m = meanPos(startIdx, endIdx);
      maneuvers.push({
        kind: spiral ? "spiral" : "wingover",
        primary: false,
        score: 2 + Math.min(2, Math.abs(maxSink) / 10),
        center: (track[startIdx].timeSec + track[endIdx].timeSec) / 2,
        f0: track[startIdx].timeSec - 6,
        f1: track[endIdx].timeSec + 6,
        lat: m.lat,
        lon: m.lon,
        orbit: true,
        label: `${spiral ? "Spirale" : "Wingover"} · ${maxSink.toFixed(0)} m/s`
      });
    }
  }
  const picks = [];
  const okCenter = (c) => c.center > t0 + 75 && c.center < t1 - 100 && picks.every((p) => Math.abs(p.center - c.center) > (p.kind === c.kind ? 300 : 110));
  const kindCount = (k2) => picks.filter((p) => p.kind === k2).length;
  const topScore = Math.max(0, ...cands.filter((c) => c.primary).map((c) => c.score));
  const take = (list, strict2) => {
    for (const c of list.sort((a, b) => b.score - a.score)) {
      if (picks.length >= maxPicks) return;
      if (strict2 && picks.length >= 2 && c.score < 0.7 * topScore) continue;
      if (okCenter(c) && kindCount(c.kind) < 2) picks.push(c);
    }
  };
  take(cands.filter((c) => c.primary), strict);
  if (!picks.some((p) => p.kind !== "peak")) take(maneuvers);
  take(cands.filter((c) => c.kind === "glide"));
  return picks.sort((a, b) => a.center - b.center);
}
function videoPosAt(track, tSec) {
  const n = track.length;
  if (tSec <= track[0].timeSec) return { ...track[0] };
  if (tSec >= track[n - 1].timeSec) return { ...track[n - 1] };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const m = lo + hi >> 1;
    if (track[m].timeSec <= tSec) lo = m;
    else hi = m;
  }
  const a = track[lo], b = track[hi], f = (tSec - a.timeSec) / Math.max(1e-6, b.timeSec - a.timeSec);
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, gpsAlt: a.gpsAlt + (b.gpsAlt - a.gpsAlt) * f, timeSec: tSec, idx: lo };
}
function videoHeadingAt(track, tSec, w) {
  const a = videoPosAt(track, tSec - w), b = videoPosAt(track, tSec + w);
  return (haversineDistKm(a, b) || 0) < 3e-3 ? null : bearingDeg(a, b);
}
function buildVideoScript(track, highlights, D, flight, opts) {
  opts = opts || {};
  const t0 = track[0].timeSec, t1 = track[track.length - 1].timeSec, total = t1 - t0;
  const startLen = Math.min(70, total * 0.08), landLen = Math.min(80, total * 0.1);
  const hlAll = highlights.filter((h2) => h2.f0 > t0 + startLen + 10 && h2.f1 < t1 - landLen - 10);
  const isOn = (h2) => opts[h2.key] && opts[h2.key].on != null ? opts[h2.key].on : h2.defOn !== false;
  const hl = hlAll.filter(isOn);
  const dStart = D * 0.16, dLand = D * 0.16 * 0.7, dOutro = Math.max(3, D * 0.07);
  const avail = D - dStart - dLand - dOutro;
  const wOf = (h2) => 0.7 + 0.6 * Math.max(0, Math.min(1, (h2.score - 2) / 5));
  const wSum = hl.reduce((a, h2) => a + wOf(h2), 0) || 1;
  const all = [];
  const push = (sh) => all.push(sh);
  const b0 = (f) => {
    const h2 = videoHeadingAt(track, f, 20);
    return h2 == null ? 0 : h2;
  };
  const where = flight?.site ? ` · ${flight.site}` : "";
  push({ kind: "start", key: "start", label: `START${where}`, f0: t0, f1: t0 + startLen, d: dStart, warp: 0, b0: b0(t0 + 30) });
  hlAll.forEach((h2) => {
    const on = isOn(h2);
    push({
      kind: h2.kind,
      key: h2.key,
      off: !on,
      label: h2.label,
      f0: h2.f0,
      f1: h2.f1,
      d: on ? Math.min(avail * wOf(h2) / wSum, D * 0.26) : 0,
      warp: 0.6,
      b0: b0(h2.f0),
      center: h2.orbit ? [h2.lon, h2.lat] : null,
      pin: [h2.lon, h2.lat],
      bSide: h2.bSide,
      heading: h2.heading,
      poi: h2.poi,
      poiName: h2.name,
      pk: h2.pk
    });
  });
  push({ kind: "land", key: "land", label: "LANDUNG", f0: t1 - landLen, f1: t1, d: dLand, warp: 0 });
  const land = all[all.length - 1];
  let dist = 0;
  for (let i = 1; i < track.length; i++) dist += haversineDistKm(track[i - 1], track[i]) || 0;
  const h = Math.floor(total / 3600), m = Math.round(total % 3600 / 60);
  push({ kind: "outro", key: "outro", label: `${h > 0 ? h + ":" + String(m).padStart(2, "0") + " h" : m + " min"} · ${dist.toFixed(1)} km`, f0: t1, f1: t1, d: dOutro, warp: 0, prev: land });
  const num = (v) => {
    const x = parseFloat(String(v).replace(",", "."));
    return isFinite(x) ? x : null;
  };
  all.forEach((sh) => {
    const o = opts[sh.key] || {}, z = num(o.zoom), d = num(o.dur);
    sh.zoomAdd = z != null ? z : sh.kind === "poi" ? 0.8 : 0;
    sh.fixed = !sh.off && d != null && d > 0 && sh.key !== "start" && sh.key !== "land" && sh.key !== "outro" ? Math.max(1.5, d) : null;
  });
  const shots = all.filter((sh) => !sh.off);
  const nomSum = shots.reduce((a, sh) => a + sh.d, 0) || 1;
  shots.forEach((sh, k2) => {
    if (!sh.fixed) return;
    const nomD = sh.d * D / nomSum, spd = (sh.f1 - sh.f0) / Math.max(1e-6, nomD);
    const len = sh.fixed * spd, mid = (sh.f0 + sh.f1) / 2;
    const prev = k2 > 0 ? shots[k2 - 1] : null, next = k2 < shots.length - 1 ? shots[k2 + 1] : null;
    const lo = Math.min(sh.f0, Math.max(t0, prev ? prev.f1 : t0));
    const hi = Math.max(sh.f1, Math.min(t1, next && next.kind !== "outro" ? next.f0 : t1));
    let a = mid - len / 2, b = mid + len / 2;
    if (a < lo) {
      b += lo - a;
      a = lo;
    }
    if (b > hi) {
      a -= b - hi;
      b = hi;
    }
    sh.f0 = Math.max(lo, a);
    sh.f1 = Math.min(hi, b);
  });
  const fsum = shots.reduce((a, sh) => a + (sh.fixed || 0), 0), fk = fsum > D * 0.8 ? D * 0.8 / fsum : 1;
  const flexSum = shots.reduce((a, sh) => a + (sh.fixed ? 0 : sh.d), 0) || 1, target = Math.max(D - fsum * fk, D * 0.2);
  shots.forEach((sh) => {
    sh.d = sh.fixed ? sh.fixed * fk : sh.d * target / flexSum;
  });
  const sum = shots.reduce((a, sh) => a + sh.d, 0);
  let acc = 0;
  shots.forEach((sh) => {
    sh.d *= D / sum;
    sh.t0 = acc;
    acc += sh.d;
    sh.t1 = acc;
  });
  all.filter((sh) => sh.off).forEach((sh) => {
    sh.t0 = sh.t1 = null;
  });
  shots.forEach((sh, k2) => {
    if (k2 === 0 || sh.kind === "outro" || shots[k2 - 1].kind === "outro") return;
    const a = videoPosAt(track, shots[k2 - 1].f1), b = videoPosAt(track, sh.f0);
    sh.near = (haversineDistKm(a, b) || 0) < 1.5;
  });
  shots.all = all;
  return shots;
}
function videoPlanCamera(track, elev, f0, f1, speed) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mLat = 111320;
  const ground = (lat, lon) => {
    if (!elev) return null;
    const g = elev(lat, lon);
    return g != null && isFinite(g) ? g : null;
  };
  const S = 10, samples = [];
  for (let k2 = 0; k2 <= S; k2++) samples.push(videoPosAt(track, f0 + (f1 - f0) * k2 / S));
  let mla = 0, mlo = 0;
  samples.forEach((p) => {
    mla += p.lat;
    mlo += p.lon;
  });
  mla /= samples.length;
  mlo /= samples.length;
  let extent = 0;
  samples.forEach((p) => {
    extent = Math.max(extent, (haversineDistKm(p, { lat: mla, lon: mlo }) || 0) * 1e3);
  });
  const compact = extent < 600;
  const turnTotal = turnSumDegBetween(track, samples[0].idx, samples[S].idx);
  const circling = turnTotal >= 450 && turnTotal / Math.max(1, f1 - f0) >= 5;
  const orbit = compact || circling;
  const hw = Math.max(20, speed * 3);
  const hdgAt = (t, fallback) => {
    const h = videoHeadingAt(track, t, hw);
    return h == null ? fallback : h;
  };
  const base = orbit ? { pitch: 55, zoom: 14.7 } : { pitch: 55, zoom: 14.2 };
  const dist = 3e3;
  const visAndScenery = (pos, viewBearing) => {
    if (!elev) return 1;
    const pr = base.pitch * Math.PI / 180, b = viewBearing * Math.PI / 180;
    const hz = dist * Math.sin(pr), vt = dist * Math.cos(pr);
    const mLon = mLat * Math.cos(pos.lat * Math.PI / 180);
    const g0 = ground(pos.lat, pos.lon);
    if (g0 == null) return 1;
    const cLat = pos.lat - Math.cos(b) * hz / mLat, cLon = pos.lon - Math.sin(b) * hz / mLon, cAlt = g0 + vt;
    let clear = 0, tot = 0;
    for (let s = 1; s <= 8; s++) {
      const fr = s / 9;
      const g = ground(cLat + (pos.lat - cLat) * fr, cLon + (pos.lon - cLon) * fr);
      if (g == null) continue;
      tot++;
      if (g <= cAlt + (pos.gpsAlt - cAlt) * fr - 12) clear++;
    }
    const vis = tot ? clear / tot : 1;
    const ga = ground(pos.lat + Math.cos(b) * 1800 / mLat, pos.lon + Math.sin(b) * 1800 / mLon);
    const scenery = ga == null ? 0 : clamp((ga - g0) / 700, -0.3, 1);
    return vis + 0.4 * scenery;
  };
  if (orbit) {
    const center = [mlo, mla];
    const cp = { lat: mla, lon: mlo, gpsAlt: samples.reduce((a, p) => a + p.gpsAlt, 0) / samples.length };
    let best2 = { b0: 0, score: -1 };
    for (let b0 = 0; b0 < 360; b0 += 30) {
      let sc = 0;
      for (let k2 = 0; k2 < 4; k2++) sc += visAndScenery(cp, b0 + 30 * k2);
      sc /= 4;
      if (sc > best2.score) best2 = { b0, score: sc };
    }
    return { mode: "orbit", fixed: compact, center, b0: best2.b0, pitch: base.pitch, zoom: base.zoom, score: best2.score };
  }
  const prefs = { 0: 0.02, 180: 0, 90: 0.1, "-90": 0.1, 135: 0.06, "-135": 0.06, 45: 0.04, "-45": 0.04 };
  let best = { rel: 90, score: -1 };
  let hPrev = hdgAt(f0, 0);
  const hs = samples.map((p, k2) => {
    hPrev = hdgAt(p.timeSec, hPrev);
    return hPrev;
  });
  for (const rel of [0, 180, 90, -90, 135, -135, 45, -45]) {
    let sc = 0;
    samples.forEach((p, k2) => {
      sc += visAndScenery(p, hs[k2] + rel);
    });
    sc = sc / samples.length + prefs[rel];
    if (sc > best.score) best = { rel, score: sc };
  }
  return { mode: "follow", center: [mlo, mla], rel: best.rel, pitch: base.pitch, zoom: base.zoom, score: best.score };
}
function buildManualScript(track, segs, elev, flight) {
  const t0 = track[0].timeSec, t1 = track[track.length - 1].timeSec;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const shots = [];
  let acc = 0;
  segs.forEach((sg) => {
    const f0 = clamp(sg.f0, t0, t1), f1 = clamp(sg.f1, t0, t1);
    if (f1 - f0 < 3) return;
    const speed = Math.max(1, sg.speed || 10);
    const d = Math.max(2, (f1 - f0) / speed);
    const mid = videoPosAt(track, (f0 + f1) / 2);
    const h = videoHeadingAt(track, f0 + 5, 20);
    const b0 = h == null ? 0 : h;
    const k2 = sg.kind;
    const S = 12, smp = [];
    for (let q = 0; q <= S; q++) smp.push(videoPosAt(track, f0 + (f1 - f0) * q / S));
    const cLat = smp.reduce((s, p) => s + p.lat, 0) / smp.length, cLon = smp.reduce((s, p) => s + p.lon, 0) / smp.length;
    const mLatM = 111320, mLonM = 111320 * Math.cos(cLat * Math.PI / 180);
    const extentM = Math.max(...smp.map((p) => Math.hypot((p.lat - cLat) * mLatM, (p.lon - cLon) * mLonM)));
    const A = smp[0], B = smp[S];
    const abx = (B.lon - A.lon) * mLonM, aby = (B.lat - A.lat) * mLatM, abl2 = Math.max(1, abx * abx + aby * aby);
    const lineDevM = Math.max(...smp.map((p) => {
      const px = (p.lon - A.lon) * mLonM, py = (p.lat - A.lat) * mLatM, t = Math.max(0, Math.min(1, (px * abx + py * aby) / abl2));
      return Math.hypot(px - t * abx, py - t * aby);
    }));
    const orbitKind = k2 === "thermal" || k2 === "spiral" || k2 === "wingover";
    const ok = k2 && (orbitKind ? extentM < 600 : k2 === "ridge" || k2 === "crossing" ? sg.bSide != null : k2 === "land" ? lineDevM < 450 : ["summit", "peak", "glide", "start"].includes(k2));
    if (ok) {
      shots.push({
        kind: k2,
        label: sg.label || null,
        f0,
        f1,
        d,
        speed,
        warp: 0,
        b0,
        pin: [orbitKind ? cLon : mid.lon, orbitKind ? cLat : mid.lat],
        center: orbitKind ? [cLon, cLat] : null,
        bSide: sg.bSide,
        heading: sg.heading != null ? sg.heading : b0,
        t0: acc,
        t1: acc + d
      });
    } else {
      const plan = videoPlanCamera(track, elev, f0, f1, speed);
      shots.push({ kind: "mseg", label: sg.label || null, f0, f1, d, speed, plan, warp: 0, b0, pin: [mid.lon, mid.lat], t0: acc, t1: acc + d });
    }
    acc += d;
  });
  shots.forEach((s, k2) => {
    if (k2 === 0) return;
    const a = videoPosAt(track, shots[k2 - 1].f1), b = videoPosAt(track, s.f0);
    s.near = (haversineDistKm(a, b) || 0) < 1.5;
  });
  return shots;
}
async function pickWebCodecsConfig(W, H, fps, bitrate) {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined" || !window.Mp4Muxer) return null;
  const cands = [
    { codec: "avc1.640028", muxer: "avc" },
    { codec: "avc1.4d0028", muxer: "avc" },
    { codec: "avc1.420028", muxer: "avc" },
    { codec: "vp09.00.40.08", muxer: "vp9" }
  ];
  for (const c of cands) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: c.codec, width: W, height: H, bitrate, framerate: fps });
      if (r && r.supported) return c;
    } catch (e) {
    }
  }
  return null;
}
const VIDEO_AUDIO_RATE = 48e3;
async function prepareVideoAudio(file, startSec, D) {
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AC) throw new Error("Dieser Browser kann keine Audiodateien verarbeiten.");
  const n = Math.ceil(D * VIDEO_AUDIO_RATE);
  const ctx = new AC(2, n, VIDEO_AUDIO_RATE);
  let buf;
  try {
    const data = await file.arrayBuffer();
    buf = await new Promise((res, rej) => {
      const p = ctx.decodeAudioData(data, res, rej);
      if (p && p.catch) p.catch(rej);
    });
  } catch (e) {
    throw new Error("Die Musikdatei konnte nicht gelesen werden (Format nicht unterstützt?).");
  }
  const st = Math.max(0, Math.min(startSec || 0, Math.max(0, buf.duration - 1)));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  if (buf.duration - st < D) {
    src.loop = true;
    src.loopStart = st;
    src.loopEnd = buf.duration;
  }
  const g = ctx.createGain();
  const fin = Math.min(1.5, D / 4), fout = Math.min(3, D / 3);
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(0.9, fin);
  g.gain.setValueAtTime(0.9, Math.max(fin, D - fout));
  g.gain.linearRampToValueAtTime(0, D);
  src.connect(g);
  g.connect(ctx.destination);
  src.start(0, st);
  const out = await ctx.startRendering();
  return { sampleRate: out.sampleRate, buffer: out, channels: [out.getChannelData(0), out.getChannelData(1)] };
}
function useVideoFolder(dirName) {
  const fsOk = typeof window !== "undefined" && !!window.showDirectoryPicker && !!window.fsapiHandle;
  const [msg, setMsg] = useState("");
  const [listOpen, setListOpen] = useState(false), [items, setItems] = useState(null), [listMsg, setListMsg] = useState(""), [playItem, setPlayItem] = useState(null);
  useEffect(() => () => {
    if (playItem) URL.revokeObjectURL(playItem.url);
  }, [playItem]);
  const getDir = async (create, interactive) => {
    const handle = await window.fsapiHandle.get("backupDir");
    if (!handle) throw new Error("Kein Backup-Ordner festgelegt (Service → Backup-Ordner).");
    let perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      if (!interactive) throw new Error("NOPERM");
      perm = await handle.requestPermission({ mode: "readwrite" });
    }
    if (perm !== "granted") throw new Error("Zugriff auf den Backup-Ordner nicht erlaubt.");
    return handle.getDirectoryHandle(dirName, { create });
  };
  const save = async (res, interactive, nm) => {
    try {
      const dir = await getDir(true, interactive);
      const name = `${nm}.${res.ext}`;
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(res.blob);
      await w.close();
      setMsg(`✓ Gespeichert im Backup-Ordner: ${dirName}/${name}`);
      return true;
    } catch (e) {
      setMsg(e.message === "NOPERM" ? "Noch nicht im Backup-Ordner abgelegt – „Speichern“ tippen." : "Ablegen im Backup-Ordner fehlgeschlagen: " + e.message);
      return false;
    }
  };
  const saveVideo = async (res, nm) => {
    if (fsOk && await save(res, true, nm)) return;
    const a = document.createElement("a");
    a.href = res.url;
    a.download = `${nm}.${res.ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setMsg((m) => fsOk && m ? m + " Das Video wurde stattdessen heruntergeladen." : "Das Video wurde heruntergeladen.");
  };
  const loadList = async () => {
    setListMsg("");
    try {
      let dir;
      try {
        dir = await getDir(false, true);
      } catch (e) {
        if (e && e.name === "NotFoundError") {
          setItems([]);
          return;
        }
        throw e;
      }
      const arr = [];
      for await (const [name, h] of dir.entries()) {
        if (h.kind !== "file" || !/\.(mp4|webm)$/i.test(name)) continue;
        const f = await h.getFile();
        arr.push({ name, size: f.size, mod: f.lastModified });
      }
      arr.sort((a, b) => b.name.localeCompare(a.name, "de"));
      setItems(arr);
    } catch (e) {
      setItems(null);
      setListMsg("Liste nicht lesbar: " + (e && e.message ? e.message : e));
    }
  };
  const toggleList = async () => {
    if (listOpen) {
      setPlayItem(null);
      setListOpen(false);
      return;
    }
    setListOpen(true);
    await loadList();
  };
  const playFile = async (name) => {
    try {
      const dir = await getDir(false, true);
      const f = await (await dir.getFileHandle(name)).getFile();
      setPlayItem({ name, url: URL.createObjectURL(f) });
    } catch (e) {
      setListMsg("Video nicht lesbar: " + (e && e.message ? e.message : e));
    }
  };
  const deleteFile = async (name) => {
    if (!window.confirm(`„${name}“ löschen?`)) return;
    try {
      const dir = await getDir(false, true);
      await dir.removeEntry(name);
      if (playItem && playItem.name === name) setPlayItem(null);
      await loadList();
    } catch (e) {
      setListMsg("Löschen fehlgeschlagen: " + (e && e.message ? e.message : e));
    }
  };
  return { dirName, fsOk, msg, setMsg, save, saveVideo, listOpen, items, listMsg, playItem, toggleList, playFile, deleteFile };
}
function VideoFolderPanel({ vf, title, btn, isMine }) {
  const [loopVid, setLoopVid] = useState(false);
  useEffect(() => {
    const el = document.querySelector('[data-mine="1"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [vf.items]);
  return /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { onClick: vf.toggleList, style: { ...btn("rgba(255,255,255,0.08)"), height: 38, fontSize: 14, textAlign: "left" } }, title, " ", vf.listOpen ? "▾" : "▸"), vf.listOpen && /* @__PURE__ */ React.createElement(React.Fragment, null, vf.listMsg && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#fca5a5" } }, vf.listMsg), vf.items && !vf.items.length && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)" } }, "Noch keine Videos im Ordner „", vf.dirName, "“ des Backup-Ordners."), vf.playItem && /* @__PURE__ */ React.createElement("video", { src: vf.playItem.url, controls: true, playsInline: true, autoPlay: true, loop: loopVid, style: { width: "100%", maxHeight: "50vh", borderRadius: 10, background: "#000" } }), vf.playItem && /* @__PURE__ */ React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(232,244,253,0.8)" } }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: loopVid, onChange: (e) => setLoopVid(e.target.checked) }), "🔁 Wiederholen"), vf.items && vf.items.map((it) => {
    const mine = !!isMine && isMine(it.name);
    return /* @__PURE__ */ React.createElement("div", { key: it.name, "data-mine": mine ? "1" : void 0, style: { display: "flex", alignItems: "center", gap: 8, background: vf.playItem && vf.playItem.name === it.name ? "rgba(125,211,252,0.12)" : "rgba(255,255,255,0.04)", borderRadius: 8, padding: "6px 8px", border: mine ? "1px solid #7dd3fc" : "1px solid transparent" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.5)" } }, mine && /* @__PURE__ */ React.createElement("b", { style: { color: "#7dd3fc" } }, "● Video zu diesem Flug · "), (it.size / 1048576).toFixed(0), " MB · ", new Date(it.mod).toLocaleDateString("de-CH"))), /* @__PURE__ */ React.createElement("button", { onClick: () => vf.playFile(it.name), title: "Abspielen", style: { ...btn("rgba(22,163,74,0.7)"), height: 34, padding: "0 12px" } }, "▶"), /* @__PURE__ */ React.createElement("button", { onClick: () => vf.deleteFile(it.name), title: "Löschen", style: { ...btn("rgba(220,38,38,0.6)"), height: 34, padding: "0 12px" } }, "🗑"));
  })));
}
const SHARE_MAX_BYTES = 50 * 1024 * 1024;
const videoBitrateFor = (D, purpose) => purpose === "best" ? 1e7 : Math.round(Math.max(15e5, Math.min(1e7, 38e6 * 8 / Math.max(1, D) - 17e4)));
const videoSizeEstimateMB = (D, purpose) => Math.round((videoBitrateFor(D, purpose) / 8 * D + 2e4 * D) / 1e6);
async function shareVideoFile(blob, name, title) {
  if (blob.size > SHARE_MAX_BYTES) return `Das Video ist ${(blob.size / 1048576).toFixed(0)} MB gross – der Browser erlaubt „Teilen“ nur bis 50 MB. Bitte „Speichern“ verwenden.`;
  const file = new File([blob], name, { type: blob.type });
  const t0 = Date.now(), why = (e) => e && e.name ? e.name + (e.message ? ": " + e.message : "") : String(e);
  try {
    await navigator.share({ files: [file], title });
    return "";
  } catch (e) {
    if (e && e.name === "AbortError" && Date.now() - t0 >= 2e3) return "";
    try {
      await navigator.share({ files: [file] });
      return "";
    } catch (e2) {
      if (e2 && e2.name === "AbortError" && Date.now() - t0 >= 2e3) return "";
      return "Teilen nicht möglich (" + why(e2) + ") – bitte „Speichern“ verwenden.";
    }
  }
}
async function pickAudioConfig() {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return null;
  for (const c of [{ codec: "mp4a.40.2", muxer: "aac" }, { codec: "opus", muxer: "opus" }]) {
    try {
      const r = await AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate: VIDEO_AUDIO_RATE, numberOfChannels: 2, bitrate: 16e4 });
      if (r && r.supported) return c;
    } catch (e) {
    }
  }
  return null;
}
async function encodeAudioInto(muxer, mix, cfg) {
  let err = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => {
    err = e;
  } });
  enc.configure({ codec: cfg.codec, sampleRate: mix.sampleRate, numberOfChannels: 2, bitrate: 16e4 });
  const total = mix.channels[0].length, STEP = 4800;
  for (let i = 0; i < total; i += STEP) {
    const n = Math.min(STEP, total - i);
    const d = new Float32Array(n * 2);
    d.set(mix.channels[0].subarray(i, i + n), 0);
    d.set(mix.channels[1].subarray(i, i + n), n);
    const ad = new AudioData({ format: "f32-planar", sampleRate: mix.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / mix.sampleRate), data: d });
    enc.encode(ad);
    ad.close();
    if (err) throw err;
    while (enc.encodeQueueSize > 16) await new Promise((r) => setTimeout(r, 2));
  }
  await enc.flush();
  try {
    enc.close();
  } catch (e) {
  }
  if (err) throw err;
}
async function encodeVideoWebCodecs({ canvas, W, H, fps, frames, bitrate, cfg, renderFrame, onProgress, isCancelled, audio }) {
  const { Muxer, ArrayBufferTarget } = window.Mp4Muxer;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: cfg.muxer, width: W, height: H, frameRate: fps },
    ...audio ? { audio: { codec: audio.cfg.muxer, numberOfChannels: 2, sampleRate: audio.mix.sampleRate } } : {},
    fastStart: "in-memory"
  });
  if (audio) await encodeAudioInto(muxer, audio.mix, audio.cfg);
  let encError = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => {
    encError = e;
  } });
  encoder.configure({ codec: cfg.codec, width: W, height: H, bitrate, framerate: fps });
  for (let k2 = 0; k2 < frames; k2++) {
    if (isCancelled()) {
      try {
        encoder.close();
      } catch (e) {
      }
      return null;
    }
    if (encError) throw encError;
    await renderFrame(k2);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(k2 * 1e6 / fps), duration: Math.round(1e6 / fps) });
    encoder.encode(vf, { keyFrame: k2 % (fps * 2) === 0 });
    vf.close();
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
    if (onProgress) onProgress(k2 + 1, frames);
  }
  await encoder.flush();
  if (encError) throw encError;
  muxer.finalize();
  try {
    encoder.close();
  } catch (e) {
  }
  return new Blob([target.buffer], { type: "video/mp4" });
}
function pickVideoMime() {
  if (typeof MediaRecorder === "undefined") return null;
  const c = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return c.find((m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  }) || null;
}
function fmtVideoRel(sec) {
  const s = Math.max(0, Math.round(sec)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}
const VIDEO_SEG_COLORS = ["#38bdf8", "#f97316", "#a78bfa", "#34d399", "#f472b6", "#facc15"];
const VIDEO_SPEEDS = [1, 2, 3, 5, 10, 20, 50, 100];
const videoSegSeconds = (s) => Math.max(2, (s.f1 - s.f0) / Math.max(1, s.speed || 10));
function FlightVideoRangeEditor({ track, segments, setSegments, pending, setPending, cursor, setCursor, speed, setSpeed, sugg, onLoadSugg, onAddSugg, onAdoptAuto, editId, setEditId }) {
  const t0 = track[0].timeSec, t1 = track[track.length - 1].timeSec, total = Math.max(1, t1 - t0);
  const svgRef = useRef(null), dragRef = useRef(false);
  const pts = useMemo(() => {
    const st = Math.max(1, Math.ceil(track.length / 400)), a2 = [];
    for (let i = 0; i < track.length; i += st) a2.push(track[i]);
    a2.push(track[track.length - 1]);
    return a2;
  }, [track]);
  const [view, setView] = useState(null);
  const [peek, setPeek] = useState(null);
  const v0 = view ? view.v0 : t0, v1 = view ? view.v1 : t1, vspan = Math.max(1, v1 - v0);
  const ptsV = useMemo(() => {
    let lo2 = 0, hi2 = track.length - 1;
    while (lo2 < hi2) {
      const m = lo2 + hi2 >> 1;
      if (track[m].timeSec < v0) lo2 = m + 1;
      else hi2 = m;
    }
    const i0 = Math.max(0, lo2 - 1);
    lo2 = i0;
    hi2 = track.length - 1;
    while (lo2 < hi2) {
      const m = lo2 + hi2 >> 1;
      if (track[m].timeSec <= v1) lo2 = m + 1;
      else hi2 = m;
    }
    const i1 = Math.min(track.length - 1, lo2 + 1);
    const st = Math.max(1, Math.ceil((i1 - i0 + 1) / 400)), a2 = [];
    for (let i = i0; i <= i1; i += st) a2.push(track[i]);
    a2.push(track[i1]);
    return a2;
  }, [track, v0, v1]);
  const aMin = useMemo(() => Math.min(...ptsV.map((p) => p.gpsAlt)), [ptsV]);
  const aMax = useMemo(() => Math.max(...ptsV.map((p) => p.gpsAlt)), [ptsV]);
  const X = (t) => (t - v0) / vspan * 1e3;
  const Y = (a2) => 195 - (a2 - aMin) / Math.max(1, aMax - aMin) * 175;
  const line = ptsV.map((p) => `${X(p.timeSec).toFixed(1)},${Y(p.gpsAlt).toFixed(1)}`).join(" ");
  const moveTo = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    setCursor(v0 + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * vspan);
  };
  const zoomTo = (ta, tb) => {
    const pad = Math.max(20, (tb - ta) * 0.8);
    setView({ v0: Math.max(t0, ta - pad), v1: Math.min(t1, tb + pad) });
  };
  const zoomBy = (fct) => {
    const half = Math.max(10, vspan / 2 * fct);
    let n0 = cursor - half, n1 = cursor + half;
    if (n0 < t0) {
      n1 += t0 - n0;
      n0 = t0;
    }
    if (n1 > t1) {
      n0 -= n1 - t1;
      n1 = t1;
    }
    n0 = Math.max(t0, n0);
    if (n1 - n0 >= total * 0.999) setView(null);
    else setView({ v0: n0, v1: n1 });
  };
  const sel = editId != null ? segments.find((s) => s.id === editId) || null : null;
  useEffect(() => {
    if (sel) {
      zoomTo(sel.f0, sel.f1);
      setCursor(sel.f0);
      setPeek(null);
    }
  }, [editId]);
  const topView = useMemo(() => {
    const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
    const la0 = Math.min(...lats), la1 = Math.max(...lats), lo0 = Math.min(...lons), lo1 = Math.max(...lons);
    const k2 = Math.cos((la0 + la1) / 2 * Math.PI / 180);
    const w = Math.max(1e-6, (lo1 - lo0) * k2), h = Math.max(1e-6, la1 - la0), sc = 176 / Math.max(w, h);
    const ox = (200 - w * sc) / 2, oy = (200 - h * sc) / 2;
    return { P: (p) => [ox + (p.lon - lo0) * k2 * sc, oy + (la1 - p.lat) * sc] };
  }, [pts]);
  const path = (list) => list.map((p) => topView.P(p).map((v) => v.toFixed(1)).join(",")).join(" ");
  const cp = videoPosAt(track, cursor), pa = videoPosAt(track, cursor - 3), pb = videoPosAt(track, cursor + 3);
  const dtw = Math.max(1, pb.timeSec - pa.timeSec);
  const kmh = (haversineDistKm(pa, pb) || 0) / (dtw / 3600), vario = (pb.gpsAlt - pa.gpsAlt) / dtw;
  const cpx = topView.P(cp);
  const a = pending.a, b = pending.b;
  const lo = a != null && b != null ? Math.min(a, b) : null, hi = a != null && b != null ? Math.max(a, b) : null;
  const peekC = peek && sugg ? sugg.list.find((cd) => cd.id === peek) : null;
  const win = sel ? { a: sel.f0, b: sel.f1 } : peekC ? { a: peekC.f0, b: peekC.f1 } : lo != null ? { a: lo, b: hi } : a != null ? { a, b: null } : b != null ? { a: null, b } : null;
  const step = (d) => setCursor(Math.max(t0, Math.min(t1, cursor + d)));
  const norm = (na, nb) => na != null && nb != null && na > nb ? { a: nb, b: na } : { a: na, b: nb };
  const smallBtn = { height: 38, flex: 1, minWidth: 0, borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#e8f4fd", fontSize: 13, fontWeight: 700, cursor: "pointer" };
  const setEdge = (which) => setSegments((list) => list.map((s) => {
    if (s.id !== editId) return s;
    let f0 = s.f0, f1 = s.f1;
    if (which === "start") f0 = cursor;
    else f1 = cursor;
    if (f0 > f1) [f0, f1] = [f1, f0];
    return f1 - f0 < 5 ? s : { ...s, f0, f1 };
  }).sort((x, y) => x.f0 - y.f0));
  const addPending = () => {
    if (lo == null || hi - lo < 5) return;
    setSegments((list) => [...list, { id: Date.now() + Math.random(), f0: lo, f1: hi, speed, label: "", ...pending.meta || {} }].sort((x, y) => x.f0 - y.f0));
    setPending({ a: null, b: null });
  };
  const totalSec = segments.reduce((s, x) => s + videoSegSeconds(x), 0);
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.65)", lineHeight: 1.5 } }, "Cursor im Höhenprofil ziehen, mit «Start hier» und «Ende hier» einen Abschnitt markieren und mit «Abschnitt hinzufügen» übernehmen. Beliebig viele Abschnitte sind möglich. Die Kamera wird je Abschnitt automatisch gewählt."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 340px", minWidth: 0, padding: "0 24px" } }, /* @__PURE__ */ React.createElement(
    "svg",
    {
      ref: svgRef,
      viewBox: "0 0 1000 210",
      preserveAspectRatio: "none",
      style: { width: "100%", height: 150, background: "rgba(255,255,255,0.04)", borderRadius: 10, touchAction: "none", cursor: "ew-resize", display: "block" },
      onPointerDown: (e) => {
        dragRef.current = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
        }
        moveTo(e);
      },
      onPointerMove: (e) => {
        if (dragRef.current) moveTo(e);
      },
      onPointerUp: () => {
        dragRef.current = false;
      },
      onPointerCancel: () => {
        dragRef.current = false;
      }
    },
    segments.map((s, i) => /* @__PURE__ */ React.createElement("rect", { key: s.id, x: X(s.f0), y: "0", width: Math.max(6, X(s.f1) - X(s.f0)), height: "210", fill: VIDEO_SEG_COLORS[i % VIDEO_SEG_COLORS.length], opacity: s.id === editId ? 0.42 : 0.28 })),
    sugg && sugg.list.map((cd) => /* @__PURE__ */ React.createElement("g", { key: cd.id }, /* @__PURE__ */ React.createElement("rect", { x: X(cd.f0), y: "0", width: Math.max(6, X(cd.f1) - X(cd.f0)), height: "16", fill: "#facc15", opacity: segments.some((s) => Math.abs(s.f0 - cd.f0) < 1 && Math.abs(s.f1 - cd.f1) < 1) ? 0.35 : 0.95 }), /* @__PURE__ */ React.createElement("line", { x1: X(cd.center), x2: X(cd.center), y1: "16", y2: "210", stroke: "#facc15", strokeWidth: "1.5", strokeDasharray: "4 5", opacity: "0.7", vectorEffect: "non-scaling-stroke" }))),
    win && win.a != null && win.b != null && /* @__PURE__ */ React.createElement("rect", { x: X(win.a), y: "0", width: Math.max(6, X(win.b) - X(win.a)), height: "210", fill: "rgba(255,255,255,0.10)", stroke: "#fff", strokeWidth: "2.5", strokeDasharray: "10 7", vectorEffect: "non-scaling-stroke" }),
    win && win.a != null && /* @__PURE__ */ React.createElement("line", { x1: X(win.a), x2: X(win.a), y1: "0", y2: "210", stroke: "#4ade80", strokeWidth: "4", vectorEffect: "non-scaling-stroke" }),
    win && win.b != null && /* @__PURE__ */ React.createElement("line", { x1: X(win.b), x2: X(win.b), y1: "0", y2: "210", stroke: "#f87171", strokeWidth: "4", vectorEffect: "non-scaling-stroke" }),
    /* @__PURE__ */ React.createElement("polyline", { points: line, fill: "none", stroke: "#7dd3fc", strokeWidth: "3", vectorEffect: "non-scaling-stroke" }),
    /* @__PURE__ */ React.createElement("line", { x1: X(cursor), x2: X(cursor), y1: "0", y2: "210", stroke: "#fff", strokeWidth: "3", vectorEffect: "non-scaling-stroke" }),
    /* @__PURE__ */ React.createElement("circle", { cx: X(cursor), cy: Y(cp.gpsAlt), r: "11", fill: "#ef4444", stroke: "#fff", strokeWidth: "3", vectorEffect: "non-scaling-stroke" })
  )), /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 200 200", style: { width: 150, height: 150, background: "rgba(255,255,255,0.04)", borderRadius: 10, flex: "0 0 auto" } }, /* @__PURE__ */ React.createElement("polyline", { points: path(pts), fill: "none", stroke: "rgba(125,211,252,0.55)", strokeWidth: "2" }), segments.map((s, i) => /* @__PURE__ */ React.createElement("polyline", { key: s.id, points: path(pts.filter((p) => p.timeSec >= s.f0 && p.timeSec <= s.f1)), fill: "none", stroke: VIDEO_SEG_COLORS[i % VIDEO_SEG_COLORS.length], strokeWidth: "4" })), /* @__PURE__ */ React.createElement("circle", { cx: cpx[0], cy: cpx[1], r: "6", fill: "#ef4444", stroke: "#fff", strokeWidth: "2" }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => zoomBy(0.5), style: smallBtn, title: "Hineinzoomen" }, "🔍＋"), /* @__PURE__ */ React.createElement("button", { onClick: () => zoomBy(2), style: smallBtn, title: "Herauszoomen" }, "🔍－"), /* @__PURE__ */ React.createElement("button", { onClick: () => win && win.a != null && win.b != null ? zoomTo(win.a, win.b) : null, disabled: !(win && win.a != null && win.b != null), style: { ...smallBtn, opacity: win && win.a != null && win.b != null ? 1 : 0.45 }, title: "Auf das markierte Zeitfenster zoomen" }, "🔍 Fenster"), /* @__PURE__ */ React.createElement("button", { onClick: () => setView(null), disabled: !view, style: { ...smallBtn, opacity: view ? 1 : 0.45 } }, "Alles")), sel && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, border: "1px solid rgba(255,255,255,0.35)", borderRadius: 8, padding: "6px 10px", fontSize: 13 } }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }, "✎ Abschnitt ", /* @__PURE__ */ React.createElement("b", null, segments.findIndex((s) => s.id === sel.id) + 1), " wird bearbeitet: Cursor setzen, dann «Start hier» bzw. «Ende hier»."), /* @__PURE__ */ React.createElement("button", { onClick: () => setEditId(null), style: { ...smallBtn, flex: "0 0 80px", borderColor: "#4ade80", color: "#4ade80" } }, "Fertig")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, display: "flex", gap: 14, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", null, "⏱ ", fmtVideoRel(cursor - t0)), /* @__PURE__ */ React.createElement("span", null, "▲ ", Math.round(cp.gpsAlt).toLocaleString("de-CH"), " m"), /* @__PURE__ */ React.createElement("span", null, Math.round(kmh), " km/h"), /* @__PURE__ */ React.createElement("span", { style: { color: vario >= 0.3 ? "#4ade80" : vario <= -2 ? "#f87171" : "#e5e7eb" } }, vario >= 0 ? "+" : "−", Math.abs(vario).toFixed(1), " m/s")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => step(-30), style: smallBtn }, "−30 s"), /* @__PURE__ */ React.createElement("button", { onClick: () => step(-5), style: smallBtn }, "−5 s"), /* @__PURE__ */ React.createElement("button", { onClick: () => step(5), style: smallBtn }, "+5 s"), /* @__PURE__ */ React.createElement("button", { onClick: () => step(30), style: smallBtn }, "+30 s")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => sel ? setEdge("start") : setPending({ ...norm(cursor, b), meta: pending.meta }), style: { ...smallBtn, borderColor: "#4ade80", color: "#4ade80" } }, "▶ Start hier"), /* @__PURE__ */ React.createElement("button", { onClick: () => sel ? setEdge("end") : setPending({ ...norm(a, cursor), meta: pending.meta }), style: { ...smallBtn, borderColor: "#f87171", color: "#f87171" } }, "■ Ende hier")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)", marginBottom: 6 } }, "Abspielgeschwindigkeit (für neue Abschnitte)"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, VIDEO_SPEEDS.map((sp) => /* @__PURE__ */ React.createElement("button", { key: sp, onClick: () => setSpeed(sp), style: { ...smallBtn, flex: "1 0 56px", borderColor: speed === sp ? "#7dd3fc" : "rgba(255,255,255,0.18)", color: speed === sp ? "#7dd3fc" : "#e8f4fd", background: speed === sp ? "rgba(125,211,252,0.2)" : "rgba(255,255,255,0.06)" } }, sp, "×")))), !sel && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: addPending,
      disabled: lo == null || hi - lo < 5,
      style: { height: 44, borderRadius: 10, border: "none", background: lo != null && hi - lo >= 5 ? "#1e40af" : "rgba(255,255,255,0.1)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: lo != null && hi - lo >= 5 ? "pointer" : "default" }
    },
    lo != null ? `＋ Abschnitt hinzufügen (${fmtVideoRel(lo - t0)} – ${fmtVideoRel(hi - t0)}, ${Math.max(2, Math.round((hi - lo) / speed))} s Video)` : "＋ Abschnitt hinzufügen (erst Start und Ende setzen)"
  ), /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid rgba(250,204,21,0.35)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("button", { onClick: onLoadSugg, disabled: sugg.state === "loading", style: { ...smallBtn, flex: "1 1 auto", borderColor: "rgba(250,204,21,0.6)", color: "#facc15" } }, sugg.state === "loading" ? "Vorschläge werden berechnet …" : sugg.state === "done" ? "💡 Vorschläge neu laden" : "💡 Vorschläge laden"), sugg.state === "done" && /* @__PURE__ */ React.createElement("button", { onClick: onAdoptAuto, style: { ...smallBtn, flex: "1 1 auto", borderColor: "rgba(74,222,128,0.6)", color: "#4ade80" } }, "Auto-Auswahl übernehmen")), sugg.msg && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: sugg.state === "error" ? "#fca5a5" : "rgba(232,244,253,0.6)" } }, sugg.msg), sugg.state !== "done" && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", lineHeight: 1.4 } }, "Berechnet aus dem Flug die sehenswertesten Szenen (Thermik, Hang-/Gratflug, Gipfel, höchster Punkt …) als Ausgangspunkt. Sie erscheinen gelb im Höhenprofil und lassen sich einzeln oder gesamt als Abschnitte übernehmen."), sugg.state === "done" && sugg.list.map((cd) => {
    const added = segments.some((s) => Math.abs(s.f0 - cd.f0) < 1 && Math.abs(s.f1 - cd.f1) < 1);
    return /* @__PURE__ */ React.createElement("div", { key: cd.id, style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6 } }, /* @__PURE__ */ React.createElement("div", { onClick: () => {
      const sg = segments.find((s) => Math.abs(s.f0 - cd.f0) < 1 && Math.abs(s.f1 - cd.f1) < 1);
      if (sg) {
        setEditId(sg.id);
      } else {
        setEditId(null);
        setPeek(cd.id);
        setCursor(cd.f0);
        zoomTo(cd.f0, cd.f1);
      }
    }, style: { flex: 1, minWidth: 0, cursor: "pointer" } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, cd.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.6)" } }, fmtVideoRel(cd.f0 - t0), " – ", fmtVideoRel(cd.f1 - t0), " · ", Math.round(cd.f1 - cd.f0), " s Flug", cd.score ? " · Wertung " + cd.score.toFixed(1) : "")), /* @__PURE__ */ React.createElement("button", { onClick: () => onAddSugg(cd), disabled: added, style: { ...smallBtn, flex: "0 0 44px", opacity: added ? 0.45 : 1 } }, added ? "✓" : "＋"));
  })), segments.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, segments.map((s, i) => /* @__PURE__ */ React.createElement("div", { key: s.id, style: { borderStyle: "solid", borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderLeftWidth: 5, borderTopColor: s.id === editId ? "#fff" : "rgba(255,255,255,0.14)", borderRightColor: s.id === editId ? "#fff" : "rgba(255,255,255,0.14)", borderBottomColor: s.id === editId ? "#fff" : "rgba(255,255,255,0.14)", borderLeftColor: VIDEO_SEG_COLORS[i % VIDEO_SEG_COLORS.length], borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13 } }, /* @__PURE__ */ React.createElement("b", null, i + 1), /* @__PURE__ */ React.createElement("span", null, fmtVideoRel(s.f0 - t0), " – ", fmtVideoRel(s.f1 - t0)), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: s.speed,
      onChange: (e) => setSegments((list) => list.map((x) => x.id === s.id ? { ...x, speed: +e.target.value } : x)),
      style: { height: 32, borderRadius: 6, background: "#14253a", color: "#e8f4fd", border: "1px solid rgba(255,255,255,0.2)", padding: "0 6px" }
    },
    VIDEO_SPEEDS.map((sp) => /* @__PURE__ */ React.createElement("option", { key: sp, value: sp }, sp, "×"))
  ), /* @__PURE__ */ React.createElement("span", { style: { color: "rgba(232,244,253,0.65)" } }, "→ ", Math.round(videoSegSeconds(s)), " s Video"), /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }), /* @__PURE__ */ React.createElement("button", { onClick: () => setEditId(s.id === editId ? null : s.id), title: s.id === editId ? "Bearbeiten beenden" : "Start/Ende im Höhenprofil anpassen", style: { ...smallBtn, flex: "0 0 40px", background: s.id === editId ? "rgba(255,255,255,0.22)" : smallBtn.background } }, "✎"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
    if (s.id === editId) setEditId(null);
    setSegments((list) => list.filter((x) => x.id !== s.id));
  }, title: "Entfernen", style: { ...smallBtn, flex: "0 0 40px" } }, "🗑")), /* @__PURE__ */ React.createElement(
    "input",
    {
      value: s.label,
      placeholder: "Titel (optional)",
      maxLength: 40,
      onChange: (e) => setSegments((list) => list.map((x) => x.id === s.id ? { ...x, label: e.target.value } : x)),
      style: { height: 34, borderRadius: 6, background: "rgba(255,255,255,0.06)", color: "#e8f4fd", border: "1px solid rgba(255,255,255,0.18)", padding: "0 8px", fontSize: 13 }
    }
  ))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13 } }, "Videolänge: ", /* @__PURE__ */ React.createElement("b", null, fmtVideoRel(totalSec), " min"), totalSec > 300 && /* @__PURE__ */ React.createElement("span", { style: { color: "#fca5a5" } }, " – maximal 5:00 min möglich"))));
}
const BUILTIN_GLIDER_SYMBOLS = [
  { test: /artik\s*r\s*2/i, url: "icons/glider-artik-r2.png" },
  { test: /sigma\s*11\b/i, url: "icons/glider-sigma-11.png" },
  { test: /sigma\s*12/i, url: "icons/glider-sigma-12-dls.png" }
];
async function loadGliderSymbol(flight) {
  try {
    const r = await window.storage.get("schirme:list");
    const list = r && r.value ? JSON.parse(r.value) : [];
    const sid = flight?.customFields?.schirmId;
    const nm = (flight?.glider || "").trim().toLowerCase();
    const entry = list.find((s) => sid && s.id === sid) || list.find((s) => (s.name || "").trim().toLowerCase() === nm) || null;
    let src = entry && entry.symbol ? entry.symbol : null;
    if (!src) {
      const names = [entry && entry.name, flight?.glider, entry ? (entry.hersteller || "") + " " + (entry.name || "") : null];
      const d = BUILTIN_GLIDER_SYMBOLS.find((x) => names.some((n) => n && x.test.test(n)));
      src = d ? d.url : null;
    }
    if (!src) return null;
    return await new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
  } catch (e) {
    return null;
  }
}
const VIDEO_MAP_STYLES = [{ id: "outdoor", label: "🗺 Gelände" }, { id: "sat", label: "🛰 Satellit" }, { id: "hybrid", label: "🛰 Satellit + Namen" }];
const videoMapStyle = (sdk, kind) => {
  const M = sdk.MapStyle || {};
  const out = M.OUTDOOR || M.BACKDROP && M.BACKDROP.DEFAULT || M.BACKDROP;
  if (kind === "sat") return M.SATELLITE || out;
  if (kind === "hybrid") return M.HYBRID || M.SATELLITE || out;
  return out;
};
function FlightVideoStudio({ flight, track, mapTilerKey, duration, format, purpose, manual, music, demCache, mapStyle, miniStyle, events: dlgEvents, scriptOpts, onDone, onError, onCancelRef, setStatus }) {
  const mainDivRef = useRef(null), miniDivRef = useRef(null), outRef = useRef(null);
  const portrait = format === "port", square = format === "square", narrow = format !== "land";
  const W = portrait ? 720 : square ? 1080 : 1280, H = portrait ? 1280 : square ? 1080 : 720, M = portrait ? 270 : square ? 300 : 330;
  useEffect(() => {
    let cancelled = false;
    let main = null, mini = null, wake = null, rec = null;
    onCancelRef.current = () => {
      cancelled = true;
    };
    const sdk = window.maptilersdk;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, f) => a + (b - a) * f;
    const wrapDelta = (a, b) => ((b - a + 540) % 360 + 360) % 360 - 180;
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const waitIdle = (map, ms) => new Promise((res) => {
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        clearTimeout(to);
        map.off("idle", fin);
        res();
      };
      const to = setTimeout(fin, ms);
      map.on("idle", fin);
      map.triggerRepaint();
    });
    const waitLoad = (map) => new Promise((res, rej) => {
      if (map.loaded()) {
        res();
        return;
      }
      const to = setTimeout(() => rej(new Error("Karte konnte nicht geladen werden (Netzwerk/MapTiler-Schlüssel?)")), 25e3);
      map.once("load", () => {
        clearTimeout(to);
        res();
      });
    });
    const run = async () => {
      if (!sdk) throw new Error("MapTiler-SDK nicht geladen");
      const n = track.length;
      const t0 = track[0].timeSec, t1 = track[n - 1].timeSec;
      let D = duration;
      const base = {
        apiKey: mapTilerKey,
        language: "de",
        interactive: false,
        pixelRatio: 1,
        preserveDrawingBuffer: true,
        canvasContextAttributes: { preserveDrawingBuffer: true },
        fadeDuration: 0,
        attributionControl: false,
        navigationControl: false,
        geolocateControl: false,
        scaleControl: false,
        fullscreenControl: false,
        terrainControl: false
      };
      const lats = track.map((p) => p.lat), lons = track.map((p) => p.lon);
      const bounds = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
      setStatus("Gelände wird analysiert …", 0);
      let dem = demCache && demCache.current ? demCache.current : null;
      if (!dem) {
        try {
          dem = await loadVideoDem(track, mapTilerKey);
        } catch (e) {
          console.warn("Flug-Video: Geländedaten nicht verfügbar", e);
        }
      }
      if (cancelled) return;
      const gliderImg = await loadGliderSymbol(flight);
      if (cancelled) return;
      let shots;
      if (manual) {
        shots = buildManualScript(track, manual, dem && dem.elev, flight);
        if (!shots.length) throw new Error("Keine gültigen Abschnitte gewählt.");
        D = shots[shots.length - 1].t1;
        console.info("Flug-Video: Gelände " + (dem ? `${dem.tiles} Kacheln (z${dem.z})` : "nicht verfügbar") + " · Abschnitte:", shots.map((s) => `${Math.round(s.f1 - s.f0)} s @${s.speed}× ${s.plan ? s.plan.mode + (s.plan.mode === "orbit" ? " " + s.plan.b0 + "°" : " rel " + s.plan.rel + "°") : s.kind}`));
      } else {
        const maxPicks = D >= 90 ? 5 : D >= 60 ? 4 : D >= 45 ? 3 : 2;
        const events = dlgEvents || computeVideoHighlights(track, dem && dem.elev, maxPicks);
        shots = buildVideoScript(track, events, D, flight, scriptOpts);
        console.info("Flug-Video: Gelände " + (dem ? `${dem.tiles} Kacheln (z${dem.z})` : "nicht verfügbar") + " · Szenen:", events.map((e) => e.label));
      }
      const stride = Math.max(1, Math.ceil(n / 700));
      const dec = [];
      for (let i = 0; i < n; i += stride) dec.push(i);
      if (dec[dec.length - 1] !== n - 1) dec.push(n - 1);
      const decCoords = dec.map((i) => [track[i].lon, track[i].lat]);
      setStatus("Geländekarte wird geladen …", 0);
      mini = new sdk.Map({
        ...base,
        pixelRatio: 2,
        container: miniDivRef.current,
        style: videoMapStyle(sdk, miniStyle),
        terrain: false,
        bounds,
        fitBoundsOptions: { padding: 30 }
      });
      const miniBase = document.createElement("canvas");
      miniBase.width = M * 2;
      miniBase.height = M * 2;
      const mb = miniBase.getContext("2d", { willReadFrequently: true });
      mini.on("render", () => {
        try {
          mb.drawImage(mini.getCanvas(), 0, 0, M * 2, M * 2);
        } catch {
        }
      });
      await waitLoad(mini);
      await waitIdle(mini, 8e3);
      if (cancelled) return;
      let blank = true;
      try {
        for (const [fx, fy] of [[0.2, 0.2], [0.5, 0.5], [0.8, 0.8], [0.2, 0.8], [0.8, 0.2]]) if (mb.getImageData(Math.floor(fx * M * 2), Math.floor(fy * M * 2), 1, 1).data[3] > 0) blank = false;
      } catch {
        blank = false;
      }
      if (blank) {
        console.warn("Flug-Video: Minikarte blieb leer – Ersatzhintergrund");
        mb.fillStyle = "#e9efe4";
        mb.fillRect(0, 0, M * 2, M * 2);
      }
      const miniZoom = mini.getZoom();
      const p0 = mini.project(decCoords[0]);
      const mercOf = (lon, lat) => [(lon + 180) / 360, 0.5 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI)];
      const m0 = mercOf(decCoords[0][0], decCoords[0][1]);
      const MS = 512 * Math.pow(2, miniZoom);
      const miniPx = (lon, lat) => {
        const m = mercOf(lon, lat);
        return [p0.x + (m[0] - m0[0]) * MS, p0.y + (m[1] - m0[1]) * MS];
      };
      const decPx = decCoords.map((cc) => miniPx(cc[0], cc[1]));
      const trace = (g, pts, upto) => {
        g.beginPath();
        pts.slice(0, upto).forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]));
      };
      mb.save();
      mb.scale(2, 2);
      mb.lineJoin = "round";
      mb.lineCap = "round";
      trace(mb, decPx, decPx.length);
      mb.strokeStyle = "rgba(255,255,255,0.85)";
      mb.lineWidth = 5;
      mb.stroke();
      trace(mb, decPx, decPx.length);
      mb.strokeStyle = "rgba(30,58,138,0.6)";
      mb.lineWidth = 2.2;
      mb.stroke();
      shots.filter((s) => s.pin).forEach((s) => {
        const q = miniPx(s.pin[0], s.pin[1]);
        mb.beginPath();
        mb.arc(q[0], q[1], 5, 0, 7);
        mb.fillStyle = "#facc15";
        mb.fill();
        mb.strokeStyle = "#fff";
        mb.lineWidth = 2;
        mb.stroke();
      });
      mb.restore();
      mini.remove();
      mini = null;
      setStatus(mapStyle === "outdoor" ? "Geländekarte wird geladen …" : "Satellitenkarte wird geladen …", 0);
      main = new sdk.Map({
        ...base,
        container: mainDivRef.current,
        style: videoMapStyle(sdk, mapStyle),
        terrain: true,
        maxPitch: 85,
        maxTileCacheSize: 600,
        center: [track[0].lon, track[0].lat],
        zoom: 13,
        pitch: 60
      });
      await waitLoad(main);
      if (cancelled) return;
      const altLayer = createAltitudeTrackLayer(track, 2.4);
      main.addLayer(altLayer);
      altLayer.setProgress(0);
      const overview = main.cameraForBounds(bounds, { padding: narrow ? 50 : 90, pitch: 0, bearing: 0 }) || { center: main.getCenter(), zoom: 11 };
      let lastGround = 0;
      const cameraFor = (sh, u, pos) => {
        const e = u * u * (3 - 2 * u);
        const ft = pos.timeSec;
        const speedEff = clamp((sh.f1 - sh.f0) / Math.max(1, sh.d || 1), 1, 200);
        const Wc = clamp(0.9 * speedEff, 3, 40);
        let cla = 0, clo = 0;
        for (const k2 of [-1, -0.5, 0, 0.5, 1]) {
          const q = videoPosAt(track, ft + k2 * Wc);
          cla += q.lat;
          clo += q.lon;
        }
        const cpos = [clo / 5, cla / 5];
        let c;
        switch (sh.kind) {
          case "mseg": {
            const pl = sh.plan;
            const zb = pl.zoom - clamp(0.35 * Math.log2(Math.max(1, sh.speed / 6)), 0, 1.4);
            if (pl.mode === "orbit") {
              let ctr = pl.center;
              if (!pl.fixed) {
                let la = 0, lo = 0;
                for (let k2 = -3; k2 <= 3; k2++) {
                  const q = videoPosAt(track, ft + k2 * 15);
                  la += q.lat;
                  lo += q.lon;
                }
                ctr = [lo / 7, la / 7];
              }
              c = { center: ctr, bearing: pl.b0 + 90 * u, pitch: pl.pitch, zoom: zb + 0.2 };
            } else {
              const h = videoHeadingAt(track, ft, Math.max(20, sh.speed * 3));
              c = { center: cpos, bearing: (h == null ? sh.b0 : h) + pl.rel + 12 * Math.sin(u * Math.PI), pitch: pl.pitch, zoom: zb };
            }
            break;
          }
          case "poi": {
            if (!sh._p) {
              const smp = [];
              for (let k2 = 0; k2 <= 10; k2++) smp.push(videoPosAt(track, sh.f0 + (sh.f1 - sh.f0) * k2 / 10));
              const cen = { lat: smp.reduce((a, q) => a + q.lat, 0) / smp.length, lon: smp.reduce((a, q) => a + q.lon, 0) / smp.length };
              const mid = { lat: (cen.lat + sh.poi.lat) / 2, lon: (cen.lon + sh.poi.lon) / 2 };
              const far = Math.max(2500, (haversineDistKm(mid, sh.poi) || 0) * 1e3, ...smp.map((q) => (haversineDistKm(mid, q) || 0) * 1e3));
              sh._p = { center: [mid.lon, mid.lat], b: bearingDeg(cen, sh.poi), z: clamp(Math.log2(40075016686e-3 * Math.cos(mid.lat * Math.PI / 180) / (512 * (far * 2.4 / (W * 0.8)))), 11, 14.3) };
            }
            c = { center: sh._p.center, bearing: sh._p.b + lerp(-4, 4, u), pitch: 62, zoom: sh._p.z + 0.3 * e };
            break;
          }
          case "start":
            c = { center: cpos, bearing: sh.b0 + 160 - 110 * e, pitch: 52 + 8 * e, zoom: 15.3 - 0.7 * e };
            break;
          case "transit": {
            const h = videoHeadingAt(track, ft, 25);
            c = { center: cpos, bearing: h == null ? sh.b0 || 0 : h, pitch: 58, zoom: 12.6 };
            break;
          }
          case "thermal":
            c = { center: sh.center, bearing: sh.b0 + 170 * u, pitch: 56, zoom: 14.7 };
            break;
          case "peak": {
            const h = videoHeadingAt(track, ft, 10);
            c = { center: cpos, bearing: (h == null ? sh.b0 : h) + 80 + 25 * e, pitch: 60, zoom: 13.9 };
            break;
          }
          case "ridge":
            c = { center: cpos, bearing: sh.bSide + 12 * Math.sin(u * Math.PI), pitch: 50, zoom: 14.3 };
            break;
          case "summit":
            c = { center: cpos, bearing: (sh.heading || 0) + 180 - 70 * e, pitch: 60, zoom: 14.6 };
            break;
          case "crossing":
            c = { center: cpos, bearing: sh.bSide, pitch: 55, zoom: 13.5 };
            break;
          case "spiral":
          case "wingover":
            c = { center: sh.center, bearing: sh.b0 + 170 * u, pitch: 58, zoom: 14.5 };
            break;
          case "glide": {
            const h = videoHeadingAt(track, ft, 15);
            c = { center: cpos, bearing: (h == null ? sh.b0 : h) - 50, pitch: 58, zoom: 14 };
            break;
          }
          case "land": {
            const a0 = videoPosAt(track, sh.f0), a1 = videoPosAt(track, sh.f1);
            const far = (haversineDistKm(a0, a1) || 0) > 0.04;
            const brg = far ? bearingDeg(a0, a1) : sh.b0 || 0;
            c = { center: [lerp(a0.lon, a1.lon, e), lerp(a0.lat, a1.lat, e)], bearing: brg + 20 + 50 * e, pitch: 62 - 8 * e, zoom: 14.3 + 1.4 * e };
            break;
          }
          default: {
            const a = cameraFor(sh.prev, 1, pos);
            const ov = { center: [overview.center.lng ?? overview.center[0], overview.center.lat ?? overview.center[1]], zoom: overview.zoom - 0.15, bearing: 0, pitch: 35 };
            return {
              center: [lerp(a.center[0], ov.center[0], e), lerp(a.center[1], ov.center[1], e)],
              zoom: lerp(a.zoom, ov.zoom, e),
              bearing: a.bearing + wrapDelta(a.bearing, ov.bearing) * e,
              pitch: lerp(a.pitch, ov.pitch, e)
            };
          }
        }
        if (sh.speed && sh.kind !== "mseg") c = { ...c, zoom: c.zoom - clamp(0.35 * Math.log2(Math.max(1, sh.speed / 6)), 0, 1.4) };
        if (sh.zoomAdd) c = { ...c, zoom: c.zoom + sh.zoomAdd };
        return c;
      };
      const stateAt = (t) => {
        let si = shots.findIndex((s) => t < s.t1);
        if (si < 0) si = shots.length - 1;
        const sh = shots[si];
        const u = clamp((t - sh.t0) / Math.max(1e-6, sh.d), 0, 1);
        const ft = lerp(sh.f0, sh.f1, u + (sh.warp || 0) * Math.sin(2 * Math.PI * u) / (2 * Math.PI));
        const pos = videoPosAt(track, ft);
        let cam = cameraFor(sh, u, pos);
        if (sh.near && si > 0 && t - sh.t0 < 1.2) {
          const pv = shots[si - 1], a = cameraFor(pv, 1, videoPosAt(track, pv.f1));
          const fr = (t - sh.t0) / 1.2, ee = fr * fr * (3 - 2 * fr);
          cam = {
            center: [lerp(a.center[0], cam.center[0], ee), lerp(a.center[1], cam.center[1], ee)],
            zoom: lerp(a.zoom, cam.zoom, ee),
            bearing: a.bearing + wrapDelta(a.bearing, cam.bearing) * ee,
            pitch: lerp(a.pitch, cam.pitch, ee)
          };
        }
        let fade = 0;
        [[0, 0.5], [D, 0.5]].forEach(([bt, w]) => {
          fade = Math.max(fade, 1 - Math.abs(t - bt) / w);
        });
        return { sh, u, ft, pos, cam, fade: clamp(fade, 0, 1) };
      };
      const mercPerPx = (lat, zoom) => 40075016686e-3 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, zoom));
      let curLift = 0, curState = null, snap = null;
      const demElev = dem && dem.elev;
      const groundAt = (lon, lat) => {
        let g = demElev ? demElev(lat, lon) : null;
        if (g == null || !isFinite(g)) g = main.queryTerrainElevation ? main.queryTerrainElevation([lon, lat]) : null;
        return g != null && isFinite(g) ? g : null;
      };
      const SM = {};
      const smooth = (name, target, t, sh, tauDown, tauUp) => {
        const s = SM[name];
        if (!s || s.sh !== sh || Math.abs(t - s.t) > 1.5) {
          SM[name] = { v: target, t, sh };
          return target;
        }
        const tau = target < s.v ? tauDown : tauUp;
        s.v += (target - s.v) * Math.min(1, Math.abs(t - s.t) / tau);
        s.t = t;
        return s.v;
      };
      const smoothAngle = (name, target, t, sh, tau, maxRate) => {
        const s = SM[name];
        if (!s || s.sh !== sh || Math.abs(t - s.t) > 1.5) {
          SM[name] = { v: target, t, sh };
          return target;
        }
        const dt = Math.abs(t - s.t);
        const m = maxRate * dt;
        const d = clamp(wrapDelta(s.v, target) * Math.min(1, dt / tau), -m, m);
        s.v = ((s.v + d) % 360 + 360) % 360;
        s.t = t;
        return s.v;
      };
      const isOrbit = (sh) => sh.kind === "thermal" || sh.kind === "spiral" || sh.kind === "wingover" || sh.kind === "mseg" && !!sh.plan && sh.plan.mode === "orbit";
      const clearPitch = (cam, zoom, pos) => {
        const dist = 1.5 * H * mercPerPx(pos.lat, zoom);
        const cg = groundAt(cam.center[0], cam.center[1]) ?? lastGround;
        const pg = groundAt(pos.lon, pos.lat);
        const nearGround = pg != null && pos.gpsAlt - pg < 150;
        const maxS = nearGround ? 6 : 9;
        const mLat = 111320, mLon = 111320 * Math.cos(pos.lat * Math.PI / 180);
        let pitch = cam.pitch;
        for (let it = 0; it < 8 && pitch > 20; it++) {
          const pr = pitch * Math.PI / 180, br = cam.bearing * Math.PI / 180;
          const hz = dist * Math.sin(pr);
          const cLat = cam.center[1] - Math.cos(br) * hz / mLat, cLon = cam.center[0] - Math.sin(br) * hz / mLon;
          const cAlt = cg + dist * Math.cos(pr);
          let ok = true;
          for (let s = 1; s <= maxS && ok; s++) {
            const fr = s / 10;
            const g = groundAt(lerp(cLon, pos.lon, fr), lerp(cLat, pos.lat, fr));
            if (g != null && g > lerp(cAlt, pos.gpsAlt, fr) - 12) ok = false;
          }
          if (ok) break;
          pitch -= 7;
        }
        return pitch;
      };
      const orbitPitch = (sh) => {
        if (sh._pitch != null) return sh._pitch;
        let p = 90;
        for (const uu of [0, 0.34, 0.67, 1]) {
          const ps = videoPosAt(track, lerp(sh.f0, sh.f1, uu)), cm = cameraFor(sh, uu, ps);
          p = Math.min(p, clearPitch(cm, cm.zoom - 0.5, ps));
        }
        return sh._pitch = Math.max(35, p);
      };
      const applyState = (t, force) => {
        const st = stateAt(t), sh = st.sh;
        const outro = sh.kind === "outro", land = sh.kind === "land", orbit = isOrbit(sh), fixedPoi = sh.kind === "poi";
        const gPilot = groundAt(st.pos.lon, st.pos.lat);
        if (gPilot != null) lastGround = gPilot;
        const hRaw = Math.max(0, st.pos.gpsAlt - lastGround);
        let hCam;
        if (orbit) {
          const gc = groundAt(st.cam.center[0], st.cam.center[1]);
          hCam = smooth("h", Math.max(0, st.pos.gpsAlt - (gc ?? lastGround)), t, sh, 6, 6);
        } else hCam = smooth("h", hRaw, t, sh, 3, 3);
        let zoom = outro || land || fixedPoi ? st.cam.zoom : st.cam.zoom - clamp(Math.log2(1 + hCam / 450), 0, 1.2);
        if (!outro) zoom = smooth("zoom", zoom, t, sh, 1.2, 1.2);
        let pitch = st.cam.pitch;
        if (!outro && !land && !fixedPoi) {
          const target = orbit ? Math.min(st.cam.pitch, orbitPitch(sh)) : clearPitch(st.cam, zoom, st.pos);
          pitch = smooth("pitch", target, t, sh, 0.8, 3);
        }
        const mpp = mercPerPx(st.pos.lat, zoom), sinP = Math.sin(pitch * Math.PI / 180);
        const liftPx = outro ? 0 : hRaw / mpp * sinP;
        const pad = outro || land ? 0 : smooth("pad", Math.min(hCam / mpp * sinP, H * (pitch > 50 ? 0.12 : 0.22)), t, sh, 2, 2);
        const bearing = orbit || land || outro || fixedPoi ? st.cam.bearing : smoothAngle("bearing", st.cam.bearing, t, sh, 2.5, 15);
        main.jumpTo({ center: st.cam.center, zoom, bearing, pitch, padding: { top: 2 * pad, bottom: 0, left: 0, right: 0 } });
        altLayer.setProgress(st.pos.idx);
        curLift = liftPx;
        curState = { ...st, t, zoom, cam: { ...st.cam, bearing, pitch } };
        return st;
      };
      const out = outRef.current;
      out.width = W;
      out.height = H;
      const ctx = out.getContext("2d");
      const rr = (x, y, w, h, r) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      };
      const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      const txt = (s, x, y, size, weight, color, align) => {
        ctx.font = `${weight} ${size}px ${FONT}`;
        ctx.textAlign = align || "left";
        ctx.textBaseline = "alphabetic";
        ctx.shadowColor = "rgba(0,0,0,0.75)";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = color;
        ctx.fillText(s, x, y);
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
      };
      const snaps = /* @__PURE__ */ new Map();
      const DISSOLVE = 1;
      const draw = (t) => {
        if (!snap) return;
        const st = snap.st, curLift2 = snap.lift;
        ctx.drawImage(frameCopy, 0, 0, W, H);
        const s = portrait ? 0.8 : square ? 0.9 : 1;
        if (st.sh.kind !== "outro" || st.u < 0.6) {
          const g = { x: snap.gx, y: snap.gy };
          const py = g.y - curLift2, px = g.x;
          if (px > -50 && px < W + 50 && py > -50 && py < H + 50) {
            if (curLift2 > 6) {
              ctx.strokeStyle = "rgba(255,255,255,0.55)";
              ctx.setLineDash([4, 5]);
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(px, py);
              ctx.lineTo(g.x, g.y);
              ctx.stroke();
              ctx.setLineDash([]);
            }
            const hd = videoHeadingAt(track, st.ft, 6);
            ctx.save();
            ctx.translate(px, py);
            ctx.shadowColor = "rgba(0,0,0,0.6)";
            ctx.shadowBlur = 10;
            if (gliderImg) {
              const gw = 104 * s, gh = gw * gliderImg.naturalHeight / gliderImg.naturalWidth;
              ctx.scale(1, 0.55 + 0.45 * Math.cos(st.cam.pitch * Math.PI / 180));
              if (hd != null) ctx.rotate((hd - st.cam.bearing) * Math.PI / 180);
              ctx.drawImage(gliderImg, -gw / 2, -gh / 2, gw, gh);
            } else if (hd != null) {
              ctx.rotate((hd - st.cam.bearing) * Math.PI / 180);
              ctx.fillStyle = "#fff";
              ctx.beginPath();
              ctx.moveTo(0, -17 * s);
              ctx.lineTo(11 * s, 11 * s);
              ctx.lineTo(0, 5 * s);
              ctx.lineTo(-11 * s, 11 * s);
              ctx.closePath();
              ctx.fill();
              ctx.fillStyle = "#ef4444";
              ctx.beginPath();
              ctx.moveTo(0, -12 * s);
              ctx.lineTo(7 * s, 8 * s);
              ctx.lineTo(0, 3 * s);
              ctx.lineTo(-7 * s, 8 * s);
              ctx.closePath();
              ctx.fill();
            } else {
              ctx.fillStyle = "#ef4444";
              ctx.strokeStyle = "#fff";
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.arc(0, 0, 8 * s, 0, 7);
              ctx.fill();
              ctx.stroke();
            }
            ctx.restore();
          }
        }
        if (st.sh.poi && snap.pp && snap.pp.x > -40 && snap.pp.x < W + 40 && snap.pp.y > 0 && snap.pp.y < H + 40) {
          const k2 = clamp((t - st.sh.t0 - 0.3) / 0.45, 0, 1), e1 = 1 - Math.pow(1 - k2, 3);
          if (e1 > 0) {
            ctx.save();
            ctx.translate(snap.pp.x, snap.pp.y);
            ctx.scale(e1 * 1.15, e1 * 1.15);
            ctx.shadowColor = "rgba(0,0,0,0.5)";
            ctx.shadowBlur = 8;
            ctx.fillStyle = "#dc2626";
            ctx.beginPath();
            ctx.arc(0, -17 * s, 11 * s, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(-9 * s, -10 * s);
            ctx.lineTo(0, 0);
            ctx.lineTo(9 * s, -10 * s);
            ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(0, -17 * s, 4.5 * s, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            if (st.sh.poiName) {
              ctx.globalAlpha = e1;
              txt(st.sh.poiName, snap.pp.x, snap.pp.y - 52 * s, 26 * s, 700, "#fff", "center");
              ctx.globalAlpha = 1;
            }
          }
        }
        const mg = 22 * s;
        if (st.sh.label) {
          const a = clamp(Math.min((t - st.sh.t0) / 0.5, (st.sh.t1 - t) / 0.5, 1), 0, 1);
          ctx.globalAlpha = a;
          ctx.font = `800 ${28 * s}px ${FONT}`;
          const w = ctx.measureText(st.sh.label).width + 36 * s;
          ctx.fillStyle = "rgba(4,14,32,0.62)";
          rr(mg, mg, w, 52 * s, 14 * s);
          ctx.fill();
          txt(st.sh.label, mg + 18 * s, mg + 36 * s, 28 * s, 800, "#fff");
          ctx.globalAlpha = 1;
        }
        if (t < 3.2) {
          const a = clamp(Math.min(t / 0.5, (3.2 - t) / 0.7, 1), 0, 1);
          ctx.globalAlpha = a;
          txt(flight?.date || "", W / 2, H * 0.2 + 52 * s, 30 * s, 600, "rgba(255,255,255,0.9)", "center");
          if (flight?.glider) txt(flight.glider, W / 2, H * 0.2 + 90 * s, 24 * s, 500, "rgba(255,255,255,0.8)", "center");
          ctx.globalAlpha = 1;
        }
        const pA = videoPosAt(track, st.ft - 3), pB = videoPosAt(track, st.ft + 3);
        const dtw = Math.max(1, pB.timeSec - pA.timeSec);
        const kmh = (haversineDistKm(pA, pB) || 0) / (dtw / 3600), vario = (pB.gpsAlt - pA.gpsAlt) / dtw;
        const bx = mg, bw = 230 * s, bh = 112 * s, by = H - mg - bh - 8 * s;
        ctx.fillStyle = "rgba(4,14,32,0.62)";
        rr(bx, by, bw, bh, 14 * s);
        ctx.fill();
        txt(`${Math.round(st.pos.gpsAlt).toLocaleString("de-CH")} m`, bx + 16 * s, by + 38 * s, 30 * s, 800, "#fff");
        txt(`${Math.round(kmh)} km/h`, bx + 16 * s, by + 70 * s, 22 * s, 600, "#bfdbfe");
        txt(`${vario >= 0 ? "+" : "−"}${Math.abs(vario).toFixed(1)} m/s`, bx + 16 * s, by + 100 * s, 22 * s, 700, vario >= 0.3 ? "#4ade80" : vario <= -2 ? "#f87171" : "#e5e7eb");
        const fr = clamp((st.ft - t0) / (t1 - t0), 0, 1);
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.fillRect(0, H - 6, W, 6);
        ctx.fillStyle = "#f97316";
        ctx.fillRect(0, H - 6, W * fr, 6);
        const mx = W - mg - M, my = H - mg - M - 8 * s;
        ctx.save();
        rr(mx, my, M, M, 16 * s);
        ctx.clip();
        ctx.drawImage(miniBase, mx, my, M, M);
        ctx.translate(mx, my);
        let kk = 0;
        while (kk < dec.length && track[dec[kk]].timeSec <= st.ft) kk++;
        const cur = miniPx(st.pos.lon, st.pos.lat);
        const flownPx = decPx.slice(0, Math.max(1, kk));
        flownPx.push(cur);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        trace(ctx, flownPx, flownPx.length);
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 3.6;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cur[0], cur[1], 7, 0, 7);
        ctx.fillStyle = "#ef4444";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        rr(mx, my, M, M, 16 * s);
        ctx.stroke();
        txt("N ↑", mx + M - 10, my + 22, 16, 800, "#1e3a8a", "right");
        txt("© MapTiler © OpenStreetMap contributors", W - 8, H - 12, 11, 500, "rgba(255,255,255,0.75)", "right");
        const si = shots.indexOf(st.sh);
        if (st.sh.kind !== "outro" && t > st.sh.t1 - 0.3) {
          let sc = snaps.get(si);
          if (!sc) {
            sc = document.createElement("canvas");
            sc.width = W;
            sc.height = H;
            snaps.set(si, sc);
          }
          sc.getContext("2d").drawImage(out, 0, 0);
        }
        for (const k2 of [...snaps.keys()]) if (k2 < si - 1) snaps.delete(k2);
        if (si > 0 && st.sh.kind !== "outro" && t - st.sh.t0 < DISSOLVE) {
          const ps = snaps.get(si - 1);
          if (ps) {
            const fr2 = clamp((t - st.sh.t0) / DISSOLVE, 0, 1);
            ctx.globalAlpha = 1 - fr2 * fr2 * (3 - 2 * fr2);
            ctx.drawImage(ps, 0, 0);
            ctx.globalAlpha = 1;
          }
        }
        if (st.fade > 0) {
          ctx.fillStyle = `rgba(0,0,0,${st.fade})`;
          ctx.fillRect(0, 0, W, H);
        }
      };
      const frameCopy = document.createElement("canvas");
      frameCopy.width = W;
      frameCopy.height = H;
      const fctx = frameCopy.getContext("2d");
      const tmpC = document.createElement("canvas");
      tmpC.width = W;
      tmpC.height = H;
      const tctx = tmpC.getContext("2d", { willReadFrequently: true });
      const PROBES = [[0.1, 0.1], [0.5, 0.1], [0.9, 0.1], [0.1, 0.5], [0.5, 0.5], [0.9, 0.5], [0.1, 0.9], [0.5, 0.9], [0.9, 0.9]];
      let renderN = 0;
      main.on("render", () => {
        try {
          const probe = !curState || curState.t - curState.sh.t0 < 1.5 || ++renderN % 15 === 0;
          if (probe) {
            tctx.drawImage(main.getCanvas(), 0, 0, W, H);
            let dark = 0;
            for (const [fx, fy] of PROBES) {
              const d = tctx.getImageData(Math.floor(fx * (W - 1)), Math.floor(fy * (H - 1)), 1, 1).data;
              if (d[3] === 0 || d[0] + d[1] + d[2] < 12) dark++;
            }
            if (dark < 8) fctx.drawImage(tmpC, 0, 0);
          } else fctx.drawImage(main.getCanvas(), 0, 0, W, H);
        } catch {
        }
        if (!curState) return;
        const g = main.project([curState.pos.lon, curState.pos.lat]);
        const pp = curState.sh.poi ? main.project([curState.sh.poi.lon, curState.sh.poi.lat]) : null;
        snap = { st: curState, lift: curLift, gx: g.x, gy: g.y, pp };
      });
      const warm = async (t) => {
        applyState(t, true);
        await waitIdle(main, 3e3);
        draw(t);
      };
      const warmTimes = [0];
      {
        let lastP = stateAt(0).pos, lastT = 0;
        for (let t = 0.05; t < D; t += 0.05) {
          const p = stateAt(t).pos;
          if ((haversineDistKm(lastP, p) || 0) >= 0.7 || t - lastT >= 0.8) {
            warmTimes.push(t);
            lastP = p;
            lastT = t;
          }
        }
        warmTimes.push(D - 0.01);
        shots.forEach((s) => {
          for (const dt of [0.02, 0.4, 0.9]) if (s.t0 + dt < D) warmTimes.push(s.t0 + dt);
          if (s.t1 - 0.05 > 0) warmTimes.push(s.t1 - 0.05);
        });
        warmTimes.sort((a, b) => a - b);
      }
      for (let i = 0; i < warmTimes.length; i++) {
        if (cancelled) return;
        await warm(warmTimes[i]);
        setStatus("Karten werden vorgeladen …", Math.round(i / (warmTimes.length - 1) * 100));
      }
      try {
        if (navigator.wakeLock) wake = await navigator.wakeLock.request("screen");
      } catch {
      }
      const FPS = 30, BITRATE = videoBitrateFor(D, purpose);
      const wcCfg = await pickWebCodecsConfig(W, H, FPS, BITRATE);
      let mix = null, audioNote = "";
      if (music && music.file) {
        setStatus("Musik wird vorbereitet …", 0);
        mix = await prepareVideoAudio(music.file, music.start, D);
        if (cancelled) return;
      }
      const audioCfg = mix && wcCfg ? await pickAudioConfig() : null;
      if (mix && wcCfg && !audioCfg) {
        audioNote = "Dieser Browser kann den Ton nicht in die Videodatei kodieren – das Video wurde ohne Musik erstellt.";
        mix = null;
      }
      if (wcCfg) {
        console.info("Flug-Video: WebCodecs " + wcCfg.codec + ", " + FPS + " fps");
        let timeouts = 0;
        const renderSettled = () => new Promise((res) => {
          let done = false;
          const fin = () => {
            if (done) return;
            done = true;
            clearTimeout(to);
            main.off("render", onr);
            res();
          };
          const onr = () => {
            if (main.areTilesLoaded()) {
              timeouts = 0;
              fin();
            }
          };
          const to = setTimeout(() => {
            timeouts++;
            fin();
          }, timeouts > 3 ? 200 : 2500);
          main.on("render", onr);
          main.triggerRepaint();
        });
        const frames = Math.round(D * FPS);
        let lastPct = -1;
        const blob2 = await encodeVideoWebCodecs({
          canvas: out,
          W,
          H,
          fps: FPS,
          frames,
          bitrate: BITRATE,
          cfg: wcCfg,
          isCancelled: () => cancelled,
          audio: mix && audioCfg ? { mix, cfg: audioCfg } : null,
          renderFrame: async (k2) => {
            const t = Math.min(D - 1e-3, k2 / FPS);
            applyState(t, false);
            await renderSettled();
            draw(t);
          },
          onProgress: (k2, n2) => {
            const p = Math.round(k2 / n2 * 100);
            if (p !== lastPct) {
              lastPct = p;
              setStatus("Video wird Bild für Bild berechnet (feste 30 fps) – App bitte geöffnet lassen …", p);
            }
          }
        });
        if (cancelled || !blob2) return;
        onDone(blob2, "mp4", audioNote);
        return;
      }
      console.info("Flug-Video: WebCodecs nicht verfügbar – Aufnahme in Echtzeit (MediaRecorder)");
      const mime = pickVideoMime();
      if (!mime) throw new Error("Dieser Browser kann keine Videos aufnehmen (MediaRecorder fehlt).");
      const stream = out.captureStream(30);
      let actx = null, asrc = null;
      if (mix) {
        try {
          actx = new (window.AudioContext || window.webkitAudioContext)();
          if (actx.state === "suspended") await actx.resume();
          const dest = actx.createMediaStreamDestination();
          asrc = actx.createBufferSource();
          asrc.buffer = mix.buffer;
          asrc.connect(dest);
          dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
        } catch (e) {
          console.warn("Flug-Video: Musik im Echtzeit-Modus nicht möglich", e);
          actx = asrc = null;
          audioNote = "Die Musik konnte in diesem Browser nicht eingebunden werden.";
        }
      }
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
      const chunks = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      const stopped = new Promise((r) => {
        rec.onstop = r;
      });
      await warm(0);
      rec.start(1e3);
      if (asrc) asrc.start();
      const startMs = performance.now();
      let lastRtPct = -1;
      for (; ; ) {
        if (cancelled) {
          try {
            rec.stop();
          } catch {
          }
          try {
            if (actx) actx.close();
          } catch {
          }
          return;
        }
        const t = (performance.now() - startMs) / 1e3;
        if (t >= D) break;
        applyState(t, false);
        draw(t);
        const pctNow = Math.round(t / D * 100);
        if (pctNow !== lastRtPct) {
          lastRtPct = pctNow;
          setStatus("Video wird aufgenommen – Bildschirm bitte eingeschaltet lassen …", pctNow);
        }
        await nextFrame();
      }
      applyState(D - 0.01, true);
      await nextFrame();
      await nextFrame();
      draw(D - 0.01);
      rec.stop();
      await stopped;
      try {
        if (actx) actx.close();
      } catch {
      }
      if (cancelled) return;
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      onDone(blob, mime.startsWith("video/mp4") ? "mp4" : "webm", audioNote);
    };
    run().catch((e) => {
      if (!cancelled) {
        console.error("Flug-Video:", e);
        onError(e && e.message ? e.message : String(e));
      }
    });
    return () => {
      cancelled = true;
      try {
        if (rec && rec.state !== "inactive") rec.stop();
      } catch {
      }
      try {
        if (wake) wake.release();
      } catch {
      }
      try {
        main && main.remove();
      } catch {
      }
      try {
        mini && mini.remove();
      } catch {
      }
    };
  }, []);
  return /* @__PURE__ */ React.createElement(React.Fragment, null, ReactDOM.createPortal(
    /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", left: 0, top: 0, width: W, height: H, zIndex: 1, pointerEvents: "none" }, ref: mainDivRef }), /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", left: 0, top: 0, width: M, height: M, zIndex: 1, pointerEvents: "none" }, ref: miniDivRef })),
    document.body
  ), /* @__PURE__ */ React.createElement("canvas", { ref: outRef, style: { width: "100%", maxWidth: portrait ? 340 : square ? 480 : 760, maxHeight: "62vh", aspectRatio: `${W}/${H}`, borderRadius: 12, background: "#000", display: "block", margin: "0 auto" } }));
}
const SEASON_MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const SEASON_ACCENT = "#a3e635";
const RUECKBLICK_DIR = "Rückblick";
const FLUEGE_DIR = "Flüge";
const seasonDay = (ts) => {
  const d = new Date(ts);
  return d.getDate() + ". " + SEASON_MONTHS[d.getMonth()];
};
const seasonDMY = (ts) => {
  const d = new Date(ts);
  return d.getDate() + "." + (d.getMonth() + 1) + "." + d.getFullYear();
};
const seasonLong = (ts) => {
  const d = new Date(ts);
  return d.getDate() + ". " + SEASON_MONTHS[d.getMonth()] + " " + d.getFullYear();
};
const seasonHM = (sec) => {
  const m = Math.round(sec / 60);
  return Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min";
};
const seasonInt = (n) => Math.round(n).toLocaleString("de-CH");
const seasonMMSS = (sec) => Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2, "0");
function seasonCleanTrack(track) {
  if (!track || track.length < 30) return null;
  const med = (a) => {
    const s = a.slice().sort((x, y) => x - y);
    return s[s.length >> 1];
  };
  const mLat = med(track.map((p) => p.lat)), mLon = med(track.map((p) => p.lon));
  const tr = track.filter((p) => p && isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat - mLat) <= 0.5 && Math.abs(p.lon - mLon) <= 0.5);
  return tr.length >= 30 ? tr : null;
}
function computeThermalBest(track) {
  const tr = seasonCleanTrack(track);
  if (!tr) return null;
  const tow = findTowRun(tr), towEnd = tow ? tr[tow.endIdx].timeSec : -1;
  let strong = null, long = null;
  for (const c of seasonThermals(tr)) {
    if (tr[c.i0].timeSec <= towEnd) continue;
    if (c.gain >= 150 && (!long || c.gain > long.gain)) long = { t0: tr[c.i0].timeSec, t1: tr[c.i1].timeSec, gain: Math.round(c.gain), secs: c.secs, avg: +c.avg.toFixed(2) };
    const W = Math.min(c.secs, 90);
    for (let i = c.i0, j = c.i0; i <= c.i1; i++) {
      while (j < c.i1 && tr[j].timeSec - tr[i].timeSec < W) j++;
      const dt = tr[j].timeSec - tr[i].timeSec, g = tr[j].gpsAlt - tr[i].gpsAlt;
      if (dt < Math.min(40, W) || g < 80) continue;
      if (!strong || g / dt > strong.avg) strong = { t0: tr[i].timeSec, t1: tr[j].timeSec, gain: Math.round(g), secs: dt, avg: +(g / dt).toFixed(2) };
    }
  }
  return { v: 2, strong, long };
}
function seasonThermals(tr) {
  const n = tr.length, turn = headingTurns(tr);
  const circ = new Array(n).fill(false);
  let j = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    sum += turn[i];
    while (tr[i].timeSec - tr[j].timeSec > 30) {
      sum -= turn[j];
      j++;
    }
    if (sum >= 270) circ[i] = true;
  }
  const segs = [];
  for (let i = 0; i < n; ) {
    if (!circ[i]) {
      i++;
      continue;
    }
    let e = i, k2 = i;
    while (k2 < n) {
      if (circ[k2]) {
        e = k2;
        k2++;
      } else if (tr[k2].timeSec - tr[e].timeSec <= 12) k2++;
      else break;
    }
    let s = i;
    i = e + 1;
    const rate = (q) => tr[q].timeSec - tr[q - 1].timeSec > 0 ? turn[q] / (tr[q].timeSec - tr[q - 1].timeSec) : 0;
    while (s > 1 && rate(s - 1) >= 4 && tr[s].timeSec - tr[s - 1].timeSec <= 10) s--;
    while (e < n - 1 && rate(e + 1) >= 4 && tr[e + 1].timeSec - tr[e].timeSec <= 10) e++;
    let tot = 0;
    for (let q = s; q <= e; q++) tot += turn[q];
    const secs = tr[e].timeSec - tr[s].timeSec, gain = tr[e].gpsAlt - tr[s].gpsAlt;
    if (tot >= 540 && secs >= 30 && gain >= 60 && gain / secs >= 0.4) segs.push({ i0: s, i1: e, gain, secs, avg: gain / secs });
  }
  return segs;
}
function buildSeasonStats(flights, fromTs, toTs, reise) {
  const before = /* @__PURE__ */ new Set(), rows = [];
  for (const f of flights) {
    const ts = parseDateToTs(f.date || f.rawDate);
    if (!ts) continue;
    const site = (f.site || "").trim();
    if (ts < fromTs) {
      if (site) before.add(site.toLowerCase());
      continue;
    }
    if (ts > toTs) continue;
    if (reise && ((f.customFields || {}).reise || "").trim() !== reise) continue;
    const tr = f.track && f.track.length ? f.track : null;
    const p0 = f.startPt || tr && tr[0] || null;
    rows.push({
      f,
      ts,
      site,
      country: ((f.customFields || {}).land || "").trim(),
      sec: f.durationSec || parseDurToSec(f.durationStr) || 0,
      dist: f.scoreDistanceKm || f.totalDist || 0,
      alt: f.maxAlt || 0,
      pt: p0 && isFinite(p0.lat) && isFinite(p0.lon) ? { lat: p0.lat, lon: p0.lon } : null
    });
  }
  const topSites = (rs) => {
    const m = /* @__PURE__ */ new Map();
    for (const r of rs) {
      if (!r.site) continue;
      const k2 = r.site.toLowerCase();
      const g = m.get(k2) || { name: r.site, n: 0 };
      g.n++;
      m.set(k2, g);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "de")).slice(0, 3);
  };
  const pinsOf = (rs) => {
    const m = /* @__PURE__ */ new Map();
    for (const r of rs) {
      if (!r.pt) continue;
      const k2 = r.site ? r.site.toLowerCase() : r.pt.lat.toFixed(2) + "," + r.pt.lon.toFixed(2);
      const g = m.get(k2) || { lat: 0, lon: 0, n: 0 };
      g.lat += r.pt.lat;
      g.lon += r.pt.lon;
      g.n++;
      m.set(k2, g);
    }
    return [...m.values()].map((g) => ({ lat: g.lat / g.n, lon: g.lon / g.n, n: g.n }));
  };
  const playOf = (r) => {
    const tr = r.f.track;
    let path = null;
    if (tr && tr.length >= 10) {
      const step = Math.max(1, Math.floor(tr.length / 36));
      path = [];
      for (let i = 0; i < tr.length; i += step) if (isFinite(tr[i].lat) && isFinite(tr[i].lon)) path.push([tr[i].lon, tr[i].lat]);
      const e = tr[tr.length - 1];
      if (isFinite(e.lat) && isFinite(e.lon)) path.push([e.lon, e.lat]);
      if (path.length >= 3) {
        const [l0, a0] = path[0];
        path = path.filter((q) => Math.abs(q[0] - l0) < 2 && Math.abs(q[1] - a0) < 2);
      }
      if (path.length < 3) path = null;
    }
    return { ts: r.ts, sec: r.sec, path };
  };
  const playsOf = (rs) => rs.slice().sort((a, b) => a.ts - b.ts).map(playOf);
  const kmBetween = (a, b) => {
    const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
    const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  };
  const cnt = /* @__PURE__ */ new Map();
  for (const r of rows) if (r.country) {
    const k2 = r.country.toLowerCase();
    cnt.set(k2, (cnt.get(k2) || 0) + 1);
  }
  const homeKey = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
  let homeRows = rows, rest = [];
  if (homeKey) {
    const hp = rows.filter((r) => r.country.toLowerCase() === homeKey[0] && r.pt);
    let center = null, bestN = -1;
    for (const r of hp) {
      const n = hp.filter((q) => kmBetween(r.pt, q.pt) <= 300).length;
      if (n > bestN) {
        bestN = n;
        center = r.pt;
      }
    }
    if (center) {
      const near = hp.filter((q) => kmBetween(center, q.pt) <= 300);
      center = { lat: near.reduce((a, q) => a + q.pt.lat, 0) / near.length, lon: near.reduce((a, q) => a + q.pt.lon, 0) / near.length };
    }
    const inHome = (r) => r.pt && center ? kmBetween(center, r.pt) <= 300 : r.country.toLowerCase() === homeKey[0];
    homeRows = rows.filter(inHome);
    rest = rows.filter((r) => !inHome(r) && r.country);
  }
  homeRows.forEach((r) => {
    r.reg = "home";
  });
  rest.forEach((r) => {
    r.reg = r.country.toLowerCase();
  });
  const groupOf = (rs) => {
    const m = /* @__PURE__ */ new Map();
    for (const r of rs) {
      if (!r.country) continue;
      const k2 = r.country.toLowerCase();
      const g = m.get(k2) || { name: r.country, n: 0 };
      g.n++;
      m.set(k2, g);
    }
    return [...m.values()].sort((a, b) => b.n - a.n).map((g) => g.name);
  };
  const home = homeRows.length ? { countries: groupOf(homeRows), n: homeRows.length, sec: homeRows.reduce((a, r) => a + r.sec, 0), sites: topSites(homeRows), pins: pinsOf(homeRows), plays: playsOf(homeRows) } : null;
  const cm = /* @__PURE__ */ new Map();
  for (const r of rest) {
    const k2 = r.country.toLowerCase();
    const g = cm.get(k2) || { name: r.country, n: 0, sec: 0 };
    g.n++;
    g.sec += r.sec;
    cm.set(k2, g);
  }
  const countries = [...cm.values()].sort((a, b) => b.n - a.n).map((g) => {
    const rs = rest.filter((r) => r.country.toLowerCase() === g.name.toLowerCase());
    return { ...g, sites: topSites(rs), pins: pinsOf(rs), plays: playsOf(rs) };
  });
  const countriesN = new Set(rows.filter((r) => r.country).map((r) => r.country.toLowerCase())).size;
  const events = [];
  {
    const seen = /* @__PURE__ */ new Set();
    for (const r of rows.slice().sort((a, b) => a.ts - b.ts)) {
      if (!r.pt || !r.site) continue;
      const k2 = r.site.toLowerCase();
      if (seen.has(k2)) continue;
      seen.add(k2);
      events.push({ name: r.site, ts: r.ts, lat: r.pt.lat, lon: r.pt.lon });
    }
  }
  const siteSet = new Set(rows.filter((r) => r.site).map((r) => r.site.toLowerCase()));
  const withTrack = rows.map((r) => ({ r, track: seasonCleanTrack(r.f.track) })).filter((x) => x.track);
  const hl = [];
  const bestOf = (arr, key) => arr.reduce((b, x) => !b || key(x) > key(b) ? x : b, null);
  const whole = (x) => x && hl.find((h) => h.r.f.id === x.r.f.id && !h.excerpt);
  const addWhole = (x, tag) => {
    if (!x) return;
    const h = whole(x);
    if (h) {
      if (!h.tags.includes(tag)) h.tags.push(tag);
    } else hl.push({ ...x, tags: [tag] });
  };
  const peakWindow = (tr) => {
    let pi = 0, pv = -1e9;
    for (let i = 4; i < tr.length - 4; i++) {
      let s = 0;
      for (let k2 = -4; k2 <= 4; k2++) s += tr[i + k2].gpsAlt;
      if (s / 9 > pv) {
        pv = s / 9;
        pi = i;
      }
    }
    let i0 = pi, i1 = pi;
    while (i0 > 0 && tr[pi].timeSec - tr[i0 - 1].timeSec <= 150) i0--;
    while (i1 < tr.length - 1 && tr[i1 + 1].timeSec - tr[pi].timeSec <= 150) i1++;
    return { i0, i1, alt: pv };
  };
  const firsts = before.size ? withTrack.filter((x) => x.r.site && !before.has(x.r.site.toLowerCase())).sort((a, b) => (b.r.dist || b.r.sec / 3600) - (a.r.dist || a.r.sec / 3600)) : [];
  const firstsFree = () => firsts.filter((x) => !hl.some((h) => h.r.f.id === x.r.f.id));
  addWhole(bestOf(withTrack.filter((x) => x.r.dist >= 3), (x) => x.r.dist), "WEITESTER FLUG");
  addWhole(bestOf(withTrack, (x) => x.r.sec), "LÄNGSTER FLUG");
  const first1 = firstsFree()[0];
  addWhole(first1, "ZUM ERSTEN MAL HIER");
  const high = bestOf(withTrack, (x) => x.r.alt);
  if (high) {
    const parent = whole(high);
    if (parent) hl.splice(hl.indexOf(parent) + 1, 0, { ...high, tags: ["HÖCHSTER PUNKT"], excerpt: peakWindow(high.track) });
    else hl.push({ ...high, tags: ["HÖCHSTER PUNKT"] });
  }
  addWhole(firstsFree().find((x) => !first1 || x.r.site.toLowerCase() !== first1.r.site.toLowerCase()), "ZUM ERSTEN MAL HIER");
  const idxAt = (tr, tt) => {
    let lo = 0, hi = tr.length - 1;
    while (lo < hi) {
      const m = lo + hi >> 1;
      if (tr[m].timeSec < tt) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  let strong = null, long = null;
  for (const x of withTrack) {
    const sb = x.r.f.thermalBest, tb = sb && sb.v === 2 ? sb : computeThermalBest(x.r.f.track);
    if (!tb) continue;
    for (const type of ["strong", "long"]) {
      const e = tb[type];
      if (!e || (type === "strong" ? strong && e.avg <= strong.avg : long && e.gain <= long.gain)) continue;
      const c = { i0: idxAt(x.track, e.t0), i1: idxAt(x.track, e.t1), gain: e.gain, secs: e.secs, avg: e.avg, r: x.r, track: x.track, type };
      if (type === "strong") strong = c;
      else long = c;
    }
  }
  if (strong && long && strong.r.f.id === long.r.f.id) {
    const ov = Math.min(strong.i1, long.i1) - Math.max(strong.i0, long.i0);
    if (ov > 0.6 * (strong.i1 - strong.i0)) strong = null;
  }
  const thermals = [strong, long].filter(Boolean);
  return {
    rows,
    count: rows.length,
    sec: rows.reduce((a, r) => a + r.sec, 0),
    days: new Set(rows.map((r) => r.f.date || r.f.rawDate)).size,
    sites: siteSet.size,
    countries,
    countriesN,
    home,
    events,
    plays: playsOf(rows),
    pins: pinsOf(rows),
    topSites: topSites(rows),
    trackFlights: withTrack,
    // ALLE FLÜGE
    highlights: hl,
    thermals,
    bestDist: Math.max(0, ...rows.map((r) => r.dist)),
    maxAlt: Math.max(0, ...rows.map((r) => r.alt))
  };
}
function analyzeBeats(chs, sr, startSec, maxSec) {
  const a = chs[0], b = chs[1] || null;
  const hop = Math.round(sr * 0.01), i0 = Math.max(0, Math.floor(startSec * sr));
  const nF = Math.floor((Math.min(a.length, i0 + Math.floor(maxSec * sr)) - i0) / hop);
  if (nF < 600) return null;
  const rms = new Float32Array(nF), hp = new Float32Array(nF);
  for (let f = 0; f < nF; f++) {
    let s = 0, d2 = 0, p = 0;
    for (let k2 = 0; k2 < hop; k2++) {
      const i = i0 + f * hop + k2, x = b ? (a[i] + b[i]) * 0.5 : a[i];
      s += x * x;
      const d = x - p;
      d2 += d * d;
      p = x;
    }
    rms[f] = Math.sqrt(s / hop);
    hp[f] = Math.sqrt(d2 / hop);
  }
  const onset = (e) => {
    const o3 = new Float32Array(nF);
    let mx = 1e-9, acc = 0;
    for (let f = 0; f < nF; f++) {
      const m = f >= 8 ? acc / 8 : e[f];
      o3[f] = Math.max(0, e[f] - m);
      mx = Math.max(mx, o3[f]);
      acc += e[f];
      if (f >= 8) acc -= e[f - 8];
    }
    for (let f = 0; f < nF; f++) o3[f] /= mx;
    return o3;
  };
  const o1 = onset(rms), o2 = onset(hp), o = new Float32Array(nF);
  for (let f = 0; f < nF; f++) o[f] = o1[f] + 0.6 * o2[f];
  let bestC = { score: -1 };
  for (let bpm = 85; bpm <= 175; bpm += 0.5) {
    const P = 6e3 / bpm, prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.5, 2));
    for (let ph = 0; ph < P; ph += 1) {
      let s = 0, c = 0;
      for (let t = ph; t < nF - 1; t += P) {
        const i = Math.round(t);
        s += Math.max(o[i], 0.7 * (i > 0 ? o[i - 1] : 0), 0.7 * o[i + 1]);
        c++;
      }
      const sc = s / Math.max(1, c) * prior;
      if (sc > bestC.score) bestC = { score: sc, bpm, P, ph };
    }
  }
  if (bestC.score <= 0) return null;
  const beatSec = bestC.P * 0.01, firstBeat = bestC.ph * 0.01;
  const strength = [0, 0, 0, 0];
  for (let k2 = 0, t = bestC.ph; t < nF - 1; k2++, t += bestC.P) strength[k2 % 4] += o1[Math.round(t)];
  let down = 0;
  for (let d = 1; d < 4; d++) if (strength[d] > strength[down]) down = d;
  return { bpm: bestC.bpm, beatSec, firstBeat, downOffset: down };
}
function seasonBeatTimes(an, end) {
  const out = [];
  for (let t = an.firstBeat; t < end - 0.05; t += an.beatSec) out.push(t);
  return out;
}
function pickSeasonEnd(an, target, remaining) {
  const lo = target * 0.8, hi = target * 1.25;
  if (!an) return { end: Math.min(target, remaining), bars: 0, natural: remaining <= target + 0.5, short: remaining < lo };
  const barSec = an.beatSec * 4, t0 = an.firstBeat + an.downOffset * an.beatSec;
  let best = null;
  const lim = Math.min(hi, remaining - 0.2);
  for (let m = 1; ; m++) {
    const e = t0 + m * barSec;
    if (e > lim) break;
    if (e < lo) continue;
    let sc = -4 * Math.abs(e - target) / target;
    if (m % 8 === 0) sc += 0.5;
    else if (m % 4 === 0) sc += 0.25;
    if (!best || sc > best.sc) best = { end: e, bars: m, sc, natural: false, short: false };
  }
  if (remaining >= lo && remaining <= hi) {
    const sc = -4 * Math.abs(remaining - target) / target + 1.2;
    if (!best || sc > best.sc) best = { end: remaining, bars: 0, sc, natural: true, short: false };
  }
  if (best) return best;
  if (remaining < lo) {
    const m = Math.floor((remaining - 0.2 - t0) / barSec);
    return m >= 1 ? { end: t0 + m * barSec, bars: m, natural: false, short: true } : { end: remaining, bars: 0, natural: true, short: true };
  }
  return { end: target, bars: 0, natural: false, short: false };
}
async function decodeMusicFile(file) {
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AC) throw new Error("Dieser Browser kann keine Audiodateien verarbeiten.");
  const ctx = new AC(2, 1, VIDEO_AUDIO_RATE);
  const data = await file.arrayBuffer();
  try {
    return await new Promise((res, rej) => {
      const p = ctx.decodeAudioData(data, res, rej);
      if (p && p.catch) p.catch(rej);
    });
  } catch (e) {
    throw new Error("Die Musikdatei konnte nicht gelesen werden (Format nicht unterstützt?).");
  }
}
async function prepareSeasonAudio(buf, startSec, D, fadeOut) {
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new AC(2, Math.ceil(D * VIDEO_AUDIO_RATE), VIDEO_AUDIO_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(0.9, Math.min(1.2, D / 5));
  g.gain.setValueAtTime(0.9, Math.max(1.3, D - fadeOut));
  g.gain.linearRampToValueAtTime(0, D);
  src.connect(g);
  g.connect(ctx.destination);
  src.start(0, startSec);
  const out = await ctx.startRendering();
  return { sampleRate: out.sampleRate, buffer: out, channels: [out.getChannelData(0), out.getChannelData(1)] };
}
function buildSeasonScript(st, D, beats, trip, pois, opts) {
  opts = opts || {};
  const UNIT = 5.2, W = { c: 1, h: 1.5, t: 1.5 };
  const cs = st.countries.slice(0, 8), hs = st.highlights.slice(0, 5);
  const seq = [];
  if (cs.length) seq.push("c");
  if (hs.length) seq.push("h");
  st.thermals.forEach(() => seq.push("t"));
  for (let r = 1; r < Math.max(cs.length, hs.length); r++) {
    if (r < cs.length) seq.push("c");
    if (r < hs.length) seq.push("h");
  }
  let budget = D / UNIT - 3.2, nc = 0, nh = 0, nt = 0;
  for (const k2 of seq) {
    if (budget < W[k2] - 0.01) continue;
    budget -= W[k2];
    if (k2 === "c") nc++;
    else if (k2 === "h") nh++;
    else nt++;
  }
  const sc = [{ kind: "intro", key: "intro", map: "globe", w: 1 }];
  sc.push({
    kind: "region",
    key: "region:home",
    reg: "home",
    map: "terrain",
    w: 1,
    home: true,
    kicker: st.home ? [trip ? "DEINE FLÜGE" : "DEINE HEIMATREGION", ...st.home.countries].join(" · ").toUpperCase() : "DEINE FLÜGE",
    n: st.home ? st.home.n : st.count,
    sec: st.home ? st.home.sec : st.sec,
    sites: st.home ? st.home.sites : st.topSites,
    pins: st.home ? st.home.pins : st.pins,
    plays: st.home ? st.home.plays : st.plays
  });
  cs.slice(0, nc).forEach((c) => sc.push({
    kind: "region",
    key: "region:" + c.name,
    reg: c.name.toLowerCase(),
    map: "terrain",
    w: 1,
    name: c.name,
    kicker: "UNTERWEGS · " + c.name.toUpperCase(),
    n: c.n,
    sec: c.sec,
    sites: c.sites,
    pins: c.pins,
    plays: c.plays
  }));
  const addPoi = (q, h) => {
    const T = h.track, mLon = 111320 * Math.cos(q.poi.lat * Math.PI / 180), sm = String(h.r.f.startTime || "").match(/(\d{1,2}):(\d{2})/);
    let ci = 0, cd = 1e18;
    T.forEach((x, i) => {
      const d = Math.hypot((x.lon - q.poi.lon) * mLon, (x.lat - q.poi.lat) * 111320);
      if (d < cd) {
        cd = d;
        ci = i;
      }
    });
    let i0 = ci, i1 = ci;
    while (i0 > 0 && T[ci].timeSec - T[i0 - 1].timeSec <= 150) i0--;
    while (i1 < T.length - 1 && T[i1 + 1].timeSec - T[ci].timeSec <= 150) i1++;
    const seg = T.slice(i0, i1 + 1), stp = Math.max(1, Math.ceil(seg.length / 600)), sdec = seg.filter((_, i) => i % stp === 0 || i === seg.length - 1);
    sc.push({
      kind: "flight",
      key: "poi:" + q.id,
      reg: h.r.reg,
      pid: q.id,
      defOff: !q.rec,
      map: "terrain",
      w: 1.2,
      excerpt: true,
      poi: q.poi,
      zoomAdd: 0.8,
      hi: q.hi,
      kicker: "SEHENSWÜRDIGKEIT",
      title: q.name || "Sehenswürdigkeit",
      sub: [h.r.site, seasonInt(q.poi.elev) + " m ü. M."].filter(Boolean).join(" · "),
      track: seg,
      dec: sdec,
      clock0: sm ? +sm[1] * 3600 + +sm[2] * 60 + (seg[0].timeSec - T[0].timeSec) : null
    });
  };
  hs.slice(0, nh).forEach((h, hi) => {
    const f = h.r.f, ex = h.excerpt, tr = ex ? h.track.slice(ex.i0, ex.i1 + 1) : h.track, step = Math.max(1, Math.ceil(tr.length / 600));
    const dec = tr.filter((_, i) => i % step === 0 || i === tr.length - 1);
    const km = h.r.dist, parts = [h.r.country, seasonDay(h.r.ts), ex ? seasonInt(ex.alt) + " m ü. M." : km >= 5 ? Math.round(km) + " km" : (h.r.sec / 3600).toFixed(1) + " h"].filter(Boolean);
    const sm = String(f.startTime || "").match(/(\d{1,2}):(\d{2})/);
    sc.push({
      kind: "flight",
      key: (ex ? "peak:" : "flight:") + hi,
      reg: h.r.reg,
      map: "terrain",
      w: ex ? 1.1 : 1.5,
      excerpt: !!ex,
      kicker: h.tags.join(" · "),
      title: h.r.site || "Flug",
      sub: parts.join(" · "),
      track: tr,
      dec,
      hi,
      clock0: sm ? +sm[1] * 3600 + +sm[2] * 60 + (tr[0].timeSec - h.track[0].timeSec) : null
    });
    (pois || []).filter((q) => q.hi === hi && !ex).forEach((q) => addPoi(q, h));
  });
  (pois || []).filter((q) => q.extra).sort((x, y) => x.src.r.ts - y.src.r.ts).forEach((q) => addPoi(q, q.src));
  st.thermals.slice(0, nt).forEach((T) => {
    const a = Math.max(0, T.i0 - 20), z = Math.min(T.track.length, T.i1 + 21), slice = T.track.slice(a, z);
    sc.push({
      kind: "thermal",
      key: "thermal:" + T.type,
      reg: T.r.reg,
      map: "terrain",
      w: 1.5,
      type: T.type,
      gain: T.gain,
      secs: T.secs,
      avg: T.avg,
      slice,
      from: T.i0 - a,
      to: T.i1 - a,
      place: [T.r.site, seasonDay(T.r.ts)].filter(Boolean).join(" · ")
    });
  });
  {
    const regs = ["home", ...cs.slice(0, nc).map((c) => c.name.toLowerCase())], pri = { region: 0, flight: 1, thermal: 2 };
    const ri = (x) => {
      const i = regs.indexOf(x.reg || "home");
      return i < 0 ? 999 : i;
    };
    const mid = sc.slice(1).sort((a, b) => ri(a) - ri(b) || pri[a.kind] - pri[b.kind]);
    sc.length = 1;
    sc.push(...mid);
  }
  sc.push({ kind: "outro", key: "outro", map: "globe", w: 1.2 });
  const num = (v) => {
    const x = parseFloat(String(v).replace(",", "."));
    return isFinite(x) ? x : null;
  };
  sc.forEach((x) => {
    const o = opts[x.key] || {}, z = num(o.zoom), d = num(o.dur);
    x.off = (o.on != null ? o.on === false : !!x.defOff) && x.kind !== "intro" && x.kind !== "outro";
    if (z != null) x.zoomAdd = z;
    x.fixed = d != null && d > 0 ? Math.max(1.5, d) : null;
  });
  const act = sc.filter((x) => !x.off);
  const fsum = act.reduce((a, x) => a + (x.fixed || 0), 0), fk = fsum > D * 0.8 ? D * 0.8 / fsum : 1;
  const wsum = act.reduce((a, x) => a + (x.fixed ? 0 : x.w), 0), rest = Math.max(D - fsum * fk, D * 0.2);
  let durs = act.map((x) => x.fixed ? x.fixed * fk : wsum ? x.w / wsum * rest : 0);
  const dsum = durs.reduce((a, x) => a + x, 0) || 1;
  durs = durs.map((x) => x / dsum * D);
  const cuts = [0];
  let acc = 0;
  for (let i = 0; i < act.length - 1; i++) {
    acc += durs[i];
    cuts.push(acc);
  }
  cuts.push(D);
  if (beats && beats.length) for (let i = 1; i < cuts.length - 1; i++) cuts[i] = beats.reduce((b, t) => Math.abs(t - cuts[i]) < Math.abs(b - cuts[i]) ? t : b, beats[0]);
  const MIN = Math.min(2.4, D / act.length * 0.7);
  for (let i = 1; i < cuts.length - 1; i++) if (cuts[i] < cuts[i - 1] + MIN) cuts[i] = cuts[i - 1] + MIN;
  for (let i = cuts.length - 2; i >= 1; i--) if (cuts[i] > cuts[i + 1] - MIN) cuts[i] = cuts[i + 1] - MIN;
  act.forEach((x, i) => {
    x.t0 = cuts[i];
    x.t1 = cuts[i + 1];
  });
  sc.filter((x) => x.off).forEach((x) => {
    x.t0 = x.t1 = null;
  });
  return sc;
}
const seasonThermalProg = (tl0, len) => Math.max(0, Math.min(1, (tl0 - 0.4) / (len * 0.62)));
const seasonWaitLoad = (map) => new Promise((res, rej) => {
  if (map.loaded()) {
    res();
    return;
  }
  const to = setTimeout(() => rej(new Error("Karte konnte nicht geladen werden (Netzwerk/MapTiler-Schlüssel?)")), 25e3);
  map.once("load", () => {
    clearTimeout(to);
    res();
  });
});
const seasonWaitIdle = (map, ms) => new Promise((res) => {
  let done = false;
  const fin = () => {
    if (done) return;
    done = true;
    clearTimeout(to);
    map.off("idle", fin);
    res();
  };
  const to = setTimeout(fin, ms);
  map.on("idle", fin);
  map.triggerRepaint();
});
const SEASON_POI_DEFAULTS = { prom: 800, promLow: 300, steep: 1, dist: 3500 };
const SEASON_POI_ALL_FLIGHTS = true, SEASON_POI_MAX_FLIGHTS = 30, SEASON_POI_MAX_LIST = 15, SEASON_POI_REC = 4;
function findScenicPois(dec, elev, prm, max) {
  if (!elev || !dec || dec.length < 3) return [];
  const P = { ...SEASON_POI_DEFAULTS, ...prm || {} };
  const R2D = Math.PI / 180, mLat = 111320;
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  dec.forEach((p) => {
    a = Math.min(a, p.lon);
    b = Math.min(b, p.lat);
    c = Math.max(c, p.lon);
    d = Math.max(d, p.lat);
  });
  const mar = 0.03, la0 = (b + d) / 2, mLon = mLat * Math.cos(la0 * R2D);
  const w0 = a - mar, w1 = c + mar, s0 = b - mar, s1 = d + mar;
  const stepM = Math.max(120, Math.max((w1 - w0) * mLon, (s1 - s0) * mLat) / 70);
  const dLon = stepM / mLon, dLat = stepM / mLat;
  const nx = Math.floor((w1 - w0) / dLon), ny = Math.floor((s1 - s0) / dLat);
  const E = new Float32Array((nx + 1) * (ny + 1)).fill(NaN);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const v = elev(s0 + j * dLat, w0 + i * dLon);
    if (v != null && isFinite(v)) E[j * (nx + 1) + i] = v;
  }
  const rc = Math.max(2, Math.round(600 / stepM));
  const ringM = 2500;
  const distToTrack = (lon, lat) => {
    let m = 1e12;
    for (const p of dec) {
      const dx = (p.lon - lon) * mLon, dy = (p.lat - lat) * mLat;
      m = Math.min(m, dx * dx + dy * dy);
    }
    return Math.sqrt(m);
  };
  const cands = [];
  for (let j = rc; j <= ny - rc; j++) for (let i = rc; i <= nx - rc; i++) {
    const e0 = E[j * (nx + 1) + i];
    if (!isFinite(e0)) continue;
    let isMax = true;
    for (let dj = -rc; dj <= rc && isMax; dj++) for (let di = -rc; di <= rc; di++) {
      const v = E[(j + dj) * (nx + 1) + i + di];
      if (isFinite(v) && v > e0) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    const lon = w0 + i * dLon, lat = s0 + j * dLat, dist = distToTrack(lon, lat);
    if (dist > P.dist) continue;
    let sum = 0, n = 0;
    for (let k2 = 0; k2 < 8; k2++) {
      const v = elev(lat + Math.sin(k2 * Math.PI / 4) * ringM / mLat, lon + Math.cos(k2 * Math.PI / 4) * ringM / mLon);
      if (v != null && isFinite(v)) {
        sum += v;
        n++;
      }
    }
    if (n < 6) continue;
    const prom = e0 - sum / n;
    let steep = 0;
    for (let k2 = 0; k2 < 8; k2++) {
      const v = elev(lat + Math.sin(k2 * Math.PI / 4) * 250 / mLat, lon + Math.cos(k2 * Math.PI / 4) * 250 / mLon);
      if (v != null && isFinite(v)) steep = Math.max(steep, (e0 - v) / 250);
    }
    if (!(prom >= P.prom || prom >= P.promLow && steep >= P.steep)) continue;
    const score = prom * (1 + 0.3 * steep) - dist * 0.05;
    cands.push({ lon, lat, elev: e0, prom, steep, distM: dist, score });
  }
  cands.sort((x, y) => y.score - x.score);
  const out = [];
  for (const q of cands) {
    if (out.some((o) => Math.hypot((o.lon - q.lon) * mLon, (o.lat - q.lat) * mLat) < 1200)) continue;
    out.push(q);
    if (out.length >= (max || 5)) break;
  }
  return out;
}
async function lookupPoiNames(pois, apiKey, onProgress) {
  const get = async (url, ms) => {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { signal: ac.signal });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(to);
    }
  };
  const dist = (poi, la, lo) => Math.hypot((lo - poi.lon) * 111320 * Math.cos(poi.lat * Math.PI / 180), (la - poi.lat) * 111320);
  const names = pois.map(() => "");
  const prog = (k2) => {
    if (onProgress) onProgress(k2, pois.length);
  };
  if (!pois.length) return names;
  prog(0);
  const sel = `[natural~"^(peak|rock|bare_rock|cliff|volcano|ridge|hill)$"][name]`;
  const q = `[out:json][timeout:25];(${pois.map((p) => `nwr(around:800,${p.lat},${p.lon})${sel};`).join("")});out center tags 400;`;
  let els = null;
  for (const ep of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    const o = await get(ep + "?data=" + encodeURIComponent(q), 3e4);
    if (o && o.elements) {
      els = o.elements;
      break;
    }
  }
  (els || []).forEach((e) => {
    e._la = e.lat != null ? e.lat : e.center && e.center.lat;
    e._lo = e.lon != null ? e.lon : e.center && e.center.lon;
  });
  pois.forEach((poi, i) => {
    const c = (els || []).filter((e) => e.tags && e.tags.name).map((e) => ({ n: e.tags.name, d: dist(poi, e._la, e._lo), peak: e.tags.natural === "peak" ? 0 : 1 })).filter((e) => isFinite(e.d) && e.d <= 800).sort((x, y) => x.peak - y.peak || x.d - y.d);
    if (c.length) names[i] = c[0].n;
  });
  prog(names.filter(Boolean).length);
  for (let i = 0; i < pois.length; i++) {
    if (names[i]) continue;
    const poi = pois[i];
    prog(names.filter(Boolean).length);
    const w = await get(`https://de.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${poi.lat}%7C${poi.lon}&gsradius=1500&gslimit=5&format=json&origin=*`, 8e3);
    const ws = w && w.query && w.query.geosearch;
    if (ws && ws.length) {
      names[i] = ws[0].title;
      continue;
    }
    if (apiKey) {
      const g = await get(`https://api.maptiler.com/geocoding/${poi.lon},${poi.lat}.json?key=${apiKey}&language=de&limit=1`, 8e3);
      if (g && g.features && g.features[0] && g.features[0].text) names[i] = g.features[0].text;
    }
  }
  prog(pois.length);
  return names;
}
const seasonBearing = (a, b) => {
  const R = Math.PI / 180, dl = (b.lon - a.lon) * R * Math.cos((a.lat + b.lat) / 2 * R), dp = (b.lat - a.lat) * R;
  return Math.atan2(dl, dp) / R;
};
function SeasonVideoStudio({ script, stats, meta, mapTilerKey, format, purpose, music, D, mapStyle, onDone, onError, onCancelRef, setStatus }) {
  const mainDivRef = useRef(null), outRef = useRef(null);
  const portrait = format === "port", square = format === "square";
  const W = portrait ? 720 : square ? 1080 : 1280, H = portrait ? 1280 : square ? 1080 : 720;
  const s = portrait ? 1 : square ? 0.9 : 0.8;
  useEffect(() => {
    let cancelled = false, main = null, wake = null;
    onCancelRef.current = () => {
      cancelled = true;
    };
    const sdk = window.maptilersdk;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, f) => a + (b - a) * f;
    const ease = (u) => u * u * (3 - 2 * u);
    const easeOut = (u) => 1 - Math.pow(1 - u, 3);
    const run = async () => {
      if (!sdk) throw new Error("MapTiler-SDK nicht geladen");
      if (!mapTilerKey) throw new Error("Kein MapTiler-Schlüssel hinterlegt (Service → API-Zugangsdaten).");
      const FPS = 30, BITRATE = videoBitrateFor(D, purpose), scenes = script;
      const wcCfg = await pickWebCodecsConfig(W, H, FPS, BITRATE);
      if (!wcCfg) throw new Error("Dieser Browser kann keine MP4-Videos kodieren (WebCodecs/H.264). Bitte Chrome, Edge oder einen aktuellen Safari verwenden.");
      const out = outRef.current;
      out.width = W;
      out.height = H;
      const ctx = out.getContext("2d");
      const frameCopy = document.createElement("canvas");
      frameCopy.width = W;
      frameCopy.height = H;
      const fctx = frameCopy.getContext("2d");
      const prevSnap = document.createElement("canvas");
      prevSnap.width = W;
      prevSnap.height = H;
      const pctx = prevSnap.getContext("2d");
      const allPins = stats.pins.length ? stats.pins : [{ lat: 46.8, lon: 8.2, n: 1 }];
      const centroid = (pins) => {
        let la = 0, lo = 0, w = 0;
        pins.forEach((p) => {
          la += p.lat * p.n;
          lo += p.lon * p.n;
          w += p.n;
        });
        return { lat: la / w, lon: lo / w };
      };
      const focus = centroid(stats.home && stats.home.pins.length ? stats.home.pins : allPins);
      const gdia = Math.min(W, H * 0.78), zg = Math.log2(gdia * Math.PI / 512);
      let mapKind = null, isGlobe = false, altLayer = null, curtain = null, layerScene = null;
      const removeLayer = () => {
        try {
          if (main && main.getLayer("track-altitude")) main.removeLayer("track-altitude");
          if (main && main.getLayer("track-curtain")) main.removeLayer("track-curtain");
        } catch {
        }
        altLayer = null;
        curtain = null;
        layerScene = null;
      };
      const ensureMap = async (kind) => {
        if (main && mapKind === kind) return;
        if (main) {
          try {
            main.remove();
          } catch {
          }
          main = null;
          altLayer = null;
          curtain = null;
          layerScene = null;
        }
        setStatus(kind === "globe" ? "Weltkugel wird geladen …" : "Geländekarte wird geladen …", 0);
        const o = {
          apiKey: mapTilerKey,
          language: "de",
          interactive: false,
          pixelRatio: 1,
          preserveDrawingBuffer: true,
          canvasContextAttributes: { preserveDrawingBuffer: true },
          fadeDuration: 0,
          attributionControl: false,
          navigationControl: false,
          geolocateControl: false,
          scaleControl: false,
          fullscreenControl: false,
          terrainControl: false,
          container: mainDivRef.current,
          style: videoMapStyle(sdk, mapStyle),
          center: [focus.lon, focus.lat],
          zoom: kind === "globe" ? zg : 6,
          pitch: 0
        };
        if (kind === "globe") {
          o.projection = "globe";
          o.terrain = false;
        } else {
          o.terrain = true;
          o.maxPitch = 85;
          o.maxTileCacheSize = 600;
        }
        main = new sdk.Map(o);
        await seasonWaitLoad(main);
        if (kind === "globe") {
          try {
            if (main.enableGlobe && !isGlobeMap(main)) main.enableGlobe();
          } catch {
          }
        }
        isGlobe = kind === "globe" && isGlobeMap(main);
        await seasonWaitIdle(main, 8e3);
        mapKind = kind;
      };
      const isGlobeMap = (m) => {
        try {
          const p = m.getProjection && m.getProjection();
          return !!p && (p === "globe" || p.type === "globe");
        } catch {
          return false;
        }
      };
      const CIRC = 40075016686e-3, R2D = Math.PI / 180;
      const mpp0 = (lat, zoom) => CIRC * Math.cos(lat * R2D) / (512 * Math.pow(2, zoom));
      const groundAt = (lon, lat) => {
        try {
          const g = main.queryTerrainElevation ? main.queryTerrainElevation([lon, lat]) : null;
          return g != null && isFinite(g) ? g : null;
        } catch {
          return null;
        }
      };
      let lastGround = 0;
      const SM = {};
      const smooth = (name, target, tt, sc, tauDown, tauUp) => {
        const q = SM[name];
        if (!q || q.sc !== sc || Math.abs(tt - q.t) > 1.5) {
          SM[name] = { v: target, t: tt, sc };
          return target;
        }
        const tau = target < q.v ? tauDown : tauUp;
        q.v += (target - q.v) * Math.min(1, Math.abs(tt - q.t) / tau);
        q.t = tt;
        return q.v;
      };
      const fitCam = (pts, o) => {
        let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
        pts.forEach((p) => {
          a = Math.min(a, p.lon);
          b = Math.min(b, p.lat);
          c = Math.max(c, p.lon);
          d = Math.max(d, p.lat);
        });
        const la = (b + d) / 2, lo = (a + c) / 2;
        const dx = Math.max((c - a) * 111320 * Math.cos(la * R2D), o.minSpan), dy = Math.max((d - b) * 111320, o.minSpan);
        const fore = 0.35 + 0.65 * Math.cos(o.pitch * R2D);
        const mpp = Math.max(dx / (W * (1 - 2 * o.padX)), dy * fore / (H * (1 - o.top - o.bottom)));
        return { center: [lo, la], zoom: clamp(Math.log2(CIRC * Math.cos(la * R2D) / (512 * mpp)), 3, o.maxZoom) };
      };
      const sceneCam = (sc, u) => {
        const e = ease(u);
        if (sc.kind === "flight" && sc.poi) {
          if (!sc._p) {
            const n = sc.dec.length, cen = { lon: sc.dec.reduce((q, x) => q + x.lon, 0) / n, lat: sc.dec.reduce((q, x) => q + x.lat, 0) / n };
            const mid = { lon: (cen.lon + sc.poi.lon) / 2, lat: (cen.lat + sc.poi.lat) / 2 };
            const far = Math.max(
              2500,
              Math.hypot((sc.poi.lon - mid.lon) * 111320 * Math.cos(mid.lat * R2D), (sc.poi.lat - mid.lat) * 111320),
              ...sc.dec.map((x) => Math.hypot((x.lon - mid.lon) * 111320 * Math.cos(mid.lat * R2D), (x.lat - mid.lat) * 111320))
            );
            const mpp = far * 2.4 / (W * 0.8);
            sc._p = { center: [mid.lon, mid.lat], b: seasonBearing(cen, sc.poi), z: clamp(Math.log2(CIRC * Math.cos(mid.lat * R2D) / (512 * mpp)), 11, 14.3) };
          }
          return { center: sc._p.center, zoom: clamp(sc._p.z + (sc.zoomAdd || 0) + 0.3 * e, 11, 16.5), bearing: sc._p.b + lerp(-4, 4, u), pitch: 62, top: 0.1, bottom: 0.44 };
        }
        if (sc.kind === "flight") {
          if (!sc._f) sc._f = fitCam(sc.dec, { pitch: 40, top: 0.1, bottom: 0.44, padX: 0.1, minSpan: sc.excerpt ? 500 : 2e3, maxZoom: sc.excerpt ? 16 : 14.5 });
          return { center: sc._f.center, zoom: clamp(sc._f.zoom + (sc.zoomAdd || 0) + 0.2 * e, 3, 17.5), bearing: lerp(-8, 10, u), pitch: lerp(36, 44, e), top: 0.1, bottom: 0.44 };
        }
        if (!sc._f) {
          const pts = (sc.pins && sc.pins.length ? sc.pins : allPins).slice();
          (sc.plays || []).forEach((pl) => {
            if (pl.path) pl.path.forEach((q) => pts.push({ lon: q[0], lat: q[1] }));
          });
          sc._f = fitCam(pts, { pitch: 38, top: 0.08, bottom: 0.5, padX: 0.1, minSpan: 15e3, maxZoom: 11 });
        }
        return { center: sc._f.center, zoom: sc._f.zoom + 0.25 * e, bearing: lerp(0, sc.kind === "totals" ? 10 : -6, e), pitch: lerp(34, 40, e), top: 0.08, bottom: 0.5 };
      };
      const isFly = (a, b) => !!a && !!b && a.map === "terrain" && b.map === "terrain" && a.kind !== "thermal" && b.kind !== "thermal";
      const flyDur = (sc) => Math.min(1.8, (sc.t1 - sc.t0) * 0.4);
      const angle = (a, b, f) => a + (((b - a) % 360 + 540) % 360 - 180) * f;
      const flyCam = (A, B, f) => {
        const la = (A.center[1] + B.center[1]) / 2;
        const dm = Math.hypot((B.center[0] - A.center[0]) * 111320 * Math.cos(la * R2D), (B.center[1] - A.center[1]) * 111320);
        const zFit = Math.log2(CIRC * Math.cos(la * R2D) / (512 * (Math.max(dm, 1) / (W * 0.8))));
        const zMid = Math.min(A.zoom, B.zoom, zFit - 0.2);
        const bump = Math.max(0, (A.zoom + B.zoom) / 2 - zMid) * 4 * f * (1 - f);
        return {
          center: [lerp(A.center[0], B.center[0], f), lerp(A.center[1], B.center[1], f)],
          zoom: lerp(A.zoom, B.zoom, f) - bump,
          bearing: angle(A.bearing, B.bearing, f),
          pitch: lerp(A.pitch, B.pitch, f),
          top: lerp(A.top, B.top, f),
          bottom: lerp(A.bottom, B.bottom, f)
        };
      };
      const sceneAt = (t) => {
        let si = scenes.findIndex((x) => t < x.t1);
        if (si < 0) si = scenes.length - 1;
        const sc = scenes[si], len = sc.t1 - sc.t0, tl = clamp(t - sc.t0, 0, len);
        const prev = si > 0 ? scenes[si - 1] : null, next = si < scenes.length - 1 ? scenes[si + 1] : null;
        const fly = isFly(prev, sc);
        return {
          si,
          sc,
          tl,
          len,
          u: len > 0 ? tl / len : 1,
          fly,
          tx: Math.max(0, tl - (fly ? flyDur(sc) * 0.55 : 0)),
          // Textzeit: erst nach (halbem) Kameraflug einblenden
          outA: next && isFly(sc, next) ? clamp((len - tl) / 0.5, 0, 1) : 1
        };
      };
      const applyScene = (st) => {
        const { sc, u } = st, e = ease(u);
        if (sc.kind === "thermal") {
          if (layerScene !== sc) {
            removeLayer();
            curtain = createAltitudeCurtainLayer(sc.slice, groundAt, true);
            main.addLayer(curtain);
            altLayer = createAltitudeTrackLayer(sc.slice, 10 * s, true);
            main.addLayer(altLayer);
            layerScene = sc;
          }
          if (curtain && !curtain.usesGround && !sc._rebuilt && st.tl > 0.5) {
            sc._rebuilt = true;
            const nc = createAltitudeCurtainLayer(sc.slice, groundAt, true);
            if (nc.usesGround) {
              try {
                main.removeLayer("track-curtain");
                main.addLayer(nc, "track-altitude");
                curtain = nc;
              } catch {
              }
            }
          }
          const pr = Math.round(seasonThermalProg(st.tl, st.len) * (sc.slice.length - 1));
          altLayer.setProgress(pr);
          curtain.setProgress(pr);
        } else if (layerScene) removeLayer();
        switch (sc.kind) {
          case "intro":
            main.jumpTo({ center: [lerp(focus.lon - 40, focus.lon, e), lerp(14, 24, e)], zoom: lerp(zg + 0.3, zg + 0.62, e), bearing: 0, pitch: 0, padding: { top: 0, bottom: H * 0.3, left: 0, right: 0 } });
            break;
          case "outro":
            main.jumpTo({ center: [lerp(focus.lon + 10, focus.lon - 30, u), lerp(24, 18, e)], zoom: lerp(zg + 0.55, zg + 0.35, e), bearing: 0, pitch: 0, padding: { top: 0, bottom: H * 0.3, left: 0, right: 0 } });
            break;
          case "thermal": {
            const sl = sc.slice, tt = sc.t0 + st.tl;
            if (!sc._c) {
              let la = 0, lo = 0;
              sl.forEach((p) => {
                la += p.lat;
                lo += p.lon;
              });
              const h0 = videoHeadingAt(sl, sl[Math.min(sc.from, sl.length - 1)].timeSec, 20);
              sc._c = { center: [lo / sl.length, la / sl.length], b0: h0 == null ? 0 : h0 };
            }
            const pr = Math.round(seasonThermalProg(st.tl, st.len) * (sl.length - 1));
            const gc = groundAt(sc._c.center[0], sc._c.center[1]);
            if (gc != null) lastGround = gc;
            const hCam = smooth("h", Math.max(0, sl[pr].gpsAlt - lastGround), tt, sc, 6, 6);
            const zoom = smooth("zoom", 14.7 + (sc.zoomAdd || 0) - clamp(Math.log2(1 + hCam / 450), 0, 1.2), tt, sc, 1.2, 1.2), pitch = 56;
            const pad = smooth("pad", Math.min(hCam / mpp0(sc._c.center[1], zoom) * Math.sin(pitch * R2D), H * 0.12), tt, sc, 2, 2);
            main.jumpTo({ center: sc._c.center, zoom, bearing: sc._c.b0 + 170 * u, pitch, padding: { top: 2 * pad, bottom: 0, left: 0, right: 0 } });
            break;
          }
          default: {
            let cam = sceneCam(sc, u);
            if (st.fly) {
              const fd = flyDur(sc);
              if (st.tl < fd) cam = flyCam(sceneCam(scenes[st.si - 1], 1), sceneCam(sc, fd / st.len), ease(st.tl / fd));
            }
            main.jumpTo({ center: cam.center, zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch, padding: { top: H * cam.top, bottom: H * cam.bottom, left: 0, right: 0 } });
          }
        }
      };
      let timeouts = 0;
      const renderSettled = () => new Promise((res) => {
        let done = false;
        const grab = () => {
          try {
            fctx.clearRect(0, 0, W, H);
            fctx.drawImage(main.getCanvas(), 0, 0, W, H);
          } catch {
          }
        };
        const fin = () => {
          if (done) return;
          done = true;
          clearTimeout(to);
          main.off("render", onr);
          res();
        };
        const onr = () => {
          if (main.areTilesLoaded()) {
            grab();
            timeouts = 0;
            fin();
          }
        };
        const to = setTimeout(() => {
          timeouts++;
          grab();
          fin();
        }, timeouts > 3 ? 250 : 3e3);
        main.on("render", onr);
        main.triggerRepaint();
      });
      const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      const mg = 44 * s;
      const T = (txt, x, y, size, weight, color, align, ls) => {
        ctx.font = `${weight} ${size}px ${FONT}`;
        ctx.textAlign = align || "left";
        ctx.textBaseline = "alphabetic";
        try {
          ctx.letterSpacing = (ls || 0) + "px";
        } catch {
        }
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = 8 * s;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = color;
        ctx.fillText(txt, x, y);
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        try {
          ctx.letterSpacing = "0px";
        } catch {
        }
      };
      const fitSize = (txt, size, weight, maxW) => {
        ctx.font = `${weight} ${size}px ${FONT}`;
        const w = ctx.measureText(txt).width;
        return w > maxW ? size * maxW / w : size;
      };
      const grad = (from, a) => {
        const g = ctx.createLinearGradient(0, H * from, 0, H);
        g.addColorStop(0, "rgba(4,14,32,0)");
        g.addColorStop(1, `rgba(4,14,32,${a})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, H * from, W, H * (1 - from));
      };
      const tint = (a) => {
        ctx.fillStyle = `rgba(12,30,58,${a})`;
        ctx.fillRect(0, 0, W, H);
      };
      let curOutA = 1;
      const KICK = "#8fc3e8", TIMEC = "#c5d94a";
      const reveal = (tl, delay) => {
        const r = clamp((tl - delay) / 0.55, 0, 1), e = easeOut(r);
        ctx.globalAlpha = e * curOutA;
        ctx.save();
        ctx.translate(0, 16 * s * (1 - e));
        return r;
      };
      const endReveal = () => {
        ctx.restore();
        ctx.globalAlpha = 1;
      };
      const count = (target, tl, delay, dur) => Math.round(target * Math.pow(clamp((tl - delay) / (dur || 1.1), 0, 1), 0.85));
      const front = (lon, lat) => {
        if (!isGlobe) return true;
        const c = main.getCenter(), r = Math.PI / 180;
        return Math.sin(lat * r) * Math.sin(c.lat * r) + Math.cos(lat * r) * Math.cos(c.lat * r) * Math.cos((lon - c.lng) * r) > 0.1;
      };
      const pin = (x, y, k2) => {
        ctx.save();
        ctx.globalAlpha = curOutA;
        ctx.translate(x, y);
        ctx.scale(k2, k2);
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 8 * s;
        ctx.fillStyle = "#dc2626";
        ctx.beginPath();
        ctx.arc(0, -17 * s, 11 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-9 * s, -10 * s);
        ctx.lineTo(0, 0);
        ctx.lineTo(9 * s, -10 * s);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(0, -17 * s, 4.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };
      const dot = (x, y, r, k2) => {
        ctx.save();
        ctx.globalAlpha = curOutA * 0.55;
        ctx.shadowColor = SEASON_ACCENT;
        ctx.shadowBlur = 6 * s;
        ctx.fillStyle = SEASON_ACCENT;
        ctx.beginPath();
        ctx.arc(x, y, r * k2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1.4 * s;
        ctx.stroke();
        ctx.restore();
      };
      const pinsOn = (pins, tl, kind) => {
        const n = pins.length;
        pins.forEach((p, i) => {
          const k2 = easeOut(clamp((tl - 0.2 - i / Math.max(1, n) * 1.6) / 0.45, 0, 1));
          if (k2 <= 0 || !front(p.lon, p.lat)) return;
          const q = main.project([p.lon, p.lat]);
          if (q.x < -40 || q.x > W + 40 || q.y < -60 || q.y > H + 40) return;
          if (kind === "pin") pin(q.x, q.y, k2 * (0.9 + Math.min(0.5, p.n / 40)));
          else dot(q.x, q.y, 5 * s * (0.9 + Math.min(0.5, p.n / 40)), k2);
        });
      };
      const drawPlays = (plays, tl, cdur) => {
        const N = plays.length;
        if (!N) return;
        const L = clamp(cdur / N * 3, 0.7, 1.4), started = clamp(Math.floor((tl - 0.3) / cdur * N) + 1, 0, N);
        ctx.save();
        ctx.globalAlpha = curOutA;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        for (let i = started - 1; i >= 0; i--) {
          const age = tl - (0.3 + i / N * cdur);
          if (age > L + 0.9) break;
          const pl = plays[i];
          if (!pl.path || age < 0) continue;
          const m = ease(clamp(age / L, 0, 1)) * (pl.path.length - 1), full = Math.floor(m), fr = m - full, a = age > L ? 1 - (age - L) / 0.9 : 1;
          const pts = [];
          for (let q = 0; q <= full; q++) pts.push(main.project(pl.path[q]));
          if (full < pl.path.length - 1) {
            const A = pl.path[full], B = pl.path[full + 1];
            pts.push(main.project([A[0] + (B[0] - A[0]) * fr, A[1] + (B[1] - A[1]) * fr]));
          }
          ctx.globalAlpha = curOutA * a;
          ctx.beginPath();
          pts.forEach((q, k2) => k2 ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y));
          ctx.shadowColor = SEASON_ACCENT;
          ctx.shadowBlur = 14 * s;
          ctx.strokeStyle = "#f2ffd0";
          ctx.lineWidth = 4.6 * s;
          ctx.stroke();
          const h = pts[pts.length - 1];
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(h.x, h.y, 5.5 * s, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      };
      const kicker = (txt, y, tl, delay) => {
        reveal(tl, delay);
        T(txt, mg, y, Math.min(21 * s, fitSize(txt, 21 * s, 800, W - 2 * mg - 3 * s * txt.length)), 800, KICK, "left", 3 * s);
        endReveal();
      };
      const bigNum = (n, suffix, y, size, tl, delay) => {
        reveal(tl, delay);
        const num = seasonInt(n);
        ctx.font = `900 ${size}px ${FONT}`;
        const w = ctx.measureText(num).width;
        T(num, mg, y, size, 900, "#fff", "left");
        T(suffix, mg + w + 14 * s, y, size * 0.36, 800, "#fff", "left");
        endReveal();
      };
      const events = stats.events && stats.events.length ? stats.events : allPins.map((p, i) => ({ name: "", ts: 0, lat: p.lat, lon: p.lon }));
      const introEvents = (tl, len, kind) => {
        const N = events.length, t0 = 0.6, span = Math.max(1.5, len * 0.72);
        const shown = clamp(Math.floor((tl - t0) / span * N) + 1, 0, N);
        events.forEach((ev, i) => {
          const k2 = easeOut(clamp((tl - (t0 + i / N * span)) / 0.45, 0, 1));
          if (k2 <= 0 || !front(ev.lon, ev.lat)) return;
          const q = main.project([ev.lon, ev.lat]);
          if (q.x < -40 || q.x > W + 40 || q.y < -60 || q.y > H + 40) return;
          pin(q.x, q.y, k2);
        });
        for (let r = 0; r < 4; r++) {
          const i = shown - 4 + r;
          if (i < 0 || !events[i] || !events[i].name) continue;
          const a = 0.35 + 0.65 * (r + 1) / 4, y = 96 * s + r * 44 * s;
          ctx.globalAlpha = a;
          T(events[i].name, mg, y, 27 * s, r === 3 ? 800 : 600, "#fff", "left");
          if (events[i].ts) T(seasonDay(events[i].ts), W - mg, y, 21 * s, 600, "rgba(232,244,253,0.8)", "right");
          ctx.globalAlpha = 1;
        }
      };
      const drawScene = (t, st) => {
        const { sc, len, u } = st, tl = st.tx, tl0 = st.tl, bot = H - 78 * s;
        curOutA = st.outA;
        if (sc.map === "globe") {
          const bg = ctx.createLinearGradient(0, 0, 0, H);
          bg.addColorStop(0, "#020b22");
          bg.addColorStop(0.55, "#0b2f66");
          bg.addColorStop(1, "#041030");
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, W, H);
          ctx.globalCompositeOperation = "lighten";
          ctx.drawImage(frameCopy, 0, 0, W, H);
          ctx.globalCompositeOperation = "source-over";
        } else ctx.drawImage(frameCopy, 0, 0, W, H);
        switch (sc.kind) {
          case "intro": {
            grad(0.5, 0.75);
            introEvents(tl, len, "pin");
            const stats1 = [stats.count + (stats.count === 1 ? " Flug" : " Flüge"), stats.sites ? stats.sites + (stats.sites === 1 ? " Ort" : " Orte") : "", stats.countriesN ? stats.countriesN + (stats.countriesN === 1 ? " Land" : " Länder") : ""].filter(Boolean).join(" · ");
            const yS = bot, bigSize = fitSize(meta.big, 170 * s, 900, W - 2 * mg), yB = yS - 62 * s, yT = yB - bigSize * 0.74 - 26 * s, yP = yT - 72 * s * 0.8 - 18 * s;
            reveal(tl, 0.2);
            T(meta.period.toUpperCase(), mg, yP, 19 * s, 700, "rgba(232,244,253,0.85)", "left", 2.5 * s);
            endReveal();
            reveal(tl, 0.45);
            T(meta.title, mg, yT, fitSize(meta.title, 72 * s, 800, W - 2 * mg), 800, "#fff");
            endReveal();
            reveal(tl, 0.75);
            T(meta.big, mg, yB, bigSize, 900, SEASON_ACCENT);
            endReveal();
            reveal(tl, 1.1);
            T(stats1, mg, yS, 26 * s, 700, "rgba(232,244,253,0.92)");
            endReveal();
            break;
          }
          case "region": {
            tint(0.34);
            grad(0.55, 0.6);
            pinsOn(sc.pins, tl, "dot");
            const cdur = Math.max(2, len * 0.62), plays = sc.plays || [], N = plays.length;
            drawPlays(plays, tl, cdur);
            if (N && !sc._cum) {
              let c = 0;
              sc._cum = plays.map((q) => c += q.sec);
            }
            const started = N ? clamp(Math.floor((tl - 0.3) / cdur * N) + 1, 0, N) : 0;
            const rows = sc.sites.slice(0, 3), rowH = 54 * s, yRows = bot - (rows.length - 1) * rowH;
            const yTime = yRows - (rows.length ? 56 * s : 0), yBig = yTime - 56 * s, yK = yBig - 150 * s * 0.74 - 20 * s;
            kicker(sc.kicker, yK, tl, 0.15);
            bigNum(N ? started : count(sc.n, tl, 0.3, cdur), sc.n === 1 ? "Flug" : "Flüge", yBig, 150 * s, tl, 0.3);
            reveal(tl, 0.7);
            T(seasonHM(N ? started ? sc._cum[started - 1] : 0 : sc.sec * Math.pow(clamp((tl - 0.3) / cdur, 0, 1), 0.85)) + " in der Luft", mg, yTime, 28 * s, 700, TIMEC);
            endReveal();
            rows.forEach((r, i) => {
              reveal(tl, 1 + i * 0.25);
              const y = yRows + i * rowH;
              ctx.fillStyle = "rgba(255,255,255,0.75)";
              ctx.beginPath();
              ctx.arc(mg + 8 * s, y - 11 * s, 4 * s, 0, Math.PI * 2);
              ctx.fill();
              T(r.name, mg + 30 * s, y, fitSize(r.name, 36 * s, 700, W - 2 * mg - 190 * s), 700, "#fff");
              T(r.n + (r.n === 1 ? " Start" : " Starts"), W - mg, y, 24 * s, 600, "rgba(232,244,253,0.65)", "right");
              endReveal();
            });
            break;
          }
          case "flight": {
            tint(0.3);
            grad(0.5, 0.62);
            const track = sc.track, t0 = track[0].timeSec, t1 = track[track.length - 1].timeSec;
            const p = clamp((tl0 - 0.4) / Math.max(0.5, len - 1.3), 0, 1), tc = t0 + (t1 - t0) * p;
            const pts = [];
            for (const q of sc.dec) {
              if (q.timeSec > tc) break;
              pts.push(main.project([q.lon, q.lat]));
            }
            const cur = videoPosAt(track, tc), cp = main.project([cur.lon, cur.lat]);
            pts.push(cp);
            ctx.save();
            ctx.globalAlpha = curOutA;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.beginPath();
            pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y));
            ctx.strokeStyle = "rgba(4,14,32,0.55)";
            ctx.lineWidth = 8 * s;
            ctx.stroke();
            ctx.shadowColor = SEASON_ACCENT;
            ctx.shadowBlur = 10 * s;
            ctx.strokeStyle = "#e4f9b5";
            ctx.lineWidth = 3.2 * s;
            ctx.stroke();
            ctx.restore();
            dot(cp.x, cp.y, 9 * s, 1);
            if (sc.poi) {
              const pq = main.project([sc.poi.lon, sc.poi.lat]), pk = easeOut(clamp((tl - 0.3) / 0.45, 0, 1));
              if (pk > 0 && pq.x > -40 && pq.x < W + 40 && pq.y > 0 && pq.y < H + 40) {
                pin(pq.x, pq.y, pk * 1.15);
                if (sc.title && sc.title !== "Sehenswürdigkeit") {
                  ctx.save();
                  ctx.globalAlpha = pk * curOutA;
                  T(sc.title, pq.x, pq.y - 52 * s, 26 * s, 700, "#fff", "center");
                  ctx.restore();
                }
              }
            }
            const yS = bot, yL = yS - 56 * s * 0.9 - 12 * s, ySub = yL - 36 * s, yT = ySub - 40 * s - 8 * s * 0, yK = yT - 84 * s * 0.72 - 14 * s;
            kicker(sc.kicker, yK, tl, 0.2);
            reveal(tl, 0.4);
            T(sc.title, mg, yT + 4 * s, fitSize(sc.title, 84 * s, 800, W - 2 * mg), 800, "#fff");
            endReveal();
            reveal(tl, 0.6);
            T(sc.sub, mg, ySub + 6 * s, 25 * s, 600, "rgba(232,244,253,0.8)");
            endReveal();
            reveal(tl, 0.8);
            T("HÖHE", mg, yL, 17 * s, 700, "rgba(232,244,253,0.55)", "left", 2.5 * s);
            T(seasonInt(cur.gpsAlt) + " m", mg, yS, 56 * s, 800, "#fff");
            if (sc.clock0 != null) {
              const c = Math.floor(sc.clock0 + (tc - t0)), hh = Math.floor(c / 3600) % 24, mm = Math.floor(c % 3600 / 60);
              const x2 = mg + 300 * s;
              T("UHRZEIT", x2, yL, 17 * s, 700, "rgba(232,244,253,0.55)", "left", 2.5 * s);
              T(String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0"), x2, yS, 56 * s, 800, "#fff");
            }
            endReveal();
            break;
          }
          case "thermal": {
            tint(0.3);
            grad(0.5, 0.62);
            const pr = Math.round(seasonThermalProg(tl0, len) * (sc.slice.length - 1)), strong = sc.type === "strong";
            const gNow = clamp(sc.slice[pr].gpsAlt - sc.slice[sc.from].gpsAlt, 0, sc.gain), p = sc.gain > 0 ? gNow / sc.gain : 0;
            const yS = bot, ySub = yS - 6 * s, yB = ySub - 50 * s, yK = yB - 150 * s * 0.74 - 20 * s;
            kicker(strong ? "STÄRKSTE THERMIK" : "LÄNGSTE THERMIK · MEISTE HÖHENMETER", yK, tl, 0.2);
            reveal(tl, 0.35);
            const num = strong ? (sc.avg * Math.min(1, p * 1.25)).toFixed(1) : "+" + seasonInt(gNow), unit = strong ? "m/s" : "m";
            ctx.font = `900 ${150 * s}px ${FONT}`;
            const w = ctx.measureText(num).width;
            T(num, mg, yB, 150 * s, 900, SEASON_ACCENT);
            T(unit, mg + w + 12 * s, yB, 150 * s * 0.36, 800, SEASON_ACCENT);
            T(strong ? "+" + seasonInt(sc.gain) + " m in " + seasonMMSS(sc.secs) + " min" : "in " + seasonMMSS(sc.secs) + " min · Ø " + sc.avg.toFixed(1) + " m/s", mg, ySub - 8 * s, 27 * s, 700, "#fff");
            T(sc.place, mg, yS + 34 * s, 22 * s, 600, "rgba(232,244,253,0.7)");
            endReveal();
            break;
          }
          case "totals": {
            tint(0.38);
            grad(0.45, 0.66);
            const pl = (n, a, b) => n === 1 ? a : b, hrs = Math.round(stats.sec / 3600);
            const rows = [[stats.count, pl(stats.count, "Flug", "Flüge")], [hrs, pl(hrs, "Stunde in der Luft", "Stunden in der Luft")], [stats.days, pl(stats.days, "Flugtag", "Flugtage")], [stats.countriesN, pl(stats.countriesN, "Land", "Länder")]].filter((r) => r[0] > 0);
            const pitch = 128 * s, last = bot, yK = last - (rows.length - 1) * pitch - 120 * s * 0.74 - 34 * s;
            kicker("DEINE " + (meta.noun || "Saison").toUpperCase() + " " + meta.big.toUpperCase(), yK, tl, 0.1);
            rows.forEach((r, i) => {
              const y = last - (rows.length - 1 - i) * pitch;
              bigNum(count(r[0], tl, 0.3 + i * 0.4, 1), r[1], y, 110 * s, tl, 0.3 + i * 0.4);
            });
            break;
          }
          case "outro": {
            grad(0.5, 0.78);
            pinsOn(allPins, 99, "pin");
            const yThanks = bot, items = [[stats.count, "FLÜGE"], [Math.round(stats.sec / 3600), "STUNDEN"], [stats.days, "FLUGTAGE"], [stats.countriesN, "LÄNDER"]].filter((r) => r[0] > 0);
            const yN = yThanks - 70 * s, yTitle = yN - 54 * s - 50 * s, yK = yTitle - 84 * s * 0.75 - 18 * s;
            kicker((meta.noun || "Saison").toUpperCase() + " " + meta.big.toUpperCase(), yK, tl, 0.2);
            reveal(tl, 0.4);
            T(meta.title, mg, yTitle, fitSize(meta.title, 84 * s, 800, W - 2 * mg), 800, "#fff");
            endReveal();
            reveal(tl, 0.8);
            const colW = (W - 2 * mg) / items.length;
            items.forEach((r, i) => {
              const x = mg + i * colW;
              T(seasonInt(r[0]), x, yN, 54 * s, 800, "#fff");
              T(r[1], x, yN + 26 * s, 15 * s, 700, "rgba(232,244,253,0.6)", "left", 2 * s);
            });
            endReveal();
            reveal(tl, 1.3);
            T("schön wars:)", mg, yThanks + 30 * s, 24 * s, 600, "rgba(232,244,253,0.85)");
            endReveal();
            break;
          }
        }
      };
      let lastSi = -1;
      const drawFrame = (t, st) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        drawScene(t, st);
        if (st.si > 0 && st.tl < 0.7 && !st.fly) {
          ctx.globalAlpha = 1 - st.tl / 0.7;
          ctx.drawImage(prevSnap, 0, 0);
          ctx.globalAlpha = 1;
        }
        const fade = Math.max(clamp(1 - t / 0.5, 0, 1), clamp(1 - (D - t) / 0.8, 0, 1));
        if (fade > 0) {
          ctx.fillStyle = `rgba(0,0,0,${fade})`;
          ctx.fillRect(0, 0, W, H);
        }
      };
      try {
        if (navigator.wakeLock) wake = await navigator.wakeLock.request("screen");
      } catch {
      }
      let mix = null, audioNote = "";
      if (music && music.buf) {
        setStatus("Musik wird vorbereitet …", 0);
        mix = await prepareSeasonAudio(music.buf, music.start, D, music.fade);
        if (cancelled) return;
      }
      const audioCfg = mix ? await pickAudioConfig() : null;
      if (mix && !audioCfg) {
        audioNote = "Dieser Browser kann den Ton nicht in die Videodatei kodieren – das Video wurde ohne Musik erstellt.";
        mix = null;
      }
      const frames = Math.round(D * FPS);
      let lastPct = -1;
      const blob = await encodeVideoWebCodecs({
        canvas: out,
        W,
        H,
        fps: FPS,
        frames,
        bitrate: BITRATE,
        cfg: wcCfg,
        isCancelled: () => cancelled,
        audio: mix && audioCfg ? { mix, cfg: audioCfg } : null,
        renderFrame: async (k2) => {
          const t = Math.min(D - 1e-3, k2 / FPS), st = sceneAt(t);
          if (st.si !== lastSi) {
            if (lastSi >= 0) pctx.drawImage(out, 0, 0);
            lastSi = st.si;
          }
          await ensureMap(st.sc.map);
          if (cancelled) return;
          applyScene(st);
          await renderSettled();
          drawFrame(t, st);
        },
        onProgress: (k2, n) => {
          const p = Math.round(k2 / n * 100);
          if (p !== lastPct) {
            lastPct = p;
            setStatus("Video wird Bild für Bild berechnet – App bitte geöffnet lassen …", p);
          }
        }
      });
      if (cancelled || !blob) return;
      onDone(blob, "mp4", audioNote);
    };
    run().catch((e) => {
      if (!cancelled) {
        console.error("Saison-Video:", e);
        onError(e && e.message ? e.message : String(e));
      }
    });
    return () => {
      cancelled = true;
      try {
        if (wake) wake.release();
      } catch {
      }
      try {
        main && main.remove();
      } catch {
      }
    };
  }, []);
  return /* @__PURE__ */ React.createElement(React.Fragment, null, ReactDOM.createPortal(
    /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", left: 0, top: 0, width: W, height: H, zIndex: 1, pointerEvents: "none" }, ref: mainDivRef }),
    document.body
  ), /* @__PURE__ */ React.createElement("canvas", { ref: outRef, style: { width: "100%", maxWidth: portrait ? 340 : square ? 480 : 760, maxHeight: "62vh", aspectRatio: `${W}/${H}`, borderRadius: 12, background: "#000", display: "block", margin: "0 auto" } }));
}
function SeasonVideoDialog({ flights, mapTilerKey, onClose }) {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fromISO = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const presets = useMemo(() => {
    const now = /* @__PURE__ */ new Date(), Y = now.getFullYear(), sy = now.getMonth() >= 9 ? Y : Y - 1;
    const yy = (y) => String((y + 1) % 100).padStart(2, "0");
    const a = new Date(Y - 1, now.getMonth(), now.getDate() + 1);
    const list = [
      { id: "12m", label: "Letzte 12 Monate", from: iso(a), to: iso(now), big: "" },
      { id: "s" + sy, label: `Saison ${sy}/${yy(sy)}`, from: `${sy}-10-01`, to: `${sy + 1}-09-30`, big: `${sy}/${yy(sy)}` },
      { id: "s" + (sy - 1), label: `Saison ${sy - 1}/${yy(sy - 1)}`, from: `${sy - 1}-10-01`, to: `${sy}-09-30`, big: `${sy - 1}/${yy(sy - 1)}` },
      { id: "y" + Y, label: `Jahr ${Y}`, from: `${Y}-01-01`, to: `${Y}-12-31`, big: String(Y) },
      { id: "y" + (Y - 1), label: `Jahr ${Y - 1}`, from: `${Y - 1}-01-01`, to: `${Y - 1}-12-31`, big: String(Y - 1) }
    ];
    const has = (p) => flights.some((f) => {
      const ts = parseDateToTs(f.date || f.rawDate);
      return ts >= fromISO(p.from).getTime() && ts <= fromISO(p.to).getTime() + 86399999;
    });
    return list.filter((p, i) => i === 0 || has(p));
  }, [flights]);
  const [stage, setStage] = useState("options");
  const [poiPrm, setPoiPrm] = useState({ prom: String(SEASON_POI_DEFAULTS.prom), promLow: String(SEASON_POI_DEFAULTS.promLow), steep: String(SEASON_POI_DEFAULTS.steep), dist: String(SEASON_POI_DEFAULTS.dist) });
  const demsRef = useRef({}), poiRun = useRef(0);
  const [presetId, setPresetId] = useState(presets[0].id);
  const [fromS, setFromS] = useState(presets[0].from);
  const [toS, setToS] = useState(presets[0].to);
  const [titleS, setTitleS] = useState(null), [bigS, setBigS] = useState(null);
  const [sel, setSel] = useState("");
  const [calTrips, setCalTrips] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("reiseanalyse:tripsCache");
        const p = r && r.value ? JSON.parse(r.value) : null;
        if (p && Array.isArray(p.trips)) setCalTrips(p.trips);
      } catch {
      }
    })();
  }, []);
  const reisen = useMemo(() => {
    const ts = flights.map((f) => parseDateToTs(f.date || f.rawDate)).filter(Boolean);
    const list = [], calNames = /* @__PURE__ */ new Set();
    for (const tr of calTrips) {
      if (!tr.startDate || !tr.endDate) continue;
      const [y1, m1, d1] = tr.startDate.split("-").map(Number), [y2, m2, d2] = tr.endDate.split("-").map(Number);
      const first = new Date(y1, m1 - 1, d1).getTime();
      let last = new Date(y2, m2 - 1, d2 - (tr.allDay ? 1 : 0)).getTime();
      if (last < first) last = first;
      const n = ts.filter((x) => x >= first && x <= last).length;
      if (!n) continue;
      list.push({ key: "cal:" + tr.id, name: tr.title, type: "cal", first, last, n });
      calNames.add((tr.title || "").trim().toLowerCase());
    }
    const m = /* @__PURE__ */ new Map();
    flights.forEach((f) => {
      const n = ((f.customFields || {}).reise || "").trim(), tsf = parseDateToTs(f.date || f.rawDate);
      if (!n || !tsf || calNames.has(n.toLowerCase())) return;
      const g = m.get(n) || { key: "field:" + n, name: n, type: "field", n: 0, first: tsf, last: tsf };
      g.n++;
      g.first = Math.min(g.first, tsf);
      g.last = Math.max(g.last, tsf);
      m.set(n, g);
    });
    return [...list, ...m.values()].sort((a, b) => b.first - a.first || b.last - a.last);
  }, [flights, calTrips]);
  const selEntry = reisen.find((r) => r.key === sel) || null;
  const reise = selEntry && selEntry.type === "field" ? selEntry.name : "";
  const tripName = selEntry ? selEntry.name : "";
  const [target, setTarget] = useState(120);
  const [format, setFormat] = useState("port");
  const [purpose, setPurpose] = useState("share");
  const [mapStyle, setMapStyle] = useState("outdoor");
  const [music, setMusic] = useState(null);
  const [progress, setProgress] = useState({ text: "", pct: 0 });
  const [result, setResult] = useState(null);
  const [loopVid, setLoopVid] = useState(false);
  const [err, setErr] = useState("");
  const [shareMsg, setShareMsg] = useState("");
  const vf = useVideoFolder(RUECKBLICK_DIR);
  const cancelRef = useRef(null);
  const fromTs = fromISO(fromS).getTime(), toTs = fromISO(toS).getTime() + 86399999;
  const valid = isFinite(fromTs) && isFinite(toTs) && toTs >= fromTs;
  const stats = useMemo(() => valid ? buildSeasonStats(flights, fromTs, toTs, reise) : null, [flights, fromTs, toTs, valid, reise]);
  const pilotFirst = useMemo(() => {
    const m = /* @__PURE__ */ new Map();
    flights.forEach((f) => {
      const p = (f.pilot || "").trim().split(/\s+/)[0];
      if (p) m.set(p, (m.get(p) || 0) + 1);
    });
    const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : "";
  }, [flights]);
  const autoTitle = tripName ? tripName : pilotFirst ? /[sßxz]$/i.test(pilotFirst) ? pilotFirst + "’ Saison" : pilotFirst + "s Saison" : "Meine Saison";
  const autoBig = (() => {
    const p = presets.find((x) => x.id === presetId);
    if (p && p.big && p.from === fromS && p.to === toS) return p.big;
    return seasonDMY(fromTs) + " – " + seasonDMY(toTs);
  })();
  const meta = {
    title: (titleS != null ? titleS : autoTitle).trim() || autoTitle,
    big: (bigS != null ? bigS : autoBig).trim() || autoBig,
    period: seasonLong(fromTs) + " – " + seasonLong(toTs),
    noun: tripName ? "Reise" : "Saison"
  };
  const [mbuf, setMbuf] = useState(null), [mErr, setMErr] = useState("");
  useEffect(() => {
    let dead = false;
    setMbuf(null);
    setMErr("");
    if (!music || !music.file) return;
    decodeMusicFile(music.file).then((b) => {
      if (!dead) setMbuf(b);
    }).catch((e) => {
      if (!dead) setMErr(e.message || String(e));
    });
    return () => {
      dead = true;
    };
  }, [music && music.file]);
  const [poiRows, setPoiRows] = useState([]), [poiBusy, setPoiBusy] = useState("");
  const [sceneOpts, setSceneOpts] = useState({});
  const setOpt = (key, patch) => setSceneOpts((o) => ({ ...o, [key]: { ...o[key] || {}, ...patch } }));
  const [plan, setPlan] = useState(null);
  const mstart = music ? music.start : 0;
  useEffect(() => {
    if (!mbuf) {
      setPlan(null);
      return;
    }
    const h = setTimeout(() => {
      const remaining = Math.max(0, mbuf.duration - mstart);
      let an = null;
      try {
        an = analyzeBeats([mbuf.getChannelData(0), mbuf.numberOfChannels > 1 ? mbuf.getChannelData(1) : null], mbuf.sampleRate, mstart, Math.min(remaining, target * 1.25 + 10));
      } catch (e) {
        console.warn("Beat-Analyse:", e);
      }
      setPlan({ an, remaining, ...pickSeasonEnd(an, target, remaining) });
    }, 200);
    return () => clearTimeout(h);
  }, [mbuf, mstart, target]);
  const musicReady = !music || !!plan;
  const D = music && plan ? plan.end : target;
  const beats = music && plan && plan.an ? seasonBeatTimes(plan.an, D) : null;
  const scriptAll = useMemo(() => stats && stats.count ? buildSeasonScript(stats, D, beats, !!tripName, poiRows, sceneOpts) : [], [stats, D, plan, tripName, poiRows, sceneOpts]);
  const script = useMemo(() => scriptAll.filter((x) => !x.off), [scriptAll]);
  const summary = (() => {
    if (!script.length) return "";
    const c = script.filter((x) => x.kind === "region").length - 1, h = script.filter((x) => x.kind === "flight").length, t = script.filter((x) => x.kind === "thermal").length;
    return ["Intro", stats.home ? "Heimatregion" : "Karte", c > 0 ? c + (c === 1 ? " Land" : " Länder") : "", h ? h + (h === 1 ? " Highlight-Flug" : " Highlight-Flüge") : "", t ? t === 1 ? "Thermik in 3D" : t + " Thermik-Szenen in 3D" : "", "Abspann"].filter(Boolean).join(" · ");
  })();
  const searchPois = async () => {
    const id = ++poiRun.current;
    const prm = {};
    for (const k2 of Object.keys(SEASON_POI_DEFAULTS)) {
      const v = parseFloat(String(poiPrm[k2]).replace(",", "."));
      prm[k2] = isFinite(v) ? v : SEASON_POI_DEFAULTS[k2];
    }
    setPoiRows([]);
    const srcs = scriptAll.filter((x) => x.kind === "flight" && !x.poi && !x.excerpt).map((sc) => {
      const h = stats.highlights[sc.hi];
      return { key: sc.hi, hi: sc.hi, track: sc.track, dec: sc.dec, title: sc.title, kicker: sc.kicker, country: h ? h.r.country : "", cache: true, src: h };
    });
    if (SEASON_POI_ALL_FLIGHTS) {
      const hlIds = new Set(stats.highlights.map((h) => h.r.f.id));
      (stats.trackFlights || []).filter((x) => !hlIds.has(x.r.f.id)).sort((x, y) => y.r.sec / 3600 + y.r.alt / 1500 - (x.r.sec / 3600 + x.r.alt / 1500)).slice(0, SEASON_POI_MAX_FLIGHTS).forEach((x, i) => {
        const step = Math.max(1, Math.ceil(x.track.length / 600));
        srcs.push({
          key: "x" + i,
          hi: "x" + i,
          extra: true,
          track: x.track,
          dec: x.track.filter((_, j) => j % step === 0 || j === x.track.length - 1),
          title: x.r.site || "Flug",
          kicker: seasonDay(x.r.ts),
          country: x.r.country,
          src: x
        });
      });
    }
    const cands = [];
    for (let k2 = 0; k2 < srcs.length; k2++) {
      const sr = srcs[k2];
      setPoiBusy("Gelände " + (k2 + 1) + "/" + srcs.length + " wird analysiert …");
      try {
        let elev = sr.cache ? demsRef.current[sr.key] : void 0;
        if (elev === void 0) {
          const dem = await loadVideoDem(sr.track, mapTilerKey, 0.035);
          elev = dem ? dem.elev : null;
          if (sr.cache) demsRef.current[sr.key] = elev;
        }
        if (poiRun.current !== id) return;
        findScenicPois(sr.dec, elev, prm, 5).forEach((poi, m) => cands.push({ sr, poi, m }));
      } catch (e) {
        console.warn("Saison-Video: Sehenswürdigkeit nicht ermittelt", e);
      }
    }
    cands.sort((x, y) => y.poi.score - x.poi.score);
    const groups = [];
    for (const c of cands) {
      const g = groups.find((o) => Math.hypot((o[0].poi.lon - c.poi.lon) * 111320 * Math.cos(c.poi.lat * Math.PI / 180), (o[0].poi.lat - c.poi.lat) * 111320) < 1200);
      if (g) g.push(c);
      else groups.push([c]);
    }
    const rOf = (c) => c.sr.src && c.sr.src.r || {};
    const list = groups.map((g) => {
      const dmin = Math.min(...g.map((c) => c.poi.distM));
      return g.filter((c) => c.poi.distM <= dmin + 300).sort((x, y) => (rOf(y).alt || 0) - y.poi.elev - ((rOf(x).alt || 0) - x.poi.elev) || (rOf(y).sec || 0) - (rOf(x).sec || 0))[0];
    }).slice(0, SEASON_POI_MAX_LIST);
    const recFlights = /* @__PURE__ */ new Set(), recCountries = {};
    let recN = 0;
    list.forEach((c) => {
      const co = c.sr.country || "";
      if (recN >= SEASON_POI_REC || recFlights.has(c.sr.key) || (recCountries[co] || 0) >= 2) return;
      c.rec = true;
      recN++;
      recFlights.add(c.sr.key);
      recCountries[co] = (recCountries[co] || 0) + 1;
    });
    const nameList = await lookupPoiNames(list.map((c) => c.poi), mapTilerKey, (k2, n) => setPoiBusy("Namen werden gesucht (" + k2 + "/" + n + ") …"));
    if (poiRun.current !== id) return;
    const found = [];
    for (let k2 = 0; k2 < list.length; k2++) {
      const c = list[k2], name = nameList[k2];
      found.push({
        id: c.sr.key + ":" + c.m,
        rec: !!c.rec,
        hi: c.sr.hi,
        extra: !!c.sr.extra,
        src: c.sr.extra ? c.sr.src : null,
        flight: c.sr.title + (c.sr.country ? " (" + c.sr.country + ")" : ""),
        kicker: c.sr.kicker,
        poi: c.poi,
        name
      });
    }
    if (poiRun.current !== id) return;
    setPoiRows(found);
    setPoiBusy("");
  };
  const startVideo = () => {
    demsRef.current = {};
    setSceneOpts({});
    setPoiRows([]);
    setStage("poi");
    if (scriptAll.some((x) => x.kind === "flight" && !x.excerpt) || SEASON_POI_ALL_FLIGHTS && stats.trackFlights && stats.trackFlights.length) searchPois();
    else setPoiBusy("");
  };
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    try {
      history.pushState({ fvDialog: true }, "");
    } catch (e) {
    }
    const onPop = () => {
      if (cancelRef.current) cancelRef.current();
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      try {
        if (history.state && history.state.fvDialog) history.back();
      } catch (e) {
      }
    };
  }, []);
  useEffect(() => () => {
    if (cancelRef.current) cancelRef.current();
  }, []);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);
  const fileName = fromS + "_" + toS + "_" + (tripName ? tripName.replace(/[^0-9A-Za-zäöüÄÖÜ]+/g, "_") : "Saison");
  const chip = (active) => ({ flex: "1 1 auto", minHeight: 40, padding: "0 10px", borderRadius: 10, border: active ? "1px solid #7dd3fc" : "1px solid rgba(255,255,255,0.15)", background: active ? "rgba(125,211,252,0.2)" : "transparent", color: active ? "#7dd3fc" : "#e8f4fd", fontSize: 14, fontWeight: 700, cursor: "pointer" });
  const btn = (bg) => ({ height: 44, borderRadius: 10, border: "none", background: bg, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", padding: "0 16px" });
  const lbl = { fontSize: 12, color: "rgba(232,244,253,0.6)", marginBottom: 6 };
  const inp = { height: 40, borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(0,0,0,0.25)", color: "#e8f4fd", padding: "0 10px", fontSize: 15, boxSizing: "border-box", width: "100%", colorScheme: "dark" };
  const portrait = format === "port";
  const canShare = result && navigator.canShare && (() => {
    try {
      return navigator.canShare({ files: [new File([result.blob], `${fileName}.${result.ext}`, { type: result.blob.type })] });
    } catch {
      return false;
    }
  })();
  const canStart = valid && stats && stats.count > 0 && musicReady && !mErr;
  const musicNote = (() => {
    if (!music) return null;
    if (mErr) return mErr;
    if (!mbuf || !plan) return "Musik wird analysiert …";
    const bpm = plan.an ? Math.round(plan.an.bpm) + " BPM · " : "";
    const how = plan.natural ? "Ende mit dem Song" : plan.bars ? "endet auf Takt " + plan.bars + " (Taktanfang)" : "";
    return bpm + "Video " + seasonMMSS(plan.end) + (how ? " – " + how : "") + (plan.short ? " · Song ist kürzer als die Wunschlänge" : "") + (plan.an ? "" : " · Takt nicht erkannt");
  })();
  return ReactDOM.createPortal(
    /* @__PURE__ */ React.createElement(
      "div",
      {
        "data-no-swipe": "true",
        onTouchStart: (e) => e.stopPropagation(),
        onTouchMove: (e) => e.stopPropagation(),
        onTouchEnd: (e) => e.stopPropagation(),
        style: { position: "fixed", inset: 0, zIndex: 400, background: "#040e20", overflowY: "auto", color: "#e8f4fd", fontFamily: "inherit" }
      },
      /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 820, margin: "0 auto", padding: "18px 16px 40px", display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 18, fontWeight: 800 } }, "🎬 Saison-Rückblick"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
        if (cancelRef.current) cancelRef.current();
        onClose();
      }, style: { ...btn("rgba(255,255,255,0.1)"), height: 36 } }, "✕")), stage === "options" && /* @__PURE__ */ React.createElement(React.Fragment, null, vf.fsOk && /* @__PURE__ */ React.createElement(VideoFolderPanel, { vf, title: "📁 Gespeicherte Rückblicke", btn }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: lbl }, "Zeitraum"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, presets.map((p) => /* @__PURE__ */ React.createElement("button", { key: p.id, onClick: () => {
        setPresetId(p.id);
        setFromS(p.from);
        setToS(p.to);
      }, style: chip(presetId === p.id && p.from === fromS && p.to === toS) }, p.label))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 8 } }, /* @__PURE__ */ React.createElement("label", { style: { flex: 1, fontSize: 12, color: "rgba(232,244,253,0.6)" } }, "Von", /* @__PURE__ */ React.createElement("input", { type: "date", value: fromS, onChange: (e) => {
        if (e.target.value) {
          setFromS(e.target.value);
          setPresetId("");
        }
      }, style: inp })), /* @__PURE__ */ React.createElement("label", { style: { flex: 1, fontSize: 12, color: "rgba(232,244,253,0.6)" } }, "Bis", /* @__PURE__ */ React.createElement("input", { type: "date", value: toS, onChange: (e) => {
        if (e.target.value) {
          setToS(e.target.value);
          setPresetId("");
        }
      }, style: inp }))), (reisen.length > 0 || calTrips.length === 0) && /* @__PURE__ */ React.createElement("label", { style: { display: "block", marginTop: 8, fontSize: 12, color: "rgba(232,244,253,0.6)" } }, "Flugreise (optional)", /* @__PURE__ */ React.createElement("select", { value: sel, onChange: (e) => {
        const v = e.target.value, r = reisen.find((x) => x.key === v);
        setSel(v);
        setTitleS(null);
        if (r) {
          setFromS(iso(new Date(r.first)));
          setToS(iso(new Date(r.last)));
          setPresetId("");
        }
      }, style: inp }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Alle Flüge im Zeitraum"), reisen.map((r) => /* @__PURE__ */ React.createElement("option", { key: r.key, value: r.key }, r.name, " · ", seasonDMY(r.first), r.last !== r.first ? " – " + seasonDMY(r.last) : "", " · ", r.n, " ", r.n === 1 ? "Flug" : "Flüge"))), calTrips.length === 0 && /* @__PURE__ */ React.createElement("span", { style: { display: "block", marginTop: 4, fontSize: 11, color: "rgba(232,244,253,0.5)" } }, "Reisen aus dem Kalender erscheinen hier, sobald in Statistik → Reiseanalyse einmal synchronisiert wurde.")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, marginTop: 8, color: valid && stats && stats.count ? "#e8f4fd" : "#fca5a5" } }, !valid ? "„Bis“ muss nach „Von“ liegen." : stats.count ? `${stats.count} Flüge · ${seasonHM(stats.sec)} · ${stats.sites} ${stats.sites === 1 ? "Ort" : "Orte"} · ${stats.countriesN} ${stats.countriesN === 1 ? "Land" : "Länder"}` : "Keine Flüge in diesem Zeitraum.")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("label", { style: { flex: 1, fontSize: 12, color: "rgba(232,244,253,0.6)" } }, "Titel", /* @__PURE__ */ React.createElement("input", { value: titleS != null ? titleS : autoTitle, onChange: (e) => setTitleS(e.target.value), style: inp })), /* @__PURE__ */ React.createElement("label", { style: { flex: 1, fontSize: 12, color: "rgba(232,244,253,0.6)" } }, "Grosser Text", /* @__PURE__ */ React.createElement("input", { value: bigS != null ? bigS : autoBig, onChange: (e) => setBigS(e.target.value), style: inp }))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: lbl }, "Länge (ca.)"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, [60, 90, 120, 150, 180].map((d) => /* @__PURE__ */ React.createElement("button", { key: d, onClick: () => setTarget(d), style: chip(target === d) }, seasonMMSS(d), " min"))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", marginTop: 6, lineHeight: 1.5 } }, music ? "Mit Musik endet das Video auf einem Taktanfang in der Nähe dieser Länge; die Schnitte liegen auf den Taktschlägen." : "Ohne Musik dauert das Video genau so lange.", summary && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("br", null), summary))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: lbl }, "Format"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => setFormat("port"), style: chip(format === "port") }, "Hoch 9:16"), /* @__PURE__ */ React.createElement("button", { onClick: () => setFormat("square"), style: chip(format === "square") }, "Quadrat 1:1"), /* @__PURE__ */ React.createElement("button", { onClick: () => setFormat("land"), style: chip(format === "land") }, "Quer 16:9"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: lbl }, "Kartenstil"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, VIDEO_MAP_STYLES.map((m) => /* @__PURE__ */ React.createElement("button", { key: m.id, onClick: () => setMapStyle(m.id), style: chip(mapStyle === m.id) }, m.label)))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: lbl }, "Verwendung"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => setPurpose("share"), style: chip(purpose === "share") }, "📱 Direkt teilen"), /* @__PURE__ */ React.createElement("button", { onClick: () => setPurpose("best"), style: chip(purpose === "best") }, "🎞 Beste Qualität")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", marginTop: 6, lineHeight: 1.5 } }, purpose === "share" ? `Dateigrösse unter 50 MB (ca. ${videoSizeEstimateMB(D, "share")} MB), damit „Teilen“ funktioniert; die Bildqualität ist dafür etwas geringer.` : `Volle Bildqualität (ca. ${videoSizeEstimateMB(D, "best")} MB); fürs „Teilen“ meist zu gross – dann speichern.`)), /* @__PURE__ */ React.createElement(VideoMusicPicker, { music, setMusic, btn, note: "Die Datei bleibt auf deinem Gerät. Wähle den Startpunkt so, dass dort ein ruhiger Einstieg liegt; das Ende wird automatisch auf einen Takt gelegt." }), musicNote && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: mErr ? "#fca5a5" : "#7dd3fc" } }, "♪ ", musicNote), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", lineHeight: 1.5 } }, "Das Video wird Bild für Bild berechnet (feste 30 fps). Das dauert je nach Gerät und Länge einige Minuten — die App dabei im Vordergrund und den Bildschirm eingeschaltet lassen. Karten (Gelände oder Satellit) kommen von MapTiler (Internet nötig)."), /* @__PURE__ */ React.createElement("button", { disabled: !canStart, onClick: startVideo, style: btn(canStart ? "#16a34a" : "rgba(255,255,255,0.12)") }, "🎬 Weiter (", seasonMMSS(D), " min)")), stage === "poi" && (() => {
        const label = (x) => x.kind === "intro" ? "Intro · Weltkugel" : x.kind === "outro" ? "Abspann · Weltkugel" : x.kind === "region" ? x.kicker : x.kind === "thermal" ? (x.type === "strong" ? "STÄRKSTE THERMIK" : "LÄNGSTE THERMIK") + " · " + x.place : x.kicker + " · " + x.title;
        const fixedSum = script.reduce((a, x) => a + (x.fixed || 0), 0), nFixed = script.filter((x) => x.fixed).length;
        const numIn = { ...inp, height: 32, width: 74, textAlign: "center", padding: "0 6px" };
        return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { position: "sticky", top: 0, zIndex: 5, background: "#040e20", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.15)", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("b", { style: { fontSize: 16 } }, "⏱ Total ca. ", seasonMMSS(D), " min"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)" } }, script.length, " von ", scriptAll.length, " Szenen", nFixed ? " · " + Math.round(fixedSum) + " s fest vorgegeben" : "")), /* @__PURE__ */ React.createElement("div", { style: lbl }, "Drehbuch"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", lineHeight: 1.5 } }, "Szenen mit Haken kommen ins Video. Die Gesamtlänge bleibt (Länge bzw. Musik); abgewählte Szenen und feste Dauern verschieben die Zeit der übrigen Szenen. Die Zahlen in Intro und Abspann zählen auch bei abgewählten Länder-Szenen alle Flüge. Gesucht wird bei den Highlight-Flügen und den längsten/höchsten übrigen Flügen des Zeitraums (bis 30). Die besten Funde (max. 15) sind aufgelistet, vorgewählt sind nur die empfohlenen (höchstens einer je Flug, zwei je Land). Dauer leer lassen = automatisch. Zoom: Stufen näher (− = weiter weg)."), /* @__PURE__ */ React.createElement("details", null, /* @__PURE__ */ React.createElement("summary", { style: { fontSize: 13, cursor: "pointer", color: "#7dd3fc" } }, "🔍 Suche nach Sehenswürdigkeiten (Parameter)"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 } }, [["prom", "Gipfel: Überhöhung ab (m)"], ["promLow", "Steiler Fels: Überhöhung ab (m)"], ["steep", "Steiler Fels: Steilheit ab (1 = 45°)"], ["dist", "Max. Abstand zur Flugspur (m)"]].map(([k2, t]) => /* @__PURE__ */ React.createElement("label", { key: k2, style: { fontSize: 12, color: "rgba(232,244,253,0.6)" } }, t, /* @__PURE__ */ React.createElement("input", { type: "text", inputMode: "decimal", value: poiPrm[k2], onChange: (e) => setPoiPrm((v) => ({ ...v, [k2]: e.target.value })), style: inp })))), /* @__PURE__ */ React.createElement("button", { disabled: !!poiBusy, onClick: searchPois, style: { ...btn(poiBusy ? "rgba(255,255,255,0.12)" : "#2563eb"), marginTop: 8, width: "100%" } }, "🔍 Neu suchen")), poiBusy && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "#7dd3fc" } }, poiBusy), !poiBusy && scriptAll.some((x) => x.kind === "flight" && !x.excerpt) && !poiRows.length && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)" } }, "Keine Sehenswürdigkeit gefunden (Schwellen oben senken und neu suchen)."), scriptAll.map((x) => {
          const o = sceneOpts[x.key] || {}, fixedOk = x.kind === "intro" || x.kind === "outro";
          const edit = x.kind === "thermal" || x.kind === "flight" && x.excerpt, poiRow = x.poi ? poiRows.find((r) => r.id === x.pid) : null;
          return /* @__PURE__ */ React.createElement("div", { key: x.key, style: { display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 12px", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, background: x.off ? "transparent" : "rgba(125,211,252,0.08)", opacity: x.off ? 0.65 : 1 } }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: !x.off, disabled: fixedOk, onChange: (e) => setOpt(x.key, { on: e.target.checked }), style: { marginTop: 3, width: 18, height: 18 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, lineHeight: 1.5, flex: 1, minWidth: 0 } }, poiRow ? /* @__PURE__ */ React.createElement("input", { type: "text", value: poiRow.name, placeholder: "Name der Sehenswürdigkeit", onChange: (e) => {
            const name = e.target.value;
            setPoiRows((rows) => rows.map((r) => r.id === poiRow.id ? { ...r, name } : r));
          }, style: { ...inp, height: 32, fontWeight: 700, marginBottom: 4 } }) : /* @__PURE__ */ React.createElement("b", { style: { wordBreak: "break-word" } }, label(x)), poiRow && /* @__PURE__ */ React.createElement("div", { style: { color: "rgba(232,244,253,0.7)" } }, "SEHENSWÜRDIGKEIT beim Flug ", poiRow.flight, poiRow.rec ? " · empfohlen" : ""), /* @__PURE__ */ React.createElement("div", { style: { color: "rgba(232,244,253,0.6)" } }, x.off ? "nicht im Video" : "ab " + seasonMMSS(x.t0) + " · ca. " + Math.round(x.t1 - x.t0) + " s"), poiRow && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.5)" } }, Math.round(poiRow.poi.elev), " m ü. M. · ", Math.round(poiRow.poi.prom), " m über Umgebung · ", Math.round(poiRow.poi.distM), " m neben der Spur · ", poiRow.poi.lat.toFixed(4), "°, ", poiRow.poi.lon.toFixed(4), "°"), (edit || poiRow) && !x.off && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 } }, /* @__PURE__ */ React.createElement("label", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)", display: "flex", alignItems: "center", gap: 6 } }, "Dauer (s)", /* @__PURE__ */ React.createElement("input", { type: "text", inputMode: "decimal", value: o.dur != null ? o.dur : "", placeholder: String(Math.round(x.t1 - x.t0)), onChange: (e) => setOpt(x.key, { dur: e.target.value }), style: numIn })), /* @__PURE__ */ React.createElement("label", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)", display: "flex", alignItems: "center", gap: 6 } }, "Zoom", /* @__PURE__ */ React.createElement("input", { type: "text", inputMode: "decimal", value: o.zoom != null ? o.zoom : "", placeholder: x.poi ? "0.8" : "0", onChange: (e) => setOpt(x.key, { zoom: e.target.value }), style: numIn })))));
        }), /* @__PURE__ */ React.createElement("button", { disabled: !!poiBusy, onClick: () => {
          poiRun.current++;
          setProgress({ text: "Starte …", pct: 0 });
          setStage("render");
        }, style: btn(poiBusy ? "rgba(255,255,255,0.12)" : "#16a34a") }, "🎬 Video erstellen (", seasonMMSS(D), " min)"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
          poiRun.current++;
          setPoiBusy("");
          setStage("options");
        }, style: btn("rgba(255,255,255,0.12)") }, "Zurück"));
      })(), stage === "render" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
        SeasonVideoStudio,
        {
          script,
          stats,
          meta,
          mapTilerKey,
          format,
          purpose,
          D,
          mapStyle,
          music: music && mbuf && plan ? { buf: mbuf, start: music.start, fade: plan.natural ? 0.5 : Math.min(3, Math.max(1.2, plan.an ? plan.an.beatSec * 4 : 2)) } : null,
          onCancelRef: cancelRef,
          setStatus: (text, pct) => setProgress({ text, pct }),
          onDone: (blob, ext, note) => {
            const res = { url: URL.createObjectURL(blob), ext, blob, note };
            setResult(res);
            setStage("done");
            setShareMsg("");
            vf.setMsg("");
            if (vf.fsOk) vf.save(res, false, fileName);
          },
          onError: (m) => {
            setErr(m);
            setStage("error");
          }
        }
      ), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, textAlign: "center" } }, progress.text, " ", progress.pct, "%"), /* @__PURE__ */ React.createElement("div", { style: { height: 6, borderRadius: 3, background: "rgba(255,255,255,0.15)", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { height: "100%", width: progress.pct + "%", background: "#7dd3fc" } })), /* @__PURE__ */ React.createElement("button", { onClick: () => {
        if (cancelRef.current) cancelRef.current();
        setStage("options");
      }, style: btn("rgba(255,255,255,0.12)") }, "Abbrechen")), stage === "done" && result && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("video", { src: result.url, controls: true, playsInline: true, loop: loopVid, style: { width: "100%", maxWidth: portrait ? 340 : format === "square" ? 480 : 760, maxHeight: "62vh", margin: "0 auto", display: "block", borderRadius: 12, background: "#000" } }), /* @__PURE__ */ React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(232,244,253,0.8)" } }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: loopVid, onChange: (e) => setLoopVid(e.target.checked) }), "🔁 Wiederholen"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("button", { onClick: () => vf.saveVideo(result, fileName), style: btn("#1e40af") }, "💾 Speichern"), canShare && result.blob.size <= SHARE_MAX_BYTES && /* @__PURE__ */ React.createElement("button", { onClick: async () => {
        setShareMsg(await shareVideoFile(result.blob, `${fileName}.${result.ext}`, meta.title));
      }, style: btn("#7c3aed") }, "Teilen"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
        setResult(null);
        setStage("options");
      }, style: btn("rgba(255,255,255,0.12)") }, "Neu erstellen")), vf.msg && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: vf.msg.startsWith("✓") ? "#86efac" : "#fca5a5" } }, vf.msg), shareMsg && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#fca5a5" } }, shareMsg), result.note && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#fca5a5" } }, "⚠ ", result.note)), stage === "error" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { color: "#fca5a5", fontSize: 14, lineHeight: 1.5 } }, "Das Video konnte nicht erstellt werden:", /* @__PURE__ */ React.createElement("br", null), err), /* @__PURE__ */ React.createElement("button", { onClick: () => setStage("options"), style: btn("rgba(255,255,255,0.12)") }, "Zurück")))
    ),
    document.body
  );
}
function VideoMusicPicker({ music, setMusic, btn, note }) {
  const prevRef = useRef(null);
  const stopPreview = () => {
    try {
      if (prevRef.current) {
        prevRef.current.pause();
        URL.revokeObjectURL(prevRef.current.src);
      }
    } catch {
    }
    prevRef.current = null;
  };
  useEffect(() => stopPreview, []);
  const pickMusic = (file) => {
    stopPreview();
    if (!file) return;
    if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(file.name)) {
      window.alert("Bitte eine Audiodatei wählen (MP3, M4A, AAC, WAV, OGG, FLAC).");
      return;
    }
    const url = URL.createObjectURL(file), a = new Audio(url);
    a.onloadedmetadata = () => {
      setMusic({ file, name: file.name.replace(/\.[^.]+$/, ""), dur: isFinite(a.duration) ? a.duration : 0, start: 0 });
      URL.revokeObjectURL(url);
    };
    a.onerror = () => {
      URL.revokeObjectURL(url);
      setMusic({ file, name: file.name.replace(/\.[^.]+$/, ""), dur: 0, start: 0 });
    };
  };
  const previewMusic = () => {
    if (prevRef.current) {
      stopPreview();
      return;
    }
    if (!music) return;
    const url = URL.createObjectURL(music.file), a = new Audio(url);
    a.currentTime = music.start;
    prevRef.current = a;
    a.play().catch(() => {
    });
    setTimeout(() => {
      if (prevRef.current === a) stopPreview();
    }, 1e4);
  };
  const musicFsOk = typeof window !== "undefined" && !!window.showDirectoryPicker && !!window.fsapiHandle;
  const [lib, setLib] = useState(null);
  const [libQ, setLibQ] = useState("");
  const scanMusic = async (forcePick) => {
    try {
      let handle = forcePick ? null : await window.fsapiHandle.get("musicDir");
      if (!handle) {
        handle = await window.showDirectoryPicker({ mode: "read" });
        await window.fsapiHandle.set("musicDir", handle);
      }
      let perm = await handle.queryPermission({ mode: "read" });
      if (perm !== "granted") perm = await handle.requestPermission({ mode: "read" });
      if (perm !== "granted") {
        setLib({ items: [], folder: handle.name, busy: false, msg: "Zugriff auf den Ordner wurde nicht erlaubt." });
        return;
      }
      setLib({ items: [], folder: handle.name, busy: true, msg: "Suche läuft …" });
      const items = [];
      const walk = async (dir, path, depth) => {
        for await (const [name, h] of dir.entries()) {
          if (items.length >= 5e3) return;
          if (h.kind === "directory") {
            if (depth < 5 && !name.startsWith(".")) await walk(h, path + name + "/", depth + 1);
          } else if (/\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(name)) items.push({ name: name.replace(/\.[^.]+$/, ""), path, handle: h });
        }
      };
      await walk(handle, "", 0);
      items.sort((a, b) => a.name.localeCompare(b.name, "de"));
      setLib({ items, folder: handle.name, busy: false, msg: items.length ? "" : "Keine Audiodateien im Ordner gefunden." });
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setLib({ items: [], folder: "", busy: false, msg: "Ordner konnte nicht gelesen werden" + (e && e.message ? " (" + e.message + ")" : "") + ". Alternativ „Audiodatei wählen“ verwenden." });
    }
  };
  const chooseLibItem = async (it) => {
    try {
      pickMusic(await it.handle.getFile());
      setLib(null);
      setLibQ("");
    } catch (e) {
      setLib({ ...lib, msg: "Datei konnte nicht geöffnet werden." });
    }
  };
  const MUSIC_HINTS = ["wolken", "über den", "up up", "campari", "fly", "flying", "flug", "fliegen", "sky", "himmel", "wings", "flügel", "high", "wind", "freedom", "freiheit", "free", "cloud", "clouds", "horizon", "soar", "sun", "sonne", "blue", "above", "air", "birds", "eagle", "adler", "heaven", "horizont", "berge", "mountain", "alps", "alpen", "summer", "sommer", "wonderful", "feel", "dream", "traum"];
  const libShown = (() => {
    if (!lib) return [];
    const q = libQ.trim().toLowerCase();
    const sc = (it) => {
      const n = (it.name + " " + it.path).toLowerCase();
      return MUSIC_HINTS.reduce((a, k2) => a + (n.includes(k2) ? 1 : 0), 0);
    };
    let list = lib.items.map((it) => ({ it, sc: sc(it) }));
    if (q) list = list.filter((x) => (x.it.name + " " + x.it.path).toLowerCase().includes(q));
    else list = list.filter((x) => x.sc > 0).concat(list.filter((x) => x.sc === 0));
    if (!q) list.sort((a, b) => b.sc - a.sc);
    return list.slice(0, 60);
  })();
  const fmtMs = (t) => Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0");
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)", marginBottom: 6 } }, "Musik (optional)"), !music ? /* @__PURE__ */ React.createElement("div", { "data-no-swipe": "1", style: { display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("label", { onClick: async (e) => {
    if (!window.showOpenFilePicker) return;
    e.preventDefault();
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: "Audio", accept: { "audio/*": [".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac"] } }] });
      pickMusic(await h.getFile());
    } catch (err) {
    }
  }, style: { ...btn("rgba(255,255,255,0.12)"), flex: 1, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14 } }, "🎵 Datei wählen", /* @__PURE__ */ React.createElement("input", { type: "file", accept: ".mp3,.m4a,.aac,.wav,.ogg,.flac", style: { display: "none" }, onChange: (e) => {
    pickMusic(e.target.files && e.target.files[0]);
    e.target.value = "";
  } }))), lib && /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, fontSize: 12, color: "rgba(232,244,253,0.6)" } }, lib.busy ? "Suche läuft …" : `${lib.items.length} Titel${lib.folder ? " in „" + lib.folder + "“" : ""}`), /* @__PURE__ */ React.createElement("button", { onClick: () => scanMusic(true), style: { ...btn("rgba(255,255,255,0.12)"), height: 30, fontSize: 12, padding: "0 10px" } }, "Anderer Ordner"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
    setLib(null);
    setLibQ("");
  }, style: { ...btn("rgba(255,255,255,0.12)"), height: 30, fontSize: 12, padding: "0 10px" } }, "✕")), lib.msg && !lib.busy && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#fca5a5" } }, lib.msg), lib.items.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("input", { value: libQ, onChange: (e) => setLibQ(e.target.value), placeholder: "Suchen (Titel, Interpret, Ordner) …", style: { height: 36, borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(0,0,0,0.25)", color: "#e8f4fd", padding: "0 10px", fontSize: 14 } }), !libQ.trim() && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.5)" } }, "Zuerst Titel mit Flug-Stichwörtern (Wolken, Himmel, fly, up …), danach alphabetisch."), /* @__PURE__ */ React.createElement("div", { style: { maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 } }, libShown.map(({ it, sc }, i) => /* @__PURE__ */ React.createElement("button", { key: i, onClick: () => chooseLibItem(it), style: { textAlign: "left", border: "none", borderRadius: 8, background: sc > 0 && !libQ.trim() ? "rgba(125,211,252,0.15)" : "rgba(255,255,255,0.06)", color: "#e8f4fd", padding: "7px 10px", fontSize: 13, cursor: "pointer" } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.name), it.path && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.path))), !libShown.length && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.5)" } }, "Keine Treffer."))))) : /* @__PURE__ */ React.createElement("div", { "data-no-swipe": "1", style: { border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, "🎵 ", music.name), /* @__PURE__ */ React.createElement("button", { onClick: previewMusic, style: { ...btn("rgba(255,255,255,0.12)"), height: 34, fontSize: 13 } }, "▶ Vorhören"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
    stopPreview();
    setMusic(null);
  }, style: { ...btn("rgba(255,255,255,0.12)"), height: 34, fontSize: 13 } }, "✕")), music.dur > 8 && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)" } }, "Start im Song: ", fmtMs(music.start), " von ", fmtMs(music.dur)), /* @__PURE__ */ React.createElement("input", { type: "range", min: 0, max: Math.floor(music.dur - 5), step: 1, value: music.start, onChange: (e) => {
    stopPreview();
    setMusic({ ...music, start: +e.target.value });
  }, style: { width: "100%" } })), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.5)" } }, note || "Wird auf die Videolänge zugeschnitten, am Anfang eingeblendet und am Ende ausgeblendet. Die Datei bleibt auf deinem Gerät.")));
}
function FlightVideoDialog({ flight, track, mapTilerKey, onClose }) {
  const [stage, setStage] = useState("options");
  const [duration, setDuration] = useState(45);
  const [format, setFormat] = useState("land");
  const [purpose, setPurpose] = useState("share");
  const [mapStyle, setMapStyle] = useState("sat");
  const [miniStyle, setMiniStyle] = useState("outdoor");
  const portrait = format === "port";
  const [mode, setMode] = useState("auto");
  const [segs, setSegs] = useState([]);
  const [pending, setPending] = useState({ a: null, b: null });
  const [mspeed, setMspeed] = useState(10);
  const [cursor, setCursor] = useState(track[0].timeSec);
  const manualSecs = segs.reduce((s, x) => s + videoSegSeconds(x), 0);
  const demRef = useRef(null);
  const [editId, setEditId] = useState(null);
  const [sugg, setSugg] = useState({ state: "idle", list: [], autoIds: [], msg: "" });
  const snapSpeed = (flightSec) => {
    const raw = Math.max(1, flightSec / 9);
    let best = VIDEO_SPEEDS[0];
    for (const sp of VIDEO_SPEEDS) if (Math.abs(Math.log(sp / raw)) < Math.abs(Math.log(best / raw))) best = sp;
    return best;
  };
  const toSegment = (cd) => ({
    id: Date.now() + Math.random(),
    f0: cd.f0,
    f1: cd.f1,
    speed: snapSpeed(cd.f1 - cd.f0),
    label: cd.label || "",
    kind: cd.kind,
    bSide: cd.bSide,
    heading: cd.heading,
    lat: cd.lat,
    lon: cd.lon
  });
  const addSugg = (cd) => {
    const ex = segs.find((s) => Math.abs(s.f0 - cd.f0) < 1 && Math.abs(s.f1 - cd.f1) < 1);
    if (ex) {
      setEditId(ex.id);
      return;
    }
    const sg = toSegment(cd);
    setSegs((list) => [...list, sg].sort((x, y) => x.f0 - y.f0));
    setEditId(sg.id);
  };
  const adoptAuto = () => setSegs((list) => {
    const add = sugg.list.filter((cd) => sugg.autoIds.includes(cd.id) && !list.some((s) => Math.abs(s.f0 - cd.f0) < 1 && Math.abs(s.f1 - cd.f1) < 1)).map(toSegment);
    return [...list, ...add].sort((x, y) => x.f0 - y.f0);
  });
  const loadSugg = async () => {
    setSugg((s) => ({ ...s, state: "loading", msg: "" }));
    try {
      if (!demRef.current) {
        let dem = null;
        try {
          dem = await loadVideoDem(track, mapTilerKey);
        } catch (e) {
          console.warn("Flug-Video: Geländedaten nicht verfügbar", e);
        }
        demRef.current = dem || { elev: null, tiles: 0, z: 0 };
      }
      await new Promise((r) => setTimeout(r, 30));
      const elev = demRef.current.elev;
      const cands = computeVideoHighlights(track, elev, 8, false);
      const auto = computeVideoHighlights(track, elev, 3, true);
      const n = track.length, t0 = track[0].timeSec, t1 = track[n - 1].timeSec, total = t1 - t0;
      const sL = Math.min(70, total * 0.08), lL = Math.min(80, total * 0.1);
      const mk = (cd) => ({ ...cd, id: cd.kind + "_" + Math.round(cd.f0) });
      const startC = mk({ kind: "start", label: "START" + (flight?.site ? " · " + flight.site : ""), f0: t0, f1: t0 + sL, center: t0 + sL / 2, score: 0 });
      const landC = mk({ kind: "land", label: "LANDUNG", f0: t1 - lL, f1: t1, center: t1 - lL / 2, score: 0 });
      const list = [startC, ...cands.map(mk), landC].sort((x, y) => x.center - y.center);
      setSugg({
        state: "done",
        list,
        autoIds: [startC.id, ...auto.map((a) => mk(a).id), landC.id],
        msg: elev ? "" : "Ohne Geländedaten werden Thermik am Berg, Hangflug und Gipfelüberflug nur eingeschränkt erkannt."
      });
    } catch (e) {
      console.error("Flug-Video: Vorschläge", e);
      setSugg((s) => ({ ...s, state: "error", msg: "Vorschläge konnten nicht berechnet werden: " + (e.message || e) }));
    }
  };
  const [fOpts, setFOpts] = useState({});
  const setFOpt = (key, patch) => setFOpts((o) => ({ ...o, [key]: { ...o[key] || {}, ...patch } }));
  const [fEv, setFEv] = useState(null);
  const [fPois, setFPois] = useState([]);
  const [fBusy, setFBusy] = useState("");
  const [fPrm, setFPrm] = useState({ prom: String(SEASON_POI_DEFAULTS.prom), promLow: String(SEASON_POI_DEFAULTS.promLow), steep: String(SEASON_POI_DEFAULTS.steep), dist: String(SEASON_POI_DEFAULTS.dist) });
  const fRun = useRef(0), demWideRef = useRef(null);
  const searchFPoi = async (elev, id) => {
    const prm = {};
    for (const k2 of Object.keys(SEASON_POI_DEFAULTS)) {
      const v = parseFloat(String(fPrm[k2]).replace(",", "."));
      prm[k2] = isFinite(v) ? v : SEASON_POI_DEFAULTS[k2];
    }
    setFPois([]);
    const step = Math.max(1, Math.ceil(track.length / 600)), dec = track.filter((_, i) => i % step === 0 || i === track.length - 1);
    const pois = elev ? findScenicPois(dec, elev, prm, 5) : [];
    if (!pois.length) return;
    const names = await lookupPoiNames(pois, mapTilerKey, (k2, n) => setFBusy("Namen werden gesucht (" + k2 + "/" + n + ") …"));
    if (fRun.current !== id) return;
    setFPois(pois.map((poi, i) => ({ poi, name: names[i] })));
  };
  const prepScript = async () => {
    const id = ++fRun.current;
    setStage("script");
    setFOpts({});
    setFEv(null);
    setFPois([]);
    setFBusy("Gelände wird analysiert …");
    try {
      if (!demWideRef.current) {
        let dem = null;
        try {
          dem = await loadVideoDem(track, mapTilerKey, 0.035);
        } catch (e) {
          console.warn("Flug-Video: Geländedaten nicht verfügbar", e);
        }
        demWideRef.current = dem || { elev: null, tiles: 0, z: 0 };
        if (!demRef.current) demRef.current = demWideRef.current;
      }
      if (fRun.current !== id) return;
      const elev = demWideRef.current.elev;
      const maxPicks = duration >= 90 ? 5 : duration >= 60 ? 4 : duration >= 45 ? 3 : 2;
      const mk = (cd) => ({ ...cd, id: cd.kind + "_" + Math.round(cd.f0) });
      const list = computeVideoHighlights(track, elev, 8, false).map(mk);
      const autoIds = computeVideoHighlights(track, elev, maxPicks, true).map((a) => mk(a).id);
      setFEv({ list, autoIds });
      await searchFPoi(elev, id);
    } catch (e) {
      console.error("Flug-Video: Drehbuch", e);
    }
    if (fRun.current === id) setFBusy("");
  };
  const fEvents = useMemo(() => {
    if (!fEv) return null;
    const ev = fEv.list.map((c) => ({ ...c, key: "ev:" + c.id, defOn: fEv.autoIds.includes(c.id) }));
    fPois.forEach((fp, k2) => {
      const q = fp.poi, mLon = 111320 * Math.cos(q.lat * Math.PI / 180);
      let ci = 0, cd = 1e18;
      track.forEach((x, i) => {
        const d = Math.hypot((x.lon - q.lon) * mLon, (x.lat - q.lat) * 111320);
        if (d < cd) {
          cd = d;
          ci = i;
        }
      });
      const tc = track[ci].timeSec;
      ev.push({
        kind: "poi",
        key: "poi:" + k2,
        pk: k2,
        defOn: k2 === 0,
        score: 5,
        center: tc,
        f0: Math.max(track[0].timeSec, tc - 150),
        f1: Math.min(track[track.length - 1].timeSec, tc + 150),
        lat: q.lat,
        lon: q.lon,
        poi: q,
        name: fp.name,
        label: "SEHENSWÜRDIGKEIT" + (fp.name ? " · " + fp.name : "")
      });
    });
    return ev.sort((a, b) => a.center - b.center);
  }, [fEv, fPois, track]);
  const fScript = useMemo(() => fEvents ? buildVideoScript(track, fEvents, duration, flight, fOpts) : null, [fEvents, fOpts, duration, track, flight]);
  const [progress, setProgress] = useState({ text: "", pct: 0 });
  const [result, setResult] = useState(null);
  const [loopVid, setLoopVid] = useState(false);
  const [err, setErr] = useState("");
  const cancelRef = useRef(null);
  const [music, setMusic] = useState(null);
  const [shareMsg, setShareMsg] = useState("");
  const vf = useVideoFolder(FLUEGE_DIR);
  const segsRef = useRef(segs);
  segsRef.current = segs;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    try {
      history.pushState({ fvDialog: true }, "");
    } catch (e) {
    }
    const onPop = () => {
      if (segsRef.current.length && !window.confirm("Video-Dialog schliessen? Die erfassten Abschnitte gehen verloren.")) {
        try {
          history.pushState({ fvDialog: true }, "");
        } catch (e) {
        }
        return;
      }
      if (cancelRef.current) cancelRef.current();
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      try {
        if (history.state && history.state.fvDialog) history.back();
      } catch (e) {
      }
    };
  }, []);
  useEffect(() => () => {
    if (cancelRef.current) cancelRef.current();
  }, []);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);
  const dm = String(flight?.date || "").match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/), tm = String(flight?.startTime || "").match(/(\d{1,2}):(\d{2})/);
  const fileName = `${dm ? `${dm[3].length === 2 ? "20" + dm[3] : dm[3]}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}` : "Flug"}${tm ? "_" + tm[1].padStart(2, "0") + tm[2] : ""}_${(flight?.site || "").replace(/[^0-9A-Za-zäöüÄÖÜ]+/g, "_")}_${String(flight?.id).slice(-6)}`;
  const chip = (active) => ({ flex: 1, height: 40, borderRadius: 10, border: active ? "1px solid #7dd3fc" : "1px solid rgba(255,255,255,0.15)", background: active ? "rgba(125,211,252,0.2)" : "transparent", color: active ? "#7dd3fc" : "#e8f4fd", fontSize: 14, fontWeight: 700, cursor: "pointer" });
  const btn = (bg) => ({ height: 44, borderRadius: 10, border: "none", background: bg, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", padding: "0 16px" });
  const canShare = result && navigator.canShare && (() => {
    try {
      return navigator.canShare({ files: [new File([result.blob], `${fileName}.${result.ext}`, { type: result.blob.type })] });
    } catch {
      return false;
    }
  })();
  return ReactDOM.createPortal(
    // data-no-swipe + stopPropagation: Der Dialog hängt per Portal am body, React
    // leitet seine Touch-Ereignisse aber an die Detailseite weiter, deren
    // Wisch-Geste sonst beim Ziehen des Cursors zum vorigen/nächsten Flug wechselt.
    /* @__PURE__ */ React.createElement(
      "div",
      {
        "data-no-swipe": "true",
        onTouchStart: (e) => e.stopPropagation(),
        onTouchMove: (e) => e.stopPropagation(),
        onTouchEnd: (e) => e.stopPropagation(),
        style: { position: "fixed", inset: 0, zIndex: 400, background: "#040e20", overflowY: "auto", color: "#e8f4fd", fontFamily: "inherit" }
      },
      /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 820, margin: "0 auto", padding: "18px 16px 40px", display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 18, fontWeight: 800 } }, "🎬 Flug-Video"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
        if (cancelRef.current) cancelRef.current();
        onClose();
      }, style: { ...btn("rgba(255,255,255,0.1)"), height: 36 } }, "✕")), stage === "options" && /* @__PURE__ */ React.createElement(React.Fragment, null, vf.fsOk && /* @__PURE__ */ React.createElement(VideoFolderPanel, { vf, title: "📁 Gespeicherte Flug-Videos", btn, isMine: (n) => n.includes("_" + String(flight?.id).slice(-6) + ".") }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => setMode("auto"), style: chip(mode === "auto") }, "Automatisch"), /* @__PURE__ */ React.createElement("button", { onClick: () => setMode("manual"), style: chip(mode === "manual") }, "Manuell")), mode === "auto" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "rgba(232,244,253,0.75)", lineHeight: 1.5 } }, "Erzeugt ein kurzes Video mit 3D-Satellitenkarte und wechselnden Kameras: Start → Highlights (starke Thermik, Hang-/Gratflug, Gipfelüberflug, Talquerung …) → Landung. In der Ecke läuft eine Geländekarte von oben mit dem Positionspunkt mit."), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)", marginBottom: 6 } }, "Länge"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, [30, 45, 60, 90].map((d) => /* @__PURE__ */ React.createElement("button", { key: d, onClick: () => setDuration(d), style: chip(duration === d) }, d === 90 ? "1:30 min" : d + " s"))))) : /* @__PURE__ */ React.createElement(
        FlightVideoRangeEditor,
        {
          track,
          segments: segs,
          setSegments: setSegs,
          pending,
          setPending,
          cursor,
          setCursor,
          speed: mspeed,
          setSpeed: setMspeed,
          sugg,
          onLoadSugg: loadSugg,
          onAddSugg: addSugg,
          onAdoptAuto: adoptAuto,
          editId,
          setEditId
        }
      ), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)", marginBottom: 6 } }, "Format"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => setFormat("land"), style: chip(format === "land") }, "Quer 16:9"), /* @__PURE__ */ React.createElement("button", { onClick: () => setFormat("port"), style: chip(format === "port") }, "Hoch 9:16"), /* @__PURE__ */ React.createElement("button", { onClick: () => setFormat("square"), style: chip(format === "square") }, "Quadrat 1:1"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)", marginBottom: 6 } }, "Kartenstil"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, VIDEO_MAP_STYLES.map((m) => /* @__PURE__ */ React.createElement("button", { key: m.id, onClick: () => setMapStyle(m.id), style: chip(mapStyle === m.id) }, m.label))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)", margin: "10px 0 6px" } }, "Minikarte"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, VIDEO_MAP_STYLES.map((m) => /* @__PURE__ */ React.createElement("button", { key: m.id, onClick: () => setMiniStyle(m.id), style: chip(miniStyle === m.id) }, m.label)))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)", marginBottom: 6 } }, "Verwendung"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => setPurpose("share"), style: chip(purpose === "share") }, "📱 Direkt teilen"), /* @__PURE__ */ React.createElement("button", { onClick: () => setPurpose("best"), style: chip(purpose === "best") }, "🎞 Beste Qualität")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", marginTop: 6, lineHeight: 1.5 } }, (() => {
        const dd = mode === "manual" ? Math.max(1, manualSecs) : duration;
        return purpose === "share" ? `Dateigrösse unter 50 MB (ca. ${videoSizeEstimateMB(dd, "share")} MB), damit „Teilen“ funktioniert; die Bildqualität ist dafür etwas geringer.` : `Volle Bildqualität (ca. ${videoSizeEstimateMB(dd, "best")} MB); fürs „Teilen“ meist zu gross – dann speichern.`;
      })())), /* @__PURE__ */ React.createElement(VideoMusicPicker, { music, setMusic, btn }), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", lineHeight: 1.5 } }, "Ablauf: Zuerst werden die Karten vorgeladen (ca. 20–90 s), dann wird das Video in Echtzeit aufgenommen (", mode === "manual" ? Math.round(manualSecs) : duration, " s). Während dieser Zeit die App im Vordergrund und den Bildschirm eingeschaltet lassen."), /* @__PURE__ */ React.createElement("button", { disabled: mode === "manual" && (!segs.length || manualSecs > 300), onClick: () => {
        if (mode === "auto") {
          prepScript();
          return;
        }
        setProgress({ text: "Starte …", pct: 0 });
        setStage("render");
      }, style: { ...btn(mode === "manual" && (!segs.length || manualSecs > 300) ? "rgba(255,255,255,0.12)" : "#16a34a") } }, mode === "manual" && !segs.length ? "Erst Abschnitte hinzufügen" : mode === "auto" ? "Weiter zum Drehbuch" : "Video erstellen")), stage === "script" && (() => {
        const all = fScript ? fScript.all : [], act = fScript || [];
        const fixedSum = act.reduce((a, x) => a + (x.fixed || 0), 0);
        const numIn = { textAlign: "center", padding: "0 6px" };
        return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { position: "sticky", top: 0, zIndex: 5, background: "#040e20", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.15)", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("b", { style: { fontSize: 16 } }, "⏱ Total ca. ", seasonMMSS(duration), " min"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)" } }, act.length, " von ", all.length, " Szenen", fixedSum ? " · " + Math.round(fixedSum) + " s fest vorgegeben" : "")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700 } }, "Drehbuch"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.55)", lineHeight: 1.5 } }, "Szenen mit Haken kommen ins Video. Die Gesamtlänge bleibt wie gewählt; abgewählte Szenen und feste Dauern verschieben die Zeit der übrigen Szenen. Alle gefundenen Sehenswürdigkeiten sind aufgelistet, vorgewählt ist nur die empfohlene. Dauer leer lassen = automatisch. Zoom: Stufen näher (− = weiter weg)."), /* @__PURE__ */ React.createElement("details", null, /* @__PURE__ */ React.createElement("summary", { style: { fontSize: 13, cursor: "pointer", color: "#7dd3fc" } }, "🔍 Suche nach Sehenswürdigkeiten (Parameter)"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 } }, [["prom", "Gipfel: Überhöhung ab (m)"], ["promLow", "Steiler Fels: Überhöhung ab (m)"], ["steep", "Steiler Fels: Steilheit ab (1 = 45°)"], ["dist", "Max. Abstand zur Flugspur (m)"]].map(([k2, t]) => /* @__PURE__ */ React.createElement("label", { key: k2, style: { fontSize: 12, color: "rgba(232,244,253,0.6)" } }, t, /* @__PURE__ */ React.createElement("input", { type: "text", inputMode: "decimal", value: fPrm[k2], onChange: (e) => setFPrm((v) => ({ ...v, [k2]: e.target.value })), style: { width: "100%", height: 40, borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(0,0,0,0.25)", color: "#e8f4fd", padding: "0 10px", fontSize: 15, boxSizing: "border-box" } })))), /* @__PURE__ */ React.createElement("button", { disabled: !!fBusy || !fEv, onClick: async () => {
          const id = ++fRun.current;
          setFBusy("Suche läuft …");
          await searchFPoi(demWideRef.current && demWideRef.current.elev, id);
          if (fRun.current === id) setFBusy("");
        }, style: { ...btn(fBusy || !fEv ? "rgba(255,255,255,0.12)" : "#2563eb"), marginTop: 8, width: "100%" } }, "🔍 Neu suchen")), fBusy && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "#7dd3fc" } }, fBusy), !fBusy && fEv && !fPois.length && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)" } }, "Keine Sehenswürdigkeit gefunden (Schwellen oben senken und neu suchen)."), !fBusy && fEv && !fEv.list.length && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)" } }, "Keine weiteren Highlights erkannt", demWideRef.current && demWideRef.current.elev ? "" : " (ohne Geländedaten nur eingeschränkt)", "."), all.map((x) => {
          const o = fOpts[x.key] || {}, fixedOk = x.kind === "start" || x.kind === "land" || x.kind === "outro";
          const isPoi = x.kind === "poi", edit = !fixedOk;
          return /* @__PURE__ */ React.createElement("div", { key: x.key, style: { display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 12px", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, background: x.off ? "transparent" : "rgba(125,211,252,0.08)", opacity: x.off ? 0.65 : 1 } }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: !x.off, disabled: fixedOk, onChange: (e) => setFOpt(x.key, { on: e.target.checked }), style: { marginTop: 3, width: 18, height: 18 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, lineHeight: 1.5, flex: 1, minWidth: 0 } }, isPoi ? /* @__PURE__ */ React.createElement("input", { type: "text", value: fPois[x.pk] ? fPois[x.pk].name : "", placeholder: "Name der Sehenswürdigkeit", onChange: (e) => {
            const name = e.target.value;
            setFPois((v) => v.map((q, j) => j === x.pk ? { ...q, name } : q));
          }, style: { width: "100%", height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(0,0,0,0.25)", color: "#e8f4fd", padding: "0 10px", fontSize: 15, fontWeight: 700, boxSizing: "border-box", marginBottom: 4 } }) : /* @__PURE__ */ React.createElement("b", { style: { wordBreak: "break-word" } }, x.label), isPoi && /* @__PURE__ */ React.createElement("div", { style: { color: "rgba(232,244,253,0.7)" } }, "SEHENSWÜRDIGKEIT", x.pk === 0 ? " · empfohlen" : ""), /* @__PURE__ */ React.createElement("div", { style: { color: "rgba(232,244,253,0.6)" } }, x.off ? "nicht im Video" : "ab " + seasonMMSS(x.t0) + " · ca. " + Math.round(x.d) + " s"), isPoi && fPois[x.pk] && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.5)" } }, Math.round(fPois[x.pk].poi.elev), " m ü. M. · ", Math.round(fPois[x.pk].poi.prom), " m über Umgebung · ", Math.round(fPois[x.pk].poi.distM), " m neben der Spur · ", fPois[x.pk].poi.lat.toFixed(4), "°, ", fPois[x.pk].poi.lon.toFixed(4), "°"), edit && !x.off && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 } }, /* @__PURE__ */ React.createElement("label", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)", display: "flex", alignItems: "center", gap: 6 } }, "Dauer (s)", /* @__PURE__ */ React.createElement("input", { type: "text", inputMode: "decimal", value: o.dur != null ? o.dur : "", placeholder: String(Math.round(x.d)), onChange: (e) => setFOpt(x.key, { dur: e.target.value }), style: { ...numIn, width: 74, height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(0,0,0,0.25)", color: "#e8f4fd", fontSize: 15, boxSizing: "border-box" } })), /* @__PURE__ */ React.createElement("label", { style: { fontSize: 12, color: "rgba(232,244,253,0.6)", display: "flex", alignItems: "center", gap: 6 } }, "Zoom", /* @__PURE__ */ React.createElement("input", { type: "text", inputMode: "decimal", value: o.zoom != null ? o.zoom : "", placeholder: isPoi ? "0.8" : "0", onChange: (e) => setFOpt(x.key, { zoom: e.target.value }), style: { ...numIn, width: 74, height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(0,0,0,0.25)", color: "#e8f4fd", fontSize: 15, boxSizing: "border-box" } })))));
        }), /* @__PURE__ */ React.createElement("button", { disabled: !!fBusy || !fScript, onClick: () => {
          fRun.current++;
          setProgress({ text: "Starte …", pct: 0 });
          setStage("render");
        }, style: btn(fBusy || !fScript ? "rgba(255,255,255,0.12)" : "#16a34a") }, "🎬 Video erstellen (", seasonMMSS(duration), " min)"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
          fRun.current++;
          setFBusy("");
          setStage("options");
        }, style: btn("rgba(255,255,255,0.12)") }, "Zurück"));
      })(), stage === "render" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
        FlightVideoStudio,
        {
          flight,
          track,
          mapTilerKey,
          duration,
          format,
          purpose,
          music,
          demCache: demRef,
          mapStyle,
          miniStyle,
          events: mode === "auto" ? fEvents : null,
          scriptOpts: fOpts,
          manual: mode === "manual" ? [...segs].sort((x, y) => x.f0 - y.f0) : null,
          onCancelRef: cancelRef,
          setStatus: (text, pct) => setProgress({ text, pct }),
          onDone: (blob, ext, note) => {
            const res = { url: URL.createObjectURL(blob), ext, blob };
            setResult(res);
            setStage("done");
            setShareMsg("");
            vf.setMsg(note ? "⚠ " + note : "");
            if (vf.fsOk) vf.save(res, false, fileName);
          },
          onError: (m) => {
            setErr(m);
            setStage("error");
          }
        }
      ), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, textAlign: "center" } }, progress.text, " ", progress.pct, "%"), /* @__PURE__ */ React.createElement("div", { style: { height: 6, borderRadius: 3, background: "rgba(255,255,255,0.15)", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { height: "100%", width: progress.pct + "%", background: "#7dd3fc" } })), /* @__PURE__ */ React.createElement("button", { onClick: () => {
        if (cancelRef.current) cancelRef.current();
        setStage("options");
      }, style: btn("rgba(255,255,255,0.12)") }, "Abbrechen")), stage === "done" && result && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("video", { src: result.url, controls: true, playsInline: true, loop: loopVid, style: { width: "100%", maxWidth: portrait ? 340 : format === "square" ? 480 : 760, maxHeight: "62vh", margin: "0 auto", display: "block", borderRadius: 12, background: "#000" } }), /* @__PURE__ */ React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(232,244,253,0.8)" } }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: loopVid, onChange: (e) => setLoopVid(e.target.checked) }), "🔁 Wiederholen"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("button", { onClick: () => vf.saveVideo(result, fileName), style: btn("#1e40af") }, "💾 Speichern"), canShare && result.blob.size <= SHARE_MAX_BYTES && /* @__PURE__ */ React.createElement("button", { onClick: async () => {
        setShareMsg(await shareVideoFile(result.blob, `${fileName}.${result.ext}`, "Mein Flug"));
      }, style: btn("#7c3aed") }, "Teilen"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
        setResult(null);
        setStage("options");
      }, style: btn("rgba(255,255,255,0.12)") }, "Neu erstellen")), vf.msg && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: vf.msg.startsWith("✓") ? "#86efac" : "#fca5a5" } }, vf.msg), shareMsg && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#fca5a5" } }, shareMsg)), stage === "error" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { color: "#fca5a5", fontSize: 14, lineHeight: 1.5 } }, "Das Video konnte nicht erstellt werden:", /* @__PURE__ */ React.createElement("br", null), err), /* @__PURE__ */ React.createElement("button", { onClick: () => setStage("options"), style: btn("rgba(255,255,255,0.12)") }, "Zurück")))
    ),
    document.body
  );
}
function FlightMap({ flight, highlightRange, onPlaybackPositionChange, onPlaybackActiveChange, onPlaybackPhaseChange, controlsSlot, isWide, mapTilerKey, onFullscreenProfileSlot, scrubDistanceKm }) {
  const previewDivRef = useRef(null);
  const previewMapRef = useRef(null);
  const previewRefMarkerRef = useRef(null);
  const previewReadyRef = useRef(false);
  const fullDivRef = useRef(null);
  const fullMapRef = useRef(null);
  const fullRefMarkerRef = useRef(null);
  const fullReadyRef = useRef(false);
  const fullLiftRef = useRef([]);
  const previewDistanceMarkersRef = useRef([]);
  const fullDistanceMarkersRef = useRef([]);
  const previewClimbSinkMarkersRef = useRef([]);
  const fullClimbSinkMarkersRef = useRef([]);
  const previewScrubMarkerRef = useRef(null);
  const fullScrubMarkerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsPitch, setFsPitch] = useState(0);
  const isLandscapePhone = useIsLandscapePhone();
  const [gliderIcon, setGliderIcon] = useState(() => {
    const d = GLIDER_VARIANTS.find((v) => v.id === DEFAULT_GLIDER_VARIANT) || GLIDER_VARIANTS[0];
    return { type: d.type, value: d.type === "image" ? d.dataUrl : d.char };
  });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await window.storage.get("gliderVariant");
        const id = r ? r.value : DEFAULT_GLIDER_VARIANT;
        const found = GLIDER_VARIANTS.find((v) => v.id === id) || GLIDER_VARIANTS.find((v) => v.id === DEFAULT_GLIDER_VARIANT);
        let value = found.type === "image" ? found.dataUrl : found.char;
        if (found.id === "custom") {
          try {
            const c = await window.storage.get("gliderCustomChar");
            value = c && c.value ? c.value : "★";
          } catch (e) {
          }
        }
        if (!cancelled) setGliderIcon({ type: found.type, value });
      } catch (e) {
        console.error("Load error (gliderVariant):", e);
      }
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, []);
  const [isPlaying, setIsPlaying] = useState(false);
  useEffect(() => {
    if (onPlaybackActiveChange) onPlaybackActiveChange(isPlaying);
  }, [isPlaying]);
  const [playSpeed, setPlaySpeed] = useState(10);
  const [playPickerOpen, setPlayPickerOpen] = useState(false);
  const [playElapsedSec, setPlayElapsedSec] = useState(0);
  const playMarkerRef = useRef(null);
  const previewPlayMarkerRef = useRef(null);
  const playRafRef = useRef(null);
  const playLastTsRef = useRef(null);
  const circlingStateRef = useRef(false);
  const [showDistance, setShowDistance] = useState(false);
  const [showClimbSink, setShowClimbSink] = useState(false);
  const [showMonitor, setShowMonitor] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const togglePlay = () => setIsPlaying((p) => !p);
  const track = flight?.track || [];
  const sP = flight?.startPt, eP = flight?.endPt;
  const hasMap = track.length > 0 || sP && eP;
  const cleanTrack = useMemo(() => {
    if (track.length < 3) return track;
    const median = (arr) => {
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const medLat = median(track.map((p) => p.lat)), medLon = median(track.map((p) => p.lon));
    const filtered = track.filter((p) => Math.abs(p.lat - medLat) <= 0.5 && Math.abs(p.lon - medLon) <= 0.5);
    return filtered.length ? filtered : track;
  }, [track]);
  const distanceRoute = useMemo(() => {
    const trace = cleanTrack.length ? cleanTrack : track;
    if (trace.length > 1) return computeDistanceRoute(trace);
    if (sP && eP) return { points: [sP, eP], km: +(haversineDistKm(sP, eP) || 0).toFixed(1) };
    return null;
  }, [cleanTrack, track, sP, eP]);
  const climbSinkPoints = useMemo(() => {
    const trace = cleanTrack.length ? cleanTrack : track;
    if (trace.length < 2) return null;
    return computeClimbSinkPoints(trace, CLIMB_WINDOW_SEC);
  }, [cleanTrack, track]);
  const cumDist = useMemo(() => {
    const arr = new Array(track.length).fill(0);
    for (let i = 1; i < track.length; i++) arr[i] = arr[i - 1] + (haversineDistKm(track[i - 1], track[i]) || 0);
    return arr;
  }, [track]);
  const monitorIndex = useMemo(() => {
    if (!showMonitor || !track.length || !cumDist.length) return null;
    if (isPlaying || playElapsedSec > 0) {
      const targetTime = track[0].timeSec + playElapsedSec;
      let i = 0;
      while (i < track.length - 2 && track[i + 1].timeSec < targetTime) i++;
      return i;
    }
    const targetDist = highlightRange && highlightRange.center != null ? highlightRange.center : (cumDist[cumDist.length - 1] || 0) / 2;
    let bestIdx = 0, bestDiff = Infinity;
    for (let i = 0; i < cumDist.length; i++) {
      const diff = Math.abs(cumDist[i] - targetDist);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    return bestIdx;
  }, [showMonitor, track, cumDist, isPlaying, playElapsedSec, highlightRange]);
  const monitorInfo = useMemo(() => {
    if (monitorIndex == null) return null;
    const alt = track[monitorIndex]?.gpsAlt;
    if (alt == null) return null;
    const t0 = track[monitorIndex].timeSec;
    let lo = monitorIndex, hi = monitorIndex;
    while (lo > 0 && t0 - track[lo - 1].timeSec < CLIMB_WINDOW_SEC) lo--;
    while (hi < track.length - 1 && track[hi + 1].timeSec - t0 < CLIMB_WINDOW_SEC) hi++;
    const dt = track[hi].timeSec - track[lo].timeSec;
    const speedKmh = dt > 0 ? (haversineDistKm(track[lo], track[hi]) || 0) / (dt / 3600) : 0;
    const varioMs = dt > 0 ? (track[hi].gpsAlt - track[lo].gpsAlt) / dt : 0;
    return { alt, speedKmh, varioMs };
  }, [monitorIndex, track]);
  const { segment, refPoint, heading } = useMemo(() => {
    if (!highlightRange || highlightRange.start == null || track.length < 2) return { segment: null, refPoint: null, heading: 0 };
    let acc = 0;
    const seg = [];
    if (acc >= highlightRange.start - 0.05 && acc <= highlightRange.end + 0.05) seg.push(track[0]);
    let bestIdx = 0, bestDiff = Math.abs(0 - highlightRange.center);
    for (let i = 1; i < track.length; i++) {
      acc += haversineDistKm(track[i - 1], track[i]) || 0;
      if (acc >= highlightRange.start - 0.05 && acc <= highlightRange.end + 0.05) seg.push(track[i]);
      const diff = Math.abs(acc - highlightRange.center);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    const spanBack = track[Math.max(0, bestIdx - 3)];
    const spanFwd = track[Math.min(track.length - 1, bestIdx + 3)];
    const heading2 = bearingDeg(spanBack, spanFwd);
    return { segment: seg.length > 1 ? seg : null, refPoint: track[bestIdx], heading: heading2 };
  }, [track, highlightRange]);
  const buildLineGradient = (pts) => {
    if (pts.length < 2) return null;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + (haversineDistKm(pts[i - 1], pts[i]) || 0));
    const total = cum[cum.length - 1] || 1;
    const colorFor = (i) => {
      if (i === 0) return "hsl(70,90%,50%)";
      const dt = pts[i].timeSec - pts[i - 1].timeSec;
      const rate = dt > 0 ? (pts[i].gpsAlt - pts[i - 1].gpsAlt) / dt : 0;
      const t = (Math.max(-4, Math.min(4, rate)) + 4) / 8;
      return `hsl(${t * 140},90%,50%)`;
    };
    const stride = Math.max(1, Math.ceil(pts.length / 400));
    const expr = ["interpolate", ["linear"], ["line-progress"]];
    let lastProgress = -1;
    for (let i = 0; i < pts.length; i += stride) {
      const progress = total > 0 ? cum[i] / total : 0;
      if (progress <= lastProgress) continue;
      expr.push(progress, colorFor(i));
      lastProgress = progress;
    }
    if (lastProgress < 1) expr.push(1, colorFor(pts.length - 1));
    return expr;
  };
  const applyLift = (map, marker) => {
    const L = marker._lift;
    if (!map || !marker._map || !L || !isFinite(L.alt)) return;
    const ground = map.queryTerrainElevation ? map.queryTerrainElevation([L.lon, L.lat]) : null;
    const h = Math.max(0, L.alt - (ground || 0));
    const mpp = 40075016686e-3 * Math.cos(L.lat * Math.PI / 180) / (512 * Math.pow(2, map.getZoom()));
    const px = h / mpp * Math.sin(map.getPitch() * Math.PI / 180);
    marker.setOffset([0, -px]);
  };
  const liftMarker = (map, marker, lon, lat, alt) => {
    marker._lift = { lon, lat, alt };
    if (!fullLiftRef.current.includes(marker)) fullLiftRef.current.push(marker);
    applyLift(map, marker);
  };
  const buildMap = (container, mapRefObj, readyRef) => {
    if (!container || !window.maptilersdk || !hasMap || !mapTilerKey) return;
    const sdk = window.maptilersdk;
    if (mapRefObj.current) {
      mapRefObj.current.remove();
      mapRefObj.current = null;
    }
    container.innerHTML = "";
    readyRef.current = false;
    const initialCenter = track.length ? [track[0].lon, track[0].lat] : [sP.lon, sP.lat];
    const isFull = mapRefObj === fullMapRef;
    const map = new sdk.Map({
      container,
      apiKey: mapTilerKey,
      style: sdk.MapStyle.OUTDOOR,
      language: "de",
      center: initialCenter,
      zoom: 11,
      ...isFull ? { terrain: true, maxPitch: 85, pitchWithRotate: true, touchPitch: true } : {}
    });
    mapRefObj.current = map;
    if (isFull) {
      setFsPitch(0);
      map.on("pitch", () => setFsPitch(Math.round(map.getPitch())));
      fullLiftRef.current = [];
      const relift = () => {
        fullLiftRef.current = fullLiftRef.current.filter((m) => m._map);
        fullLiftRef.current.forEach((m) => applyLift(map, m));
      };
      map.on("move", relift);
      map.on("idle", relift);
    }
    const canvas = map.getCanvas && map.getCanvas();
    if (canvas) {
      canvas.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        removeStrayMapTilerWarnings();
        if (mapRefObj.current === map) buildMap(container, mapRefObj, readyRef);
      }, { once: true });
    }
    const addMarker = (pt, color, label) => {
      const el = document.createElement("div");
      el.style.cssText = `width:22px;height:22px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;color:#fff;font:800 10px system-ui;`;
      el.textContent = label;
      new sdk.Marker({ element: el }).setLngLat([pt.lon, pt.lat]).addTo(map);
    };
    map.on("load", () => {
      const fullTrace = cleanTrack.length ? cleanTrack : track;
      if (fullTrace.length > 1) {
        map.addSource("track", {
          type: "geojson",
          lineMetrics: true,
          data: { type: "Feature", geometry: { type: "LineString", coordinates: fullTrace.map((p) => [p.lon, p.lat]) } }
        });
        map.addLayer({
          id: "track-casing",
          type: "line",
          source: "track",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "rgba(255,255,255,0.55)", "line-width": 4.5, "line-blur": 0 }
        });
        const gradient = buildLineGradient(fullTrace);
        map.addLayer({
          id: "track-line",
          type: "line",
          source: "track",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: gradient ? { "line-gradient": gradient, "line-width": 2.4, "line-blur": 0 } : { "line-color": "#1e40af", "line-width": 2.4, "line-blur": 0 }
        });
      }
      if (isFull && fullTrace.length > 1) {
        try {
          map.addLayer(createAltitudeTrackLayer(fullTrace));
        } catch (e) {
          console.warn("3D-Track nicht möglich", e);
        }
      }
      if (track.length) {
        addMarker(track[0], "#22c55e", "S");
        addMarker(track[track.length - 1], "#ef4444", "L");
      } else if (sP && eP) {
        addMarker(sP, "#22c55e", "S");
        addMarker(eP, "#ef4444", "L");
      }
      if (distanceRoute && distanceRoute.points.length > 1) {
        map.addSource("distance-route", {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "LineString", coordinates: distanceRoute.points.map((p) => [p.lon, p.lat]) } }
        });
        map.addLayer({
          id: "distance-line",
          type: "line",
          source: "distance-route",
          layout: { "line-join": "round", "line-cap": "round", visibility: "none" },
          paint: { "line-color": "#f59e0b", "line-width": 3, "line-dasharray": [2, 1.6] }
        });
      }
      readyRef.current = true;
      applyHighlight(map, mapRefObj === previewMapRef ? previewRefMarkerRef : fullRefMarkerRef);
      applyDistanceRoute(map, mapRefObj === previewMapRef ? previewDistanceMarkersRef : fullDistanceMarkersRef);
      applyClimbSinkMarkers(map, mapRefObj === previewMapRef ? previewClimbSinkMarkersRef : fullClimbSinkMarkersRef);
      removeStrayMapTilerWarnings();
    });
  };
  const applyRefMarker = (map, refMarkerRefObj) => {
    if (!map) return;
    const sdk = window.maptilersdk;
    if (refMarkerRefObj.current) {
      refMarkerRefObj.current.remove();
      refMarkerRefObj.current = null;
    }
    if (refPoint && !isPlaying) {
      const el = document.createElement("div");
      el.style.cssText = `width:34px;height:34px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.7));`;
      if (gliderIcon.type === "image") {
        const img = document.createElement("img");
        img.src = gliderIcon.value;
        img.style.cssText = `width:100%;height:100%;object-fit:contain;transform:rotate(${heading}deg);transition:transform 0.15s ease-out;`;
        el.appendChild(img);
      } else {
        el.style.fontSize = "26px";
        el.style.transform = `rotate(${heading}deg)`;
        el.style.transition = "transform 0.15s ease-out";
        el.textContent = gliderIcon.value;
      }
      refMarkerRefObj.current = new sdk.Marker({ element: el, rotationAlignment: "viewport", pitchAlignment: "viewport" }).setLngLat([refPoint.lon, refPoint.lat]).addTo(map);
      if (refMarkerRefObj === fullRefMarkerRef) liftMarker(map, refMarkerRefObj.current, refPoint.lon, refPoint.lat, refPoint.gpsAlt);
    }
  };
  const applyHighlightCamera = (map) => {
    if (!map) return;
    const fitToPoints = (pts) => {
      if (!pts.length) return;
      const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat);
      if (pts.length === 1) {
        map.jumpTo({ center: [lons[0], lats[0]], zoom: 12 });
        return;
      }
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 36, animate: false, pitch: map.getPitch(), bearing: map.getBearing() });
    };
    if (segment && segment.length > 1) fitToPoints(segment);
    else if (track.length) fitToPoints(cleanTrack.length ? cleanTrack : track);
    else if (sP && eP) fitToPoints([sP, eP]);
  };
  const applyHighlight = (map, refMarkerRefObj) => {
    applyRefMarker(map, refMarkerRefObj);
    if (isPlaying) return;
    applyHighlightCamera(map);
  };
  const applyDistanceRoute = (map, markersRefObj) => {
    if (!map) return;
    markersRefObj.current.forEach((m) => m.remove());
    markersRefObj.current = [];
    const show = showDistance && distanceRoute && distanceRoute.points.length > 1;
    if (map.getLayer && map.getLayer("distance-line")) {
      map.setLayoutProperty("distance-line", "visibility", show ? "visible" : "none");
    }
    if (!show) return;
    const sdk = window.maptilersdk;
    const pts = distanceRoute.points;
    const isRealStart = (pt) => sP && pt.lat === sP.lat && pt.lon === sP.lon;
    const isRealEnd = (pt) => eP && pt.lat === eP.lat && pt.lon === eP.lon;
    let label = 0;
    pts.forEach((pt, idx) => {
      if (idx === 0 && isRealStart(pt) || idx === pts.length - 1 && isRealEnd(pt)) return;
      label++;
      const el = document.createElement("div");
      el.style.cssText = `width:20px;height:20px;border-radius:50%;background:#f59e0b;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;color:#1a1200;font:800 11px system-ui;`;
      el.textContent = String(label);
      markersRefObj.current.push(new sdk.Marker({ element: el }).setLngLat([pt.lon, pt.lat]).addTo(map));
    });
  };
  const applyClimbSinkMarkers = (map, markersRefObj) => {
    if (!map) return;
    markersRefObj.current.forEach((m) => m.remove());
    markersRefObj.current = [];
    if (!showClimbSink || !climbSinkPoints) return;
    const sdk = window.maptilersdk;
    const addPt = (pt, color, symbol, rate, label) => {
      const el = document.createElement("div");
      el.style.cssText = `width:26px;height:26px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;color:#fff;font:800 13px system-ui;`;
      el.textContent = symbol;
      const marker = new sdk.Marker({ element: el }).setLngLat([pt.lon, pt.lat]).addTo(map);
      marker.setPopup(new sdk.Popup({ offset: 15 }).setText(`${label}: ${rate > 0 ? "+" : ""}${rate.toFixed(1)} m/s`));
      markersRefObj.current.push(marker);
    };
    const addAll = (points, color, symbol, label) => points.forEach((p, i) => {
      const text = points.length > 1 ? `${label} (${i + 1}/${points.length})` : label;
      addPt(p.pt, color, symbol, p.rate, text);
    });
    addAll(climbSinkPoints.climbs, "#22c55e", "↑", "Max. Steigen");
    addAll(climbSinkPoints.sinks, "#ef4444", "↓", "Max. Sinken");
  };
  useEffect(() => {
    if (previewReadyRef.current) applyDistanceRoute(previewMapRef.current, previewDistanceMarkersRef);
    if (isFullscreen && fullReadyRef.current) applyDistanceRoute(fullMapRef.current, fullDistanceMarkersRef);
  }, [showDistance, distanceRoute, isFullscreen]);
  useEffect(() => {
    if (previewReadyRef.current) applyClimbSinkMarkers(previewMapRef.current, previewClimbSinkMarkersRef);
    if (isFullscreen && fullReadyRef.current) applyClimbSinkMarkers(fullMapRef.current, fullClimbSinkMarkersRef);
  }, [showClimbSink, climbSinkPoints, isFullscreen]);
  useEffect(() => {
    if (isFullscreen) {
      if (previewMapRef.current) {
        previewMapRef.current.remove();
        previewMapRef.current = null;
      }
      previewReadyRef.current = false;
      return;
    }
    buildMap(previewDivRef.current, previewMapRef, previewReadyRef);
    return () => {
      if (previewMapRef.current) {
        previewMapRef.current.remove();
        previewMapRef.current = null;
      }
    };
  }, [flight?.id, gliderIcon, isFullscreen]);
  useEffect(() => {
    if (!isFullscreen) return;
    const raf = requestAnimationFrame(() => buildMap(fullDivRef.current, fullMapRef, fullReadyRef));
    return () => {
      cancelAnimationFrame(raf);
      if (fullMapRef.current) {
        fullMapRef.current.remove();
        fullMapRef.current = null;
      }
    };
  }, [isFullscreen, flight?.id, gliderIcon]);
  useEffect(() => {
    if (isPlaying) return;
    if (previewReadyRef.current) applyHighlightCamera(previewMapRef.current);
    if (isFullscreen && fullReadyRef.current) applyHighlightCamera(fullMapRef.current);
  }, [highlightRange?.start, highlightRange?.end, isFullscreen]);
  useEffect(() => {
    if (previewReadyRef.current) applyRefMarker(previewMapRef.current, previewRefMarkerRef);
    if (isFullscreen && fullReadyRef.current) applyRefMarker(fullMapRef.current, fullRefMarkerRef);
  }, [refPoint, heading, isPlaying, isFullscreen]);
  useEffect(() => {
    if (!isPlaying) return;
    if (track.length < 2) return;
    playLastTsRef.current = null;
    const totalSec = track[track.length - 1].timeSec - track[0].timeSec;
    const step = (ts) => {
      if (playLastTsRef.current == null) playLastTsRef.current = ts;
      const dtReal = (ts - playLastTsRef.current) / 1e3;
      playLastTsRef.current = ts;
      setPlayElapsedSec((prev) => {
        const next = prev + dtReal * playSpeed;
        if (next >= totalSec) {
          setIsPlaying(false);
          return totalSec;
        }
        return next;
      });
      playRafRef.current = requestAnimationFrame(step);
    };
    playRafRef.current = requestAnimationFrame(step);
    return () => {
      if (playRafRef.current) cancelAnimationFrame(playRafRef.current);
    };
  }, [isPlaying, playSpeed, track.length]);
  useEffect(() => {
    if (!window.maptilersdk) return;
    if (track.length < 2) return;
    const sdk = window.maptilersdk;
    const targetTime = track[0].timeSec + playElapsedSec;
    let i = 0;
    while (i < track.length - 2 && track[i + 1].timeSec < targetTime) i++;
    const a = track[i], b = track[i + 1] || a;
    const span = b.timeSec - a.timeSec || 1;
    const frac = Math.max(0, Math.min(1, (targetTime - a.timeSec) / span));
    const lat = a.lat + (b.lat - a.lat) * frac, lon = a.lon + (b.lon - a.lon) * frac;
    const alt = a.gpsAlt + ((b.gpsAlt || a.gpsAlt) - a.gpsAlt) * frac;
    const spanBack = track[Math.max(0, i - 3)], spanFwd = track[Math.min(track.length - 1, i + 3)];
    const hdg = bearingDeg(spanBack, spanFwd);
    const turnSum = circlingTurnSumDeg(track, i);
    const circling = circlingStateRef.current ? turnSum >= 90 : turnSum >= 210;
    circlingStateRef.current = circling;
    if (onPlaybackPhaseChange) onPlaybackPhaseChange(circling ? "circling" : "flight");
    if (onPlaybackPositionChange && cumDist.length) {
      const distKm = (cumDist[i] || 0) + ((cumDist[i + 1] || cumDist[i] || 0) - (cumDist[i] || 0)) * frac;
      onPlaybackPositionChange(distKm);
    }
    const placeOn = (map, ref, showAlt) => {
      if (!map) return;
      if (!ref.current) {
        const el = document.createElement("div");
        el.style.cssText = `position:relative;width:34px;height:34px;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.7));display:flex;align-items:center;justify-content:center;`;
        let img = null;
        if (gliderIcon.type === "image") {
          img = document.createElement("img");
          img.src = gliderIcon.value;
          img.style.cssText = `width:100%;height:100%;object-fit:contain;`;
          el.appendChild(img);
        } else {
          el.style.fontSize = "26px";
          el.textContent = gliderIcon.value;
        }
        if (showAlt) {
          const altEl = document.createElement("span");
          altEl.style.cssText = `position:absolute;left:calc(100% + 4px);top:50%;transform:translateY(-50%);color:#dc2626;font:800 13px system-ui,sans-serif;white-space:nowrap;`;
          el.appendChild(altEl);
          ref._altEl = altEl;
        } else {
          ref._altEl = null;
        }
        const marker = new sdk.Marker({ element: el, rotationAlignment: "viewport", pitchAlignment: "viewport" }).setLngLat([lon, lat]).addTo(map);
        ref.current = marker;
        ref.current._imgEl = img;
        ref.current._altEl = ref._altEl;
      } else {
        ref.current.setLngLat([lon, lat]);
      }
      if (ref === playMarkerRef) liftMarker(map, ref.current, lon, lat, alt);
      if (ref.current._imgEl) ref.current._imgEl.style.transform = `rotate(${hdg}deg)`;
      if (ref.current._altEl) ref.current._altEl.textContent = (alt != null ? Math.round(alt) : "") + "m";
      if (isPlaying && map.jumpTo) {
        if (!circling) {
          map.jumpTo({ center: [lon, lat], zoom: map.getZoom() });
        } else if (map.easeTo && map.project && map.getContainer) {
          const el = map.getContainer();
          const w = el.clientWidth, h = el.clientHeight;
          if (w && h) {
            const pt = map.project([lon, lat]);
            const marginX = w * 0.1, marginY = h * 0.1;
            const outOfZone = pt.x < marginX || pt.x > w - marginX || pt.y < marginY || pt.y > h - marginY;
            if (outOfZone) map.easeTo({ center: [lon, lat], zoom: map.getZoom(), duration: 600 });
          }
        }
      }
    };
    if (previewReadyRef.current) placeOn(previewMapRef.current, previewPlayMarkerRef, false);
    if (isFullscreen && fullReadyRef.current) placeOn(fullMapRef.current, playMarkerRef, true);
  }, [playElapsedSec, isFullscreen]);
  const interpAtDistance = (distKm) => {
    if (track.length < 2 || !cumDist.length) return null;
    let i = 0;
    while (i < cumDist.length - 2 && cumDist[i + 1] < distKm) i++;
    const a = track[i], b = track[i + 1] || a;
    const da = cumDist[i], db = cumDist[i + 1] != null ? cumDist[i + 1] : da;
    const span = db - da || 1;
    const frac = Math.max(0, Math.min(1, (distKm - da) / span));
    return {
      lat: a.lat + (b.lat - a.lat) * frac,
      lon: a.lon + (b.lon - a.lon) * frac,
      timeSec: a.timeSec + ((b.timeSec != null ? b.timeSec : a.timeSec) - a.timeSec) * frac
    };
  };
  useEffect(() => {
    const placeScrub = (map, ref) => {
      if (!map) return;
      const p = scrubDistanceKm != null ? interpAtDistance(scrubDistanceKm) : null;
      if (!p) {
        if (ref.current) {
          ref.current.remove();
          ref.current = null;
        }
        return;
      }
      const sdk = window.maptilersdk;
      if (!ref.current) {
        const el = document.createElement("div");
        el.style.cssText = `width:20px;height:20px;border-radius:50%;background:#38bdf8;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,0.6);`;
        ref.current = new sdk.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
      } else {
        ref.current.setLngLat([p.lon, p.lat]);
      }
    };
    if (previewReadyRef.current) placeScrub(previewMapRef.current, previewScrubMarkerRef);
    if (isFullscreen && fullReadyRef.current) placeScrub(fullMapRef.current, fullScrubMarkerRef);
  }, [scrubDistanceKm, isFullscreen, track, cumDist]);
  useEffect(() => {
    if (scrubDistanceKm == null) return;
    const p = interpAtDistance(scrubDistanceKm);
    const t0 = track[0]?.timeSec;
    if (!p || t0 == null) return;
    setPlayElapsedSec(Math.max(0, p.timeSec - t0));
  }, [scrubDistanceKm, track, cumDist]);
  useEffect(() => {
    if (!isFullscreen) {
      if (playMarkerRef.current) {
        playMarkerRef.current.remove();
        playMarkerRef.current = null;
      }
      if (fullScrubMarkerRef.current) {
        fullScrubMarkerRef.current.remove();
        fullScrubMarkerRef.current = null;
      }
    }
  }, [isFullscreen]);
  useEffect(() => {
    setIsPlaying(false);
    setPlayElapsedSec(0);
    setShowDistance(false);
    setShowMonitor(false);
    if (playMarkerRef.current) {
      playMarkerRef.current.remove();
      playMarkerRef.current = null;
    }
    if (previewPlayMarkerRef.current) {
      previewPlayMarkerRef.current.remove();
      previewPlayMarkerRef.current = null;
    }
    if (previewScrubMarkerRef.current) {
      previewScrubMarkerRef.current.remove();
      previewScrubMarkerRef.current = null;
    }
    if (fullScrubMarkerRef.current) {
      fullScrubMarkerRef.current.remove();
      fullScrubMarkerRef.current = null;
    }
    if (onPlaybackPositionChange) onPlaybackPositionChange(null);
    if (onPlaybackPhaseChange) onPlaybackPhaseChange("flight");
  }, [flight?.id]);
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { position: "relative" }, onClick: () => {
    if (hasMap) setIsFullscreen(true);
  } }, /* @__PURE__ */ React.createElement("div", { ref: previewDivRef, style: { width: "100%", aspectRatio: "3/2", background: "#040e20", borderRadius: 10, overflow: "hidden", cursor: hasMap ? "pointer" : "default", position: "relative", zIndex: 0 } }), (showDistance && distanceRoute || showClimbSink && climbSinkPoints || showMonitor && monitorInfo) && // Alle Badges links oben statt rechts: die eingebauten Zoom-+/--
  // Buttons der Karte sitzen rechts oben und überlagerten dort ein
  // Badge. Sind mehrere Badges aktiv, stehen sie als eigene Zeilen
  // untereinander (Distanz, Steigen/Sinken, Monitor).
  /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: 8, left: 8, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, pointerEvents: "none" } }, showDistance && distanceRoute && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(4,14,32,0.85)", border: "1px solid rgba(245,158,11,0.5)", borderRadius: 8, padding: "4px 9px", color: "#f59e0b", fontSize: 12, fontWeight: 700 } }, "📏 ", distanceRoute.km, " km"), showClimbSink && climbSinkPoints && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(4,14,32,0.85)", border: "1px solid rgba(34,197,94,0.5)", borderRadius: 8, padding: "4px 9px", fontSize: 12, fontWeight: 700, display: "flex", flexDirection: "column", gap: 2 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#4ade80" } }, "↑ ", climbSinkPoints.climbs[0].rate.toFixed(1), " m/s", climbSinkPoints.climbs.length > 1 ? ` ×${climbSinkPoints.climbs.length}` : ""), /* @__PURE__ */ React.createElement("span", { style: { color: "#f87171" } }, "↓ ", climbSinkPoints.sinks[0].rate.toFixed(1), " m/s", climbSinkPoints.sinks.length > 1 ? ` ×${climbSinkPoints.sinks.length}` : "")), showMonitor && monitorInfo && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(4,14,32,0.85)", border: "1px solid rgba(125,211,252,0.5)", borderRadius: 8, padding: "4px 9px", fontSize: 12, fontWeight: 700, display: "flex", flexDirection: "column", gap: 2 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#7dd3fc" } }, "⬆ ", Math.round(monitorInfo.alt), " m"), /* @__PURE__ */ React.createElement("span", { style: { color: "#e8f4fd" } }, "➤ ", Math.round(monitorInfo.speedKmh), " km/h"), /* @__PURE__ */ React.createElement("span", { style: { color: monitorInfo.varioMs >= 0 ? "#4ade80" : "#f87171" } }, monitorInfo.varioMs >= 0 ? "↑" : "↓", " ", Math.abs(monitorInfo.varioMs).toFixed(1), " m/s"))), hasMap && !mapTilerKey && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, background: "rgba(4,14,32,0.92)", color: "rgba(232,244,253,0.6)", fontSize: 12, textAlign: "center", padding: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 22 } }, "🗺️"), /* @__PURE__ */ React.createElement("div", null, "Kein MapTiler-Schlüssel hinterlegt."), /* @__PURE__ */ React.createElement("a", { href: "service.html", onClick: (e) => e.stopPropagation(), style: { color: "#7dd3fc", fontSize: 11 } }, "→ Unter Service eintragen"))), controlsSlot && hasMap && ReactDOM.createPortal(
    /* @__PURE__ */ React.createElement(React.Fragment, null, flight?.track?.length > 1 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: togglePlay,
        title: isPlaying ? "Pause" : "Abspielen",
        style: { flex: "0.85 1 0", minWidth: 0, height: 34, boxSizing: "border-box", background: isPlaying ? "#dc2626" : "#16a34a", border: "none", borderRadius: 8, color: "#fff", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }
      },
      isPlaying ? "⏸" : "▶"
    ), /* @__PURE__ */ React.createElement("div", { style: { position: "relative", flex: "1.15 1 0", minWidth: 0 }, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setPlayPickerOpen((o) => !o),
        style: { width: "100%", height: 34, boxSizing: "border-box", background: "#1e40af", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }
      },
      playSpeed,
      "×▾"
    ), playPickerOpen && /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: (e) => {
          e.stopPropagation();
          setPlayPickerOpen(false);
        },
        style: { position: "absolute", bottom: "calc(100% + 4px)", left: 0, background: "#14253a", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: 2, minWidth: 56, zIndex: 10 }
      },
      [1, 2, 5, 10, 20, 50, 100].map((sp) => /* @__PURE__ */ React.createElement(
        "button",
        {
          key: sp,
          onClick: () => {
            setPlaySpeed(sp);
            setPlayPickerOpen(false);
          },
          style: { background: sp === playSpeed ? "rgba(125,211,252,0.2)" : "transparent", border: "none", borderRadius: 6, padding: "5px 8px", color: sp === playSpeed ? "#7dd3fc" : "#e8f4fd", fontSize: 12, fontWeight: sp === playSpeed ? 700 : 400, cursor: "pointer", textAlign: "left" }
        },
        sp,
        "×"
      ))
    )), playElapsedSec > 0 && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          setIsPlaying(false);
          setPlayElapsedSec(0);
        },
        title: "Zurück zum Start",
        style: { flex: "0.85 1 0", minWidth: 0, height: 34, boxSizing: "border-box", background: "rgba(22,163,74,0.18)", border: "1px solid rgba(22,163,74,0.4)", borderRadius: 8, color: "#4ade80", fontSize: 16, cursor: "pointer" }
      },
      "↺"
    )), distanceRoute && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setShowDistance((s) => !s),
        title: showDistance ? "Distanz ausblenden" : "Distanz anzeigen",
        style: { flex: "1.15 1 0", minWidth: 0, height: 34, boxSizing: "border-box", background: showDistance ? "rgba(245,158,11,0.25)" : "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 8, color: "#f59e0b", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }
      },
      "📏 km"
    ), climbSinkPoints && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setShowClimbSink((s) => !s),
        title: showClimbSink ? "Steigen/Sinken ausblenden" : "Steigen/Sinken anzeigen",
        style: { flex: "0.85 1 0", minWidth: 0, height: 34, boxSizing: "border-box", background: showClimbSink ? "rgba(34,197,94,0.25)" : "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.4)", borderRadius: 8, color: "#4ade80", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }
      },
      "↑↓"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setShowMonitor((m) => !m),
        title: showMonitor ? "Monitor ausblenden" : "Monitor anzeigen (Höhe/Geschwindigkeit/Vario)",
        style: { flex: "0.85 1 0", minWidth: 0, height: 34, boxSizing: "border-box", background: showMonitor ? "rgba(125,211,252,0.25)" : "rgba(125,211,252,0.1)", border: "1px solid rgba(125,211,252,0.4)", borderRadius: 8, color: "#7dd3fc", fontSize: 14, fontWeight: 700, cursor: "pointer" }
      },
      "📊"
    ), track.length > 30 && mapTilerKey && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setShowVideo(true),
        title: "Kurzes Flug-Video erzeugen (30 s bis 1:30 min)",
        style: { flex: "0.85 1 0", minWidth: 0, height: 34, boxSizing: "border-box", background: "rgba(244,114,182,0.12)", border: "1px solid rgba(244,114,182,0.45)", borderRadius: 8, color: "#f472b6", fontSize: 14, fontWeight: 700, cursor: "pointer" }
      },
      "🎬"
    )),
    controlsSlot
  ), showVideo && /* @__PURE__ */ React.createElement(FlightVideoDialog, { flight, track: cleanTrack.length ? cleanTrack : track, mapTilerKey, onClose: () => setShowVideo(false) }), isFullscreen && /* @__PURE__ */ React.createElement(
    "div",
    {
      style: { position: "fixed", inset: 0, background: "#000", zIndex: 200, display: "flex", flexDirection: "column", overflow: "hidden" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { position: "relative", flex: "1 1 auto", minHeight: 0, width: "100%" } }, /* @__PURE__ */ React.createElement("div", { ref: fullDivRef, style: { position: "absolute", inset: 0, zIndex: 0 } }), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 10px)", left: 10, zIndex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setIsFullscreen(false),
        style: { background: "rgba(255,255,255,0.92)", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 12, width: 22, height: 22, color: "#111", fontSize: 12, fontWeight: 700, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, pointerEvents: "auto", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }
      },
      "✕"
    ), (showDistance && distanceRoute || showClimbSink && climbSinkPoints || showMonitor && monitorInfo) && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" } }, showDistance && distanceRoute && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(4,14,32,0.85)", border: "1px solid rgba(245,158,11,0.5)", borderRadius: 20, padding: "7px 14px", color: "#f59e0b", fontSize: 13, fontWeight: 700, boxShadow: "0 2px 10px rgba(0,0,0,0.5)" } }, "📏 ", distanceRoute.km, " km"), showClimbSink && climbSinkPoints && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(4,14,32,0.85)", border: "1px solid rgba(34,197,94,0.5)", borderRadius: 20, padding: "7px 14px", fontSize: 13, fontWeight: 700, boxShadow: "0 2px 10px rgba(0,0,0,0.5)", display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#4ade80" } }, "↑ ", climbSinkPoints.climbs[0].rate.toFixed(1), " m/s", climbSinkPoints.climbs.length > 1 ? ` ×${climbSinkPoints.climbs.length}` : ""), /* @__PURE__ */ React.createElement("span", { style: { color: "#f87171" } }, "↓ ", climbSinkPoints.sinks[0].rate.toFixed(1), " m/s", climbSinkPoints.sinks.length > 1 ? ` ×${climbSinkPoints.sinks.length}` : "")), showMonitor && monitorInfo && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(4,14,32,0.85)", border: "1px solid rgba(125,211,252,0.5)", borderRadius: 20, padding: "7px 14px", fontSize: 13, fontWeight: 700, boxShadow: "0 2px 10px rgba(0,0,0,0.5)", display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#7dd3fc" } }, "⬆ ", Math.round(monitorInfo.alt), " m"), /* @__PURE__ */ React.createElement("span", { style: { color: "#e8f4fd" } }, "➤ ", Math.round(monitorInfo.speedKmh), " km/h"), /* @__PURE__ */ React.createElement("span", { style: { color: monitorInfo.varioMs >= 0 ? "#4ade80" : "#f87171" } }, monitorInfo.varioMs >= 0 ? "↑" : "↓", " ", Math.abs(monitorInfo.varioMs).toFixed(1), " m/s")))), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", left: 10, bottom: 14, zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, background: "rgba(4,14,32,0.7)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 20, padding: "10px 6px", boxShadow: "0 2px 10px rgba(0,0,0,0.5)" } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        title: "Sicht von oben",
        onClick: () => fullMapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: 500 }),
        style: { background: "none", border: "none", color: "#e8f4fd", fontSize: 15, cursor: "pointer", padding: 0, lineHeight: 1 }
      },
      "🗺️"
    ), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "range",
        min: 0,
        max: 85,
        step: 1,
        value: fsPitch,
        onChange: (e) => {
          const v = +e.target.value;
          setFsPitch(v);
          fullMapRef.current?.setPitch(v);
        },
        "aria-label": "Kippwinkel",
        style: { writingMode: "vertical-lr", width: 24, height: 110, margin: 0, cursor: "pointer", touchAction: "none" }
      }
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        title: "Seitenansicht",
        onClick: () => fullMapRef.current?.easeTo({ pitch: 80, duration: 500 }),
        style: { background: "none", border: "none", color: "#e8f4fd", fontSize: 15, cursor: "pointer", padding: 0, lineHeight: 1 }
      },
      "🏔️"
    ), /* @__PURE__ */ React.createElement("div", { style: { color: "#7dd3fc", fontSize: 10, fontWeight: 700 } }, fsPitch, "°")), flight?.track?.length > 1 && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", bottom: 14, right: 14, display: "flex", gap: 6, alignItems: "center" } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: togglePlay,
        title: isPlaying ? "Pause" : "Abspielen",
        style: { background: isPlaying ? "#dc2626" : "#16a34a", border: "none", borderRadius: 20, width: 40, height: 40, color: "#fff", fontSize: 17, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0, boxShadow: "0 2px 10px rgba(0,0,0,0.5)" }
      },
      isPlaying ? "⏸" : "▶"
    ), /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setPlayPickerOpen((o) => !o),
        style: { background: "#1e40af", border: "none", borderRadius: 20, padding: "9px 14px", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.5)" }
      },
      playSpeed,
      "× ▾"
    ), playPickerOpen && /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => setPlayPickerOpen(false),
        style: { position: "absolute", bottom: "calc(100% + 4px)", right: 0, background: "#14253a", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: 2, minWidth: 64 }
      },
      [1, 2, 5, 10, 20, 50, 100].map((sp) => /* @__PURE__ */ React.createElement(
        "button",
        {
          key: sp,
          onClick: () => {
            setPlaySpeed(sp);
            setPlayPickerOpen(false);
          },
          style: { background: sp === playSpeed ? "rgba(125,211,252,0.2)" : "transparent", border: "none", borderRadius: 6, padding: "6px 10px", color: sp === playSpeed ? "#7dd3fc" : "#e8f4fd", fontSize: 13, fontWeight: sp === playSpeed ? 700 : 400, cursor: "pointer", textAlign: "left" }
        },
        sp,
        "×"
      ))
    )), playElapsedSec > 0 && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          setIsPlaying(false);
          setPlayElapsedSec(0);
        },
        title: "Zurück zum Start",
        style: { background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 20, width: 40, height: 40, color: "#fff", fontSize: 15, cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.5)" }
      },
      "↺"
    ))),
    flight?.track?.length > 1 && /* @__PURE__ */ React.createElement("div", { ref: onFullscreenProfileSlot, style: { flex: "0 0 auto", width: "100%", height: isLandscapePhone ? 64 : 150, background: "#040e20", borderTop: "1px solid rgba(100,180,255,0.18)" } })
  ));
}
function FlightProfile({ flight, onPositionChange, playbackDistanceKm, isPlaybackActive, playbackPhase, controlsSlot, isWide, fullscreenSlot, onScrubChange }) {
  const canvasRef = useRef(null);
  const [groundProfile, setGroundProfile] = useState(null);
  const [groundError, setGroundError] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPos, setPanPos] = useState(0.5);
  const [zoomPickerOpen, setZoomPickerOpen] = useState(false);
  const [scrubDist, setScrubDist] = useState(null);
  const [canvasResizeTick, setCanvasResizeTick] = useState(0);
  const viewScale = zoomLevel;
  const viewStart = panPos - 1 / viewScale / 2;
  const track = flight?.track || [];
  const rawDistances = useMemo(() => {
    if (!track.length) return [];
    const d = [0];
    for (let i = 1; i < track.length; i++) {
      d.push(d[i - 1] + (haversineDistKm(track[i - 1], track[i]) || 0));
    }
    return d;
  }, [track]);
  const rawTotalDist = rawDistances[rawDistances.length - 1] || 0;
  const manualDist = parseFloat(getDisplayDistance(flight)) || 0;
  const scale = manualDist > 0 && rawTotalDist > 0 ? manualDist / rawTotalDist : 1;
  const distances = useMemo(() => rawDistances.map((d) => d * scale), [rawDistances, scale]);
  const totalDist = distances[distances.length - 1] || 0;
  const playbackDistanceScaled = playbackDistanceKm != null ? playbackDistanceKm * scale : null;
  useEffect(() => {
    if (!isPlaybackActive || playbackDistanceScaled == null || zoomLevel <= 1 || !totalDist) return;
    if (playbackPhase === "circling") return;
    const posFrac = playbackDistanceScaled / totalDist;
    setPanPos(Math.max(0, Math.min(1, posFrac)));
  }, [playbackDistanceScaled, isPlaybackActive, playbackPhase, zoomLevel, totalDist]);
  useEffect(() => {
    setZoomLevel(1);
    setPanPos(0.5);
    setScrubDist(null);
  }, [flight?.id]);
  useEffect(() => {
    profileZoomActive = zoomLevel > 1;
    return () => {
      profileZoomActive = false;
    };
  }, [zoomLevel]);
  useEffect(() => {
    if (isPlaybackActive) setScrubDist(null);
  }, [isPlaybackActive]);
  useEffect(() => {
    if (!onScrubChange) return;
    if (scrubDist == null || !totalDist) {
      onScrubChange(null);
      return;
    }
    onScrubChange(scale > 0 ? scrubDist / scale : scrubDist);
  }, [scrubDist, totalDist, scale, onScrubChange]);
  useEffect(() => {
    if (!onPositionChange) return;
    if (zoomLevel <= 1 || !totalDist) {
      onPositionChange(null);
      return;
    }
    const visStart = viewStart * totalDist;
    const visEnd = visStart + totalDist / viewScale;
    const overallCenter = (visStart + visEnd) / 2;
    const toRaw = (d) => scale > 0 ? Math.max(0, d) / scale : Math.max(0, d);
    onPositionChange({ start: toRaw(visStart), end: toRaw(visEnd), center: toRaw(overallCenter) });
  }, [zoomLevel, viewStart, viewScale, totalDist, scale]);
  const zoomLevelRef = useRef(zoomLevel);
  const panPosRef = useRef(panPos);
  const totalDistRef = useRef(totalDist);
  const isPlaybackActiveRef = useRef(isPlaybackActive);
  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
  }, [zoomLevel]);
  useEffect(() => {
    panPosRef.current = panPos;
  }, [panPos]);
  useEffect(() => {
    totalDistRef.current = totalDist;
  }, [totalDist]);
  useEffect(() => {
    isPlaybackActiveRef.current = isPlaybackActive;
  }, [isPlaybackActive]);
  const panGestureRef = useRef(null);
  const scrubGestureRef = useRef(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const distAtClientX = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      const PAD_L = 42, PAD_R = 8;
      const plotW = Math.max(1, rect.width - PAD_L - PAD_R);
      const relX = Math.min(1, Math.max(0, (clientX - rect.left - PAD_L) / plotW));
      const vScale = zoomLevelRef.current, total = totalDistRef.current;
      const vStart = (panPosRef.current - 1 / vScale / 2) * total;
      const vEnd = vStart + total / vScale;
      return Math.max(0, Math.min(total, vStart + relX * (vEnd - vStart)));
    };
    const startScrub = (clientX) => {
      scrubGestureRef.current = true;
      setScrubDist(distAtClientX(clientX));
      return true;
    };
    const moveScrub = (clientX) => {
      if (scrubGestureRef.current) setScrubDist(distAtClientX(clientX));
    };
    const endScrub = () => {
      scrubGestureRef.current = false;
      if (isPlaybackActiveRef.current) setScrubDist(null);
    };
    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      if (zoomLevelRef.current > 1) {
        e.preventDefault();
        e.stopPropagation();
        panGestureRef.current = { startX: e.touches[0].clientX, startPan: panPosRef.current };
      } else if (startScrub(e.touches[0].clientX)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onTouchMove = (e) => {
      if (panGestureRef.current) {
        e.preventDefault();
        e.stopPropagation();
        const dx = e.touches[0].clientX - panGestureRef.current.startX;
        const fracDelta = -dx / canvas.clientWidth / zoomLevelRef.current * 2;
        setPanPos(Math.min(1, Math.max(0, panGestureRef.current.startPan + fracDelta)));
      } else if (scrubGestureRef.current) {
        e.preventDefault();
        e.stopPropagation();
        moveScrub(e.touches[0].clientX);
      }
    };
    const onTouchEnd = () => {
      panGestureRef.current = null;
      endScrub();
    };
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    const onMouseDown = (e) => {
      if (zoomLevelRef.current > 1) {
        e.preventDefault();
        panGestureRef.current = { startX: e.clientX, startPan: panPosRef.current };
      } else if (startScrub(e.clientX)) {
        e.preventDefault();
      }
    };
    const onMouseMove = (e) => {
      if (panGestureRef.current) {
        e.preventDefault();
        const dx = e.clientX - panGestureRef.current.startX;
        const fracDelta = -dx / canvas.clientWidth / zoomLevelRef.current * 2;
        setPanPos(Math.min(1, Math.max(0, panGestureRef.current.startPan + fracDelta)));
      } else if (scrubGestureRef.current) {
        e.preventDefault();
        moveScrub(e.clientX);
      }
    };
    const onMouseUp = () => {
      panGestureRef.current = null;
      endScrub();
    };
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.style.cursor = "grab";
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [fullscreenSlot]);
  useEffect(() => {
    setGroundProfile(null);
    setGroundError(false);
    if (!track.length || totalDist <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const N = 80;
        const samplePts = [];
        let idx = 0;
        for (let i = 0; i <= N && track.length > 1; i++) {
          const targetDist = rawTotalDist / N * i;
          while (idx < rawDistances.length - 1 && rawDistances[idx] < targetDist) idx++;
          samplePts.push({ lat: track[idx].lat, lon: track[idx].lon, distKm: distances[idx], ownElev: track[idx].gpsAlt });
        }
        if (!samplePts.length) return;
        const lats = samplePts.map((s) => s.lat.toFixed(5)).join(",");
        const lons = samplePts.map((s) => s.lon.toFixed(5)).join(",");
        const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
        const fetchElevations = async () => {
          const res = await fetch(url);
          const data = await res.json();
          if (!Array.isArray(data.elevation)) throw new Error("unexpected response shape");
          return data.elevation;
        };
        let elevation;
        try {
          elevation = await fetchElevations();
        } catch (firstErr) {
          await new Promise((r) => setTimeout(r, 1200));
          if (cancelled) return;
          elevation = await fetchElevations();
        }
        if (cancelled) return;
        const flightGroundPts = samplePts.map((s, i) => ({
          distKm: s.distKm,
          elev: elevation[i] != null ? Math.min(elevation[i], s.ownElev - 5) : null
        }));
        setGroundProfile(flightGroundPts);
      } catch {
        if (cancelled) return;
        setGroundError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flight?.id, totalDist]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !track.length) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const padL = 42 * dpr, padR = 8 * dpr, padT = 10 * dpr, padB = 34 * dpr;
    const plotW = Math.max(1, W - padL - padR), plotH = Math.max(1, H - padT - padB);
    const visStart = viewStart * totalDist;
    const visEnd = visStart + totalDist / viewScale;
    const visStartLabel = Math.max(0, visStart);
    const visEndLabel = Math.min(totalDist, visEnd);
    const visibleAlts = [];
    for (let i = 0; i < track.length; i++) if (distances[i] >= visStart && distances[i] <= visEnd) visibleAlts.push(track[i].gpsAlt);
    if (!visibleAlts.length && track.length) visibleAlts.push(track[0].gpsAlt, track[track.length - 1].gpsAlt);
    let minA = Math.min(...visibleAlts), maxA = Math.max(...visibleAlts);
    if (groundProfile) {
      const gv = groundProfile.filter((g) => g.distKm >= visStart && g.distKm <= visEnd).map((g) => g.elev).filter((v) => v != null);
      if (gv.length) minA = Math.min(minA, ...gv);
    }
    maxA = Math.max(maxA, minA + 1);
    const altRange = maxA - minA || 1;
    const span = visEnd - visStart || 1;
    const xPos = (d) => padL + (d - visStart) / span * plotW;
    const yPos = (alt) => padT + plotH - (alt - minA) / altRange * plotH;
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();
    ctx.fillStyle = "rgba(232,244,253,0.5)";
    ctx.font = `${10 * dpr}px system-ui,sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(Math.round(maxA) + "m", padL - 4 * dpr, padT + 9 * dpr);
    ctx.fillText(Math.round(minA) + "m", padL - 4 * dpr, padT + plotH);
    ctx.textAlign = "left";
    ctx.fillText(visStartLabel.toFixed(1) + " km", padL, padT + plotH + 15 * dpr);
    ctx.textAlign = "right";
    ctx.fillText(visEndLabel.toFixed(1) + " km", padL + plotW, padT + plotH + 15 * dpr);
    if (viewScale > 1.02) {
      ctx.textAlign = "center";
      ctx.fillText(`${viewScale.toFixed(1)}×`, padL + plotW / 2, padT + 9 * dpr);
      ctx.save();
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.strokeStyle = "rgba(220,38,38,0.7)";
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(padL + plotW / 2, padT);
      ctx.lineTo(padL + plotW / 2, padT + plotH);
      ctx.stroke();
      ctx.restore();
    }
    const centerDist = isPlaybackActive && playbackDistanceScaled != null ? playbackDistanceScaled : scrubDist != null ? scrubDist : (visStart + visEnd) / 2;
    let centerAlt = null, centerLabel = "";
    if (distances.length) {
      let ci = 0, cd = Infinity;
      for (let i = 0; i < distances.length; i++) {
        const diff = Math.abs(distances[i] - centerDist);
        if (diff < cd) {
          cd = diff;
          ci = i;
        }
      }
      centerAlt = track[ci]?.gpsAlt;
      const utcStartSec = track[0]?.timeSec, rawTime = track[ci]?.timeSec;
      if (rawTime != null && utcStartSec != null) {
        const elapsedSec = Math.max(0, rawTime - utcStartSec);
        const hh = String(Math.floor(elapsedSec / 3600)).padStart(2, "0");
        const mm = String(Math.floor(elapsedSec % 3600 / 60)).padStart(2, "0");
        const flightKm = centerDist / (scale || 1);
        centerLabel = `${hh}:${mm}/${flightKm.toFixed(1)}km`;
      }
    }
    if (centerAlt != null) {
      const cy = Math.max(padT + 9 * dpr, Math.min(padT + plotH, yPos(centerAlt)));
      ctx.fillStyle = "#dc2626";
      ctx.font = `bold ${10 * dpr}px system-ui,sans-serif`;
      ctx.textAlign = "right";
      ctx.fillText(Math.round(centerAlt) + "m", padL - 4 * dpr, cy);
    }
    if (centerLabel) {
      ctx.fillStyle = "#dc2626";
      ctx.font = `bold ${10 * dpr}px system-ui,sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(centerLabel, padL + plotW / 2, padT + plotH + 29 * dpr);
    }
    if (playbackDistanceScaled != null) {
      if (playbackDistanceScaled >= visStart && playbackDistanceScaled <= visEnd) {
        const px = xPos(playbackDistanceScaled);
        ctx.save();
        ctx.strokeStyle = "#4ade80";
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(px, padT);
        ctx.lineTo(px, padT + plotH);
        ctx.stroke();
        ctx.fillStyle = "#4ade80";
        ctx.beginPath();
        ctx.arc(px, padT + plotH, 4 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    if (scrubDist != null && scrubDist >= visStart && scrubDist <= visEnd) {
      const px = xPos(scrubDist);
      ctx.save();
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(px, padT);
      ctx.lineTo(px, padT + plotH);
      ctx.stroke();
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.arc(px, padT, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (groundProfile && groundProfile.length) {
      const visibleGround = [];
      for (let i = 0; i < groundProfile.length; i++) {
        const g = groundProfile[i];
        const inRange = g.distKm >= visStart && g.distKm <= visEnd;
        const prevOut = i > 0 && groundProfile[i - 1].distKm < visStart;
        const nextOut = i < groundProfile.length - 1 && groundProfile[i + 1].distKm > visEnd;
        if (inRange || prevOut && g.distKm < visStart || nextOut && g.distKm > visEnd) visibleGround.push(g);
      }
      const clampX = (x) => Math.max(padL, Math.min(padL + plotW, x));
      const firstElev = visibleGround.find((g) => g.elev != null)?.elev;
      const lastElev = [...visibleGround].reverse().find((g) => g.elev != null)?.elev;
      ctx.beginPath();
      ctx.moveTo(xPos(visStart), firstElev != null ? yPos(firstElev) : padT + plotH);
      visibleGround.forEach((g) => {
        if (g.elev != null) ctx.lineTo(clampX(xPos(g.distKm)), yPos(g.elev));
      });
      if (lastElev != null) ctx.lineTo(xPos(visEnd), yPos(lastElev));
      ctx.lineTo(xPos(visEnd), padT + plotH);
      ctx.lineTo(xPos(visStart), padT + plotH);
      ctx.closePath();
      ctx.fillStyle = "rgba(120,72,32,0.55)";
      ctx.fill();
      ctx.strokeStyle = "rgba(150,95,45,0.9)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      let started = false;
      visibleGround.forEach((g) => {
        if (g.elev != null) {
          const px = clampX(xPos(g.distKm)), py = yPos(g.elev);
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else ctx.lineTo(px, py);
        }
      });
      ctx.stroke();
    }
    for (let i = 1; i < track.length; i++) {
      if (distances[i] < visStart && distances[i - 1] < visStart) continue;
      if (distances[i - 1] > visEnd && distances[i] > visEnd) continue;
      const t = (track[i].gpsAlt - minA) / altRange;
      ctx.strokeStyle = `hsl(${t * 240},100%,50%)`;
      ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(xPos(distances[i - 1]), yPos(track[i - 1].gpsAlt));
      ctx.lineTo(xPos(distances[i]), yPos(track[i].gpsAlt));
      ctx.stroke();
    }
  }, [track, distances, totalDist, groundProfile, viewStart, viewScale, playbackDistanceScaled, isPlaybackActive, scrubDist, canvasResizeTick]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setCanvasResizeTick((t) => t + 1));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [fullscreenSlot]);
  if (!track.length) return null;
  const chart = fullscreenSlot ? /* @__PURE__ */ React.createElement("div", { style: { width: "100%", height: "100%", boxSizing: "border-box" } }, /* @__PURE__ */ React.createElement("canvas", { ref: canvasRef, style: { width: "100%", height: "100%", display: "block", touchAction: "none" } })) : /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 6 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: "#7dd3fc", letterSpacing: 1.5, textTransform: "uppercase" } }, "Höhenprofil")), /* @__PURE__ */ React.createElement("div", { style: { borderRadius: 14, overflow: "hidden", border: "1px solid rgba(100,180,255,0.12)", background: "#040e20" } }, /* @__PURE__ */ React.createElement("canvas", { ref: canvasRef, style: { width: "100%", height: 160, display: "block", touchAction: "none" } })), groundError && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "rgba(232,244,253,0.35)", marginTop: 4 } }, "Bodenprofil für den Flug-Teil momentan nicht verfügbar (Höhendaten-Dienst nicht erreichbar) — Trace wird trotzdem angezeigt."), manualDist > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "rgba(232,244,253,0.3)", marginTop: 4 } }, "Streckenachse proportional auf die eingetragene Distanz (", manualDist, " km) skaliert."), zoomLevel > 1 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "rgba(232,244,253,0.3)", marginTop: 2 } }, "Im Profil wischen, um den sichtbaren Ausschnitt zu verschieben."));
  return /* @__PURE__ */ React.createElement(React.Fragment, null, fullscreenSlot ? ReactDOM.createPortal(chart, fullscreenSlot) : chart, controlsSlot && ReactDOM.createPortal(
    /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", flex: "1.15 1 0", minWidth: 0 } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setZoomPickerOpen((o) => !o),
        style: { width: "100%", height: 34, boxSizing: "border-box", background: "rgba(220,38,38,0.18)", border: "1px solid rgba(220,38,38,0.4)", borderRadius: 8, color: "#f87171", fontSize: 12, fontWeight: 700, cursor: "pointer" }
      },
      "🔍",
      zoomLevel,
      "×▾"
    ), zoomPickerOpen && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { onClick: () => setZoomPickerOpen(false), style: { position: "fixed", inset: 0, zIndex: 249 } }), /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: (e) => e.stopPropagation(),
        style: { position: "absolute", bottom: "calc(100% + 4px)", left: 0, background: "#14253a", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: 2, minWidth: 70, zIndex: 250 }
      },
      [1, 2, 3, 4, 5, 6, 7, 8].map((z) => /* @__PURE__ */ React.createElement(
        "button",
        {
          key: z,
          onClick: () => {
            setZoomLevel(z);
            setPanPos(0);
            setZoomPickerOpen(false);
          },
          style: { background: z === zoomLevel ? "rgba(125,211,252,0.2)" : "transparent", border: "none", borderRadius: 6, padding: "6px 10px", color: z === zoomLevel ? "#7dd3fc" : "#e8f4fd", fontSize: 13, fontWeight: z === zoomLevel ? 700 : 400, cursor: "pointer", textAlign: "left" }
        },
        z,
        "×"
      ))
    ))), zoomLevel > 1 && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setZoomLevel(1),
        title: "Zoom zurücksetzen",
        style: { flex: "0.85 1 0", minWidth: 0, height: 34, boxSizing: "border-box", background: "rgba(220,38,38,0.18)", border: "1px solid rgba(220,38,38,0.4)", borderRadius: 8, color: "#f87171", fontSize: 16, cursor: "pointer" }
      },
      "↺"
    )),
    controlsSlot
  ));
}
const FORMULA_DEFS = [
  { id: "rank_dur", label: "Rang Flugzeit", icon: "⏱", desc: "#1 = längster Flug" },
  { id: "rank_dist", label: "Rang Distanz", icon: "📏", desc: "#1 = weitester Flug" },
  { id: "rank_alt", label: "Rang Höhe", icon: "⬆", desc: "#1 = höchster Flug" },
  { id: "pr_dur", label: "Persönl. Rekord Dauer", icon: "🏆", desc: "Ja / Nein" },
  { id: "pr_dist", label: "Persönl. Rekord Distanz", icon: "🏆", desc: "Ja / Nein" },
  { id: "pr_alt", label: "Persönl. Rekord Höhe", icon: "🏆", desc: "Ja / Nein" },
  { id: "season_flights", label: "Saison-Flüge", icon: "📅", desc: "Anzahl Flüge im Jahr" },
  { id: "season_hours", label: "Saison-Stunden", icon: "⏱", desc: "Total Stunden im Jahr" }
];
function evalFormula(id, flight, allFlights) {
  const sorted = (key) => [...allFlights].sort((a, b) => b[key] - a[k]);
  const yf = allFlights.filter((f) => f.year === flight.year);
  switch (id) {
    case "rank_dur":
      return "#" + ([...allFlights].sort((a, b) => b.durationSec - a.durationSec).findIndex((f) => f.id === flight.id) + 1);
    case "rank_dist":
      return "#" + ([...allFlights].sort((a, b) => b.totalDist - a.totalDist).findIndex((f) => f.id === flight.id) + 1);
    case "rank_alt":
      return "#" + ([...allFlights].sort((a, b) => b.maxAlt - a.maxAlt).findIndex((f) => f.id === flight.id) + 1);
    case "pr_dur":
      return flight.durationSec >= Math.max(...allFlights.map((f) => f.durationSec)) ? "🏆 Ja" : "Nein";
    case "pr_dist":
      return flight.totalDist >= Math.max(...allFlights.map((f) => f.totalDist)) ? "🏆 Ja" : "Nein";
    case "pr_alt":
      return flight.maxAlt >= Math.max(...allFlights.map((f) => f.maxAlt)) ? "🏆 Ja" : "Nein";
    case "season_flights":
      return yf.length;
    case "season_hours": {
      const s = yf.reduce((a, f) => a + f.durationSec, 0);
      return `${Math.floor(s / 3600)}h${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}m`;
    }
    default:
      return "—";
  }
}
function FieldEditor({ customFieldDefs, onSave, onClose }) {
  const [defs, setDefs] = useState(customFieldDefs);
  const add = (type) => setDefs((d) => [...d, { id: `cf_${Date.now()}`, name: "", type, formula: "" }]);
  const update = (id, key, val) => setDefs((d) => d.map((f) => f.id === id ? { ...f, [key]: val } : f));
  const remove = (id) => setDefs((d) => d.filter((f) => f.id !== id));
  return /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { background: "#0f2033", borderRadius: 20, padding: 20, width: "100%", maxWidth: 420, maxHeight: "80vh", overflowY: "auto", border: "1px solid rgba(100,180,255,0.15)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } }, /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 800, fontSize: 16 } }, "Eigene Felder"), /* @__PURE__ */ React.createElement("button", { onClick: onClose, style: { background: "none", border: "none", color: "#7dd3fc", fontSize: 20, cursor: "pointer" } }, "✕")), defs.map((f) => /* @__PURE__ */ React.createElement("div", { key: f.id, style: { background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: 12, marginBottom: 8 } }, f.formula ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, FORMULA_DEFS.find((d) => d.id === f.formula)?.icon, " ", f.name), /* @__PURE__ */ React.createElement("button", { onClick: () => remove(f.id), style: { background: "none", border: "none", color: "#f87171", cursor: "pointer" } }, "✕")) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      value: f.name,
      onChange: (e) => update(f.id, "name", e.target.value),
      placeholder: "Feldname",
      style: { flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 10px", color: "#e8f4fd", fontSize: 13 }
    }
  ), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: f.type,
      onChange: (e) => update(f.id, "type", e.target.value),
      style: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 8px", color: "#e8f4fd", fontSize: 12 }
    },
    /* @__PURE__ */ React.createElement("option", { value: "text" }, "Text"),
    /* @__PURE__ */ React.createElement("option", { value: "number" }, "Zahl"),
    /* @__PURE__ */ React.createElement("option", { value: "date" }, "Datum")
  ), /* @__PURE__ */ React.createElement("button", { onClick: () => remove(f.id), style: { background: "none", border: "none", color: "#f87171", cursor: "pointer" } }, "✕")))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12, marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 } }, "Manuell hinzufügen"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, ["text", "number", "date"].map((t) => /* @__PURE__ */ React.createElement("button", { key: t, onClick: () => add(t), style: { flex: 1, background: "rgba(100,180,255,0.1)", border: "1px solid rgba(100,180,255,0.2)", borderRadius: 10, padding: "8px 4px", color: "#7dd3fc", fontSize: 12, cursor: "pointer" } }, "+ ", t === "text" ? "Text" : t === "number" ? "Zahl" : "Datum")))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 } }, "Auto-Formeln"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 } }, FORMULA_DEFS.filter((fd) => !defs.find((d) => d.formula === fd.id)).map((fd) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: fd.id,
      onClick: () => setDefs((d) => [...d, { id: `auto_${fd.id}`, name: fd.label, type: "auto", formula: fd.id }]),
      style: { background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)", borderRadius: 20, padding: "5px 10px", color: "#c4b5fd", fontSize: 11, cursor: "pointer" }
    },
    fd.icon,
    " ",
    fd.label
  ))), /* @__PURE__ */ React.createElement("button", { onClick: () => onSave(defs), style: { width: "100%", background: "linear-gradient(135deg,#0ea5e9,#0284c7)", border: "none", borderRadius: 12, padding: 12, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14 } }, "Speichern")));
}
function lv03ToWgs84(e, n) {
  const y = (e - 6e5) / 1e6, x = (n - 2e5) / 1e6;
  let lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y;
  let lat = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 2528e-6 * x * x - 0.0447 * y * y * x - 0.014 * x * x * x;
  return { lat: lat * 100 / 36, lon: lon * 100 / 36 };
}
const FORMULA_PLACEHOLDER = "#F#";
const CSV_COLUMN_DEFS = [
  { key: "nr", label: "Nr.", getter: "nr" },
  { key: "flugreise", label: "Flugreise", getter: "flugreise" },
  { key: "datum", label: "Datum", getter: "datum" },
  { key: "startzeit", label: "Startzeit", getter: "startzeit" },
  { key: "start", label: "Start", getter: "start" },
  { key: "landezeit", label: "Landezeit", getter: "landezeit" },
  { key: "landung", label: "Landung", getter: "landung" },
  { key: "sl_entf", label: "S-L Entf.", getter: null },
  { key: "dauer", label: "Dauer", getter: null },
  { key: "rang", label: "Rang", getter: null },
  { key: "prozent", label: "%", getter: null },
  { key: "distanz", label: "Distanz", getter: "distanz" },
  { key: "kmh", label: "km/h", getter: null },
  { key: "hdiff", label: "H.Diff.", getter: null },
  { key: "muemS", label: "müM S", getter: "muemS" },
  { key: "muemL", label: "müM L", getter: "muemL" },
  { key: "hmax", label: "H.Max", getter: "hmax" },
  { key: "sue", label: "SÜ", getter: null },
  { key: "hgew", label: "H.Gew.", getter: "hgew" },
  { key: "sinken", label: "Sinken", getter: "sinken" },
  { key: "steigen", label: "Steigen", getter: "steigen" },
  { key: "geraet", label: "Gerät", getter: "geraet" },
  { key: "datum2", label: "Datum2", getter: null },
  { key: "bemerkung", label: "Bemerkung", getter: "bemerkung" }
];
function flightToCsvValues(f) {
  const cf = f.customFields || {};
  const combineLocation = (name, altStr, pt) => {
    const parts = [];
    if (name) parts.push(name);
    if (altStr) parts.push(String(altStr));
    if (pt && pt.lat != null && pt.lon != null) {
      parts.push(pt.lat.toFixed(5));
      parts.push(pt.lon.toFixed(5));
    }
    return parts.join(", ");
  };
  return {
    nr: f.name || "",
    flugreise: "",
    datum: f.rawDate || f.date || "",
    startzeit: f.startTime || "",
    start: combineLocation(f.site || "", f.startAlt ? String(f.startAlt) : cf.msa || "", f.startPt),
    landezeit: f.endTime || "",
    landung: combineLocation(cf.landung || "", f.endAlt ? String(f.endAlt) : cf.ml || "", f.endPt),
    distanz: f.totalDist ? String(f.totalDist) : cf.distKm || "",
    muemS: f.startAlt ? String(f.startAlt) : cf.msa || "",
    muemL: f.endAlt ? String(f.endAlt) : cf.ml || "",
    hmax: f.maxAlt ? String(f.maxAlt) : cf.hMax || "",
    hgew: cf.hGew || "",
    sinken: cf.maxSinken || "",
    steigen: cf.maxSteigen || "",
    geraet: f.glider || "",
    bemerkung: f.notes || ""
  };
}
function buildCsvRow(f, columnKeys) {
  const values = flightToCsvValues(f);
  return columnKeys.map((key) => {
    const def = CSV_COLUMN_DEFS.find((c) => c.key === key);
    if (!def) return "";
    return def.getter ? values[def.getter] || "" : FORMULA_PLACEHOLDER;
  }).join("	");
}
function coordsToWgs84(a, b) {
  const af = parseFloat(String(a).replace(",", ".")), bf = parseFloat(String(b).replace(",", "."));
  if (isNaN(af) || isNaN(bf)) return { lat: null, lon: null };
  if (Math.abs(af) <= 90 && Math.abs(bf) <= 180) return { lat: af, lon: bf };
  const r = lv03ToWgs84(af, bf);
  return { lat: Math.round(r.lat * 1e6) / 1e6, lon: Math.round(r.lon * 1e6) / 1e6 };
}
function splitCsvLine(line) {
  const cols = [];
  let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) {
      cols.push(cur);
      cur = "";
    } else cur += ch;
  }
  cols.push(cur);
  return cols;
}
function parseCompactField(field) {
  const parts = (field || "").split(",").map((s) => s.trim());
  return { name: parts[0] || "", alt: parts[1] || "", chE: parts[2] || "", chN: parts[3] || "" };
}
function parseCompactNumbersRow(cols) {
  const get = (i) => (cols[i] || "").trim();
  const start = parseCompactField(get(4));
  const land = parseCompactField(get(6));
  const s = coordsToWgs84(start.chE, start.chN);
  const l = coordsToWgs84(land.chE, land.chN);
  return {
    d: get(2),
    sz: get(3),
    lz: get(5),
    st: start.name,
    la: land.name,
    sLat: s.lat,
    sLon: s.lon,
    lLat: l.lat,
    lLon: l.lon,
    dur: get(8),
    dk: get(11),
    kmh: get(12),
    hd: get(13),
    msa: get(14) || start.alt,
    ml: get(15) || land.alt,
    hm: get(16),
    hg: get(18),
    ms: get(19),
    mst: get(20),
    ge: get(21),
    be: get(24),
    _nr: get(0),
    _colCount: 53
    // treat as valid — this is the compact 25-col format
  };
}
function parseMultipleRows(text) {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    try {
      const p = parseSingleRow(line);
      return { raw: line, p, error: null };
    } catch (e) {
      return { raw: line, p: null, error: e.message };
    }
  });
}
function parseSingleRow(rowText) {
  const raw = rowText.replace(/\r/g, "");
  let cols;
  let isTabSeparated = false;
  if (raw.includes("	")) {
    cols = raw.split("	");
    isTabSeparated = true;
  } else if (raw.includes("\n") && !raw.includes(",")) {
    cols = raw.split("\n");
  } else if (raw.includes("\n")) {
    const lines = raw.split("\n").map((l2) => l2.trim()).filter(Boolean);
    const dataLine = lines[lines.length - 1] || raw;
    cols = splitCsvLine(dataLine);
    if (cols.length < 20) cols = splitCsvLine(raw);
  } else {
    cols = splitCsvLine(raw);
  }
  cols = cols.map((c) => (c || "").trim().replace(/^"+|"+$/g, ""));
  if (isTabSeparated && cols.length >= 20 && cols.length <= 30) {
    const field4 = cols[4] || "";
    if (field4.split(",").length >= 3) {
      return parseCompactNumbersRow(cols);
    }
  }
  const get = (i) => cols[i] || "";
  const s = coordsToWgs84(get(12), get(13));
  const l = coordsToWgs84(get(25), get(26));
  return {
    d: get(5),
    sz: get(6),
    lz: get(20),
    st: get(10),
    la: get(23),
    sLat: s.lat,
    sLon: s.lon,
    lLat: l.lat,
    lLon: l.lon,
    dur: get(34),
    dk: get(37),
    kmh: get(38),
    hd: get(39),
    msa: get(40),
    ml: get(41),
    hm: get(42),
    hg: get(44),
    ms: get(45),
    mst: get(46),
    ge: get(47),
    be: get(52),
    _nr: get(0),
    _colCount: cols.length
  };
}
function createFlightFromPDF(nr, p) {
  let dateStr = "", yr = "", mo = "";
  if (p.d) {
    const parts = p.d.split(".");
    if (parts.length === 3) {
      const dd = parts[0].padStart(2, "0"), mm = parts[1].padStart(2, "0");
      const y2 = +parts[2];
      yr = parts[2].length === 2 ? (y2 >= 30 ? "19" : "20") + parts[2] : parts[2];
      mo = mm;
      dateStr = `${dd}.${mm}.${yr}`;
    }
  }
  let durationSec = 0;
  const durStr = p.dur || "";
  if (durStr) {
    const dm = durStr.match(/(\d+):(\d{2}):(\d{2})/);
    if (dm) durationSec = +dm[1] * 3600 + +dm[2] * 60 + +dm[3];
    else {
      const dm2 = durStr.match(/(\d+):(\d{2})/);
      const dm3 = durStr.match(/(\d+)\s*h\s*(\d+)\s*m/i);
      if (dm2) durationSec = +dm2[1] * 3600 + +dm2[2] * 60;
      else if (dm3) durationSec = +dm3[1] * 3600 + +dm3[2] * 60;
    }
  }
  const startPt = p.sLat && p.sLon ? { lat: +p.sLat, lon: +p.sLon, gpsAlt: +(p.msa || 0) } : null;
  const endPt = p.lLat && p.lLon ? { lat: +p.lLat, lon: +p.lLon, gpsAlt: +(p.ml || 0) } : null;
  const track = [];
  return {
    id: `pdf_${nr}_${Date.now()}`,
    pdfOnly: true,
    name: nr,
    date: dateStr,
    rawDate: p.d || "",
    year: yr,
    month: mo,
    pilot: "",
    site: p.st || "",
    glider: p.ge || "",
    startTime: p.sz || "",
    endTime: p.lz || "",
    durationSec,
    durationStr: durationSec ? formatDurationHM(durationSec) : "",
    maxAlt: +(p.hm || 0),
    minAlt: +(p.ml || 0),
    startAlt: +(p.msa || 0),
    endAlt: +(p.ml || 0),
    totalDist: parseFloat(p.dk || 0) || 0,
    thermalCount: 0,
    maxClimb: +(p.mst || 0),
    track,
    startPt,
    endPt,
    comment: "",
    notes: p.be || "",
    customFields: {
      landung: p.la || "",
      distKm: p.dk || "",
      kmh: p.kmh || "",
      hDiff: p.hd || "",
      hMax: p.hm || "",
      hGew: p.hg || "",
      maxSinken: p.ms || "",
      maxSteigen: p.mst || "",
      typ: p.ty || ""
    }
  };
}
const SCHIRME_KEY = "schirme:list";
const KNOWN_SCHIRM_HERSTELLER = [
  "Advance",
  "Airdesign",
  "APCO",
  "BGD",
  "Dudek",
  "Flow",
  "Gin",
  "Gradient",
  "Independence",
  "MacPara",
  "Niviuk",
  "Nova",
  "Ozone",
  "Paratech",
  "Skywalk",
  "Sky",
  "Supair",
  "Swing",
  "Triple Seven",
  "UP",
  "U-Turn",
  "Windtech"
];
function splitFirstWordAsHersteller(raw) {
  const name = (raw || "").trim();
  for (const hersteller of KNOWN_SCHIRM_HERSTELLER) {
    const re = new RegExp(`^${hersteller}\\s+(.+)$`, "i");
    const m = name.match(re);
    if (m) return { hersteller, cleaned: m[1].trim() };
  }
  return { hersteller: "", cleaned: name };
}
function getDisplayDistance(fl) {
  if (fl?.totalDist) return String(fl.totalDist);
  return fl?.customFields?.distKm || fl?.customFields?.dk || "";
}
function simplifyTrackDP(track, epsilonKm) {
  if (track.length <= 2) return track;
  const toXY = (pt, ref) => {
    const R = 6371;
    const x = (pt.lon - ref.lon) * Math.PI / 180 * R * Math.cos(ref.lat * Math.PI / 180);
    const y = (pt.lat - ref.lat) * Math.PI / 180 * R;
    return { x, y };
  };
  const perpDistKm = (p, a, b) => {
    const P = toXY(p, a), A = { x: 0, y: 0 }, B = toXY(b, a);
    const dx = B.x - A.x, dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(P.x - A.x, P.y - A.y);
    const t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
    return Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy));
  };
  const keep = new Array(track.length).fill(false);
  keep[0] = true;
  keep[track.length - 1] = true;
  const stack = [[0, track.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    if (end - start < 2) continue;
    let maxDist = -1, maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDistKm(track[i], track[start], track[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > epsilonKm) {
      keep[maxIdx] = true;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }
  return track.filter((_, i) => keep[i]);
}
function computeOpenDistancePath(track) {
  if (!track || track.length < 2) return null;
  let epsilon = 0.05;
  let candidates = simplifyTrackDP(track, epsilon);
  let tries = 0;
  while (candidates.length > 400 && tries < 8) {
    epsilon *= 1.8;
    candidates = simplifyTrackDP(track, epsilon);
    tries++;
  }
  if (candidates.length > 600) {
    const stride = Math.ceil(candidates.length / 600);
    candidates = candidates.filter((_, i2) => i2 % stride === 0 || i2 === candidates.length - 1);
  }
  const k2 = candidates.length;
  if (k2 < 2) return null;
  const dist = (i2, j) => haversineDistKm(candidates[i2], candidates[j]) || 0;
  const breakTimes = computeTrackBreakTimes(track);
  const MAX_LEGS = 4;
  const best = Array.from({ length: MAX_LEGS + 1 }, () => new Float64Array(k2).fill(-Infinity));
  const parent = Array.from({ length: MAX_LEGS + 1 }, () => new Int32Array(k2).fill(-1));
  for (let i2 = 0; i2 < k2; i2++) best[0][i2] = 0;
  let overallBest = 0, overallL = 0, overallI = 0;
  for (let L2 = 1; L2 <= MAX_LEGS; L2++) {
    for (let i2 = 0; i2 < k2; i2++) {
      let localBest = -Infinity, localJ = -1;
      for (let j = 0; j < i2; j++) {
        if (best[L2 - 1][j] === -Infinity) continue;
        if (anyBreakBetween(breakTimes, candidates[j].timeSec, candidates[i2].timeSec)) continue;
        const cand = best[L2 - 1][j] + dist(j, i2);
        if (cand > localBest) {
          localBest = cand;
          localJ = j;
        }
      }
      best[L2][i2] = localBest;
      parent[L2][i2] = localJ;
      if (localBest > overallBest) {
        overallBest = localBest;
        overallL = L2;
        overallI = i2;
      }
    }
  }
  if (overallL === 0) return { points: [candidates[0]], km: 0 };
  const chain = [];
  let L = overallL, i = overallI;
  while (L >= 0) {
    chain.push(i);
    if (L === 0) break;
    const j = parent[L][i];
    if (j === -1) break;
    L -= 1;
    i = j;
  }
  chain.reverse();
  return { points: chain.map((idx) => candidates[idx]), km: +overallBest.toFixed(1) };
}
function computeOpenDistanceKm(track) {
  const r = computeOpenDistancePath(track);
  return r ? r.km : null;
}
function computeDistanceRoute(track) {
  return computeOpenDistancePath(track);
}
function computeDistanceSpeedBackfill(existingTotalDist, cf, scoreDistanceKm, durationSec) {
  const hasDist = existingTotalDist > 0 || !!(cf?.distKm || "").trim();
  let distKm = hasDist ? existingTotalDist || parseFloat(cf?.distKm) || 0 : null;
  const result = {};
  if (!hasDist && scoreDistanceKm != null && scoreDistanceKm > 0) {
    distKm = scoreDistanceKm;
    result.totalDist = scoreDistanceKm;
    result.distKm = String(scoreDistanceKm);
  }
  const hasSpeed = !!(cf?.kmh || "").trim();
  if (!hasSpeed && distKm && durationSec > 0) {
    result.kmh = String(+(distKm / (durationSec / 3600)).toFixed(1));
  }
  return result;
}
function haversineDistKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function requestGeoPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolokalisierung wird von diesem Browser nicht unterstützt."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(new Error(
        err.code === err.PERMISSION_DENIED ? "Standortzugriff wurde verweigert." : "Standort konnte nicht ermittelt werden."
      )),
      { enableHighAccuracy: false, timeout: 15e3, maximumAge: 5 * 60 * 1e3 }
    );
  });
}
function parseNearbyValue(raw) {
  const m = String(raw ?? "").trim().match(/^(-?\d+(?:[.,]\d+)?)(?:@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const radiusKm = parseFloat(m[1].replace(",", "."));
  if (!isFinite(radiusKm) || radiusKm <= 0) return null;
  return {
    radiusKm,
    lat: m[2] != null ? parseFloat(m[2]) : null,
    lon: m[3] != null ? parseFloat(m[3]) : null
  };
}
function findNearbyFieldValue(pt, flights, getPoint, getValue, radiusKm) {
  if (!pt) return "";
  let best = "", bestDist = Infinity;
  for (const f of flights) {
    const fp = getPoint(f);
    if (!fp) continue;
    const val = (getValue(f) || "").trim();
    if (!val) continue;
    const d = haversineDistKm(pt, fp);
    if (d != null && d <= radiusKm && d < bestDist) {
      bestDist = d;
      best = val;
    }
  }
  return best;
}
async function reverseGeocodeCountry(pt, apiKey) {
  if (!pt || !apiKey) return "";
  try {
    const url = `https://api.maptiler.com/geocoding/${pt.lon},${pt.lat}.json?key=${apiKey}&types=country&language=de`;
    const res = await fetch(url);
    if (!res.ok) return "";
    const data = await res.json();
    const feature = data?.features?.[0];
    return (feature?.text || feature?.place_name || "").trim();
  } catch (e) {
    console.error("MapTiler reverse geocoding failed:", e);
    return "";
  }
}
async function inferPlaceAndCountry(startPt, endPt, flights, radiusKm, apiKey) {
  const site = findNearbyFieldValue(startPt, flights, (f) => f.startPt, (f) => f.site, radiusKm);
  const landung = findNearbyFieldValue(endPt, flights, (f) => f.endPt, (f) => f.customFields?.landung, radiusKm);
  let land = findNearbyFieldValue(startPt, flights, (f) => f.startPt, (f) => f.customFields?.land, radiusKm);
  if (!land && startPt) land = await reverseGeocodeCountry(startPt, apiKey);
  return { site, landung, land };
}
function bearingDeg(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return 0;
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function attachComputedRanks(flights) {
  return flights.map((f) => {
    const sl = haversineDistKm(f.startPt, f.endPt);
    return { ...f, entfernungSL: sl != null ? +sl.toFixed(1) : null };
  });
}
function parseDurToSec(s) {
  if (s == null) return 0;
  s = String(s).trim();
  let m = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  m = s.match(/^(\d+):(\d{2})$/);
  if (m) return +m[1] * 3600 + +m[2] * 60;
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*h(?:\s*(\d+)\s*m)?$/i);
  if (m) return Math.round(+m[1].replace(",", ".") * 3600) + (m[2] ? +m[2] * 60 : 0);
  m = s.match(/^(\d+)\s*m(?:in)?$/i);
  if (m) return +m[1] * 60;
  m = s.match(/^(\d+(?:[.,]\d+)?)$/);
  if (m) return Math.round(+m[1].replace(",", ".") * 3600);
  return 0;
}
function flightFieldValue(f, field) {
  const cf = f.customFields || {};
  switch (field) {
    case "name":
    case "titel":
      return f.name || "";
    case "site":
    case "start":
    case "startplatz":
      return f.site || "";
    case "landung":
    case "landeplatz":
      return cf.landung || "";
    case "land":
    case "country":
      return cf.land || "";
    case "schirm":
    case "glider":
    case "gerät":
    case "geraet":
      return f.glider || "";
    case "typ":
    case "type":
      return cf.typ || "";
    case "pilot":
      return f.pilot || "";
    case "reise":
      return cf.reise || "";
    case "jahr":
    case "year":
      return f.year || "";
    case "datum":
    case "date":
      return f.date || "";
    case "startzeit":
    case "starttime":
      return f.startTime || "";
    case "landezeit":
    case "endtime":
      return f.endTime || "";
    case "kommentar":
    case "comment":
      return f.comment || "";
    case "bemerkung":
    case "notes":
    case "notiz":
      return f.notes || "";
    case "dauer":
    case "duration":
      return (f.durationSec || parseDurToSec(f.durationStr)) / 3600;
    // hours (number)
    case "distanz":
    case "dist":
    case "km":
      return f.totalDist || parseFloat(cf.distKm || cf.dk || 0) || 0;
    case "maxspeed":
      return f.maxSpeedKmh || 0;
    case "höhe":
    case "hoehe":
    case "maxhöhe":
    case "maxhoehe":
    case "alt":
      return f.maxAlt || +(cf.hMax || cf.hm || 0) || 0;
    case "startalt":
      return f.startAlt || +(cf.msa || 0) || 0;
    case "endalt":
      return f.endAlt || +(cf.ml || 0) || 0;
    case "hdiff":
      return +(cf.hDiff || 0) || 0;
    case "maxsteigen":
      return +(cf.maxSteigen || 0) || 0;
    case "maxsteigen20":
      return +(cf.maxSteigen20 || 0) || 0;
    case "maxsinken":
      return +(cf.maxSinken || 0) || 0;
    case "hgew":
      return +(cf.hGew || 0) || 0;
    case "spiralemaxsinken":
      return +(cf.spiraleMaxSinken || 0) || 0;
    case "spiralesinkenschnitt":
      return +(cf.spiraleSinkenSchnitt || 0) || 0;
    case "spiralekreise":
    case "spiraleanzahlkreise":
      return +(cf.spiraleAnzahlKreise || 0) || 0;
    case "spiralehoehenabbau":
      return +(cf.spiraleHoehenabbau || 0) || 0;
    case "wingovermaxsinken":
      return +(cf.wingoverMaxSinken || 0) || 0;
    case "wingoversinkenschnitt":
      return +(cf.wingoverSinkenSchnitt || 0) || 0;
    case "wingoveranzahl":
    case "wingovers":
      return +(cf.wingoverAnzahl || 0) || 0;
    case "wingoverhoehenabbau":
      return +(cf.wingoverHoehenabbau || 0) || 0;
    case "entfernungsl":
      return f.entfernungSL || 0;
    case "startlat":
      return f.startPt?.lat || 0;
    case "startlon":
      return f.startPt?.lon || 0;
    case "endlat":
      return f.endPt?.lat || 0;
    case "endlon":
      return f.endPt?.lon || 0;
    case "speed":
    case "kmh":
      return parseFloat(cf.kmh || 0) || 0;
    default:
      return "";
  }
}
function evalToken(f, tok) {
  let m = tok.match(/^([\wäöü]+)\s*(>=|<=|!=|≠|>|<|=|:)\s*(.+)$/i);
  if (m) {
    const field = m[1].toLowerCase(), op = m[2] === "≠" ? "!=" : m[2], raw = m[3].trim().replace(/^"(.*)"$/, "$1");
    if (field === "igc" || field === "training" || field === "ogoy") {
      const has = field === "igc" ? f.track?.length > 1 : field === "ogoy" ? !!(f.customFields?.ogoy || "").trim() : (f.customFields?.training || "").trim().toUpperCase() === "T";
      const want = ["ja", "vorhanden", "true", "1"].includes(raw.toLowerCase());
      return op === "!=" ? has !== want : has === want;
    }
    if (field === "naehe" || field === "nähe" || field === "umkreis") {
      const parsed = parseNearbyValue(raw);
      if (!parsed || parsed.lat == null || parsed.lon == null) return true;
      const userPt = { lat: parsed.lat, lon: parsed.lon };
      const dStart = haversineDistKm(userPt, f.startPt);
      const dEnd = haversineDistKm(userPt, f.endPt);
      const dMin = Math.min(dStart ?? Infinity, dEnd ?? Infinity);
      const within = dMin <= parsed.radiusKm;
      return op === "!=" ? !within : within;
    }
    let fv = flightFieldValue(f, field);
    const numericFields = [
      "name",
      "titel",
      "dauer",
      "duration",
      "distanz",
      "dist",
      "km",
      "maxspeed",
      "höhe",
      "hoehe",
      "maxhöhe",
      "maxhoehe",
      "alt",
      "startalt",
      "endalt",
      "hdiff",
      "maxsteigen",
      "maxsteigen20",
      "maxsinken",
      "hgew",
      "entfernungsl",
      "spiralemaxsinken",
      "spiralesinkenschnitt",
      "spiralekreise",
      "spiraleanzahlkreise",
      "spiralehoehenabbau",
      "wingovermaxsinken",
      "wingoversinkenschnitt",
      "wingoveranzahl",
      "wingovers",
      "wingoverhoehenabbau",
      "speed",
      "kmh",
      "jahr",
      "year",
      "startlat",
      "startlon",
      "endlat",
      "endlon"
    ];
    const dateFields = ["datum", "date"];
    const timeFields = ["startzeit", "starttime", "landezeit", "endtime"];
    if (numericFields.includes(field)) {
      let cmp = field === "dauer" || field === "duration" ? parseDurToSec(raw) / 3600 : parseFloat(raw.replace(",", "."));
      fv = parseFloat(fv) || 0;
      if (isNaN(cmp)) return true;
      if (op === ">") return fv > cmp;
      if (op === "<") return fv < cmp;
      if (op === ">=") return fv >= cmp;
      if (op === "<=") return fv <= cmp;
      if (op === "!=") return Math.abs(fv - cmp) >= 1e-4;
      return Math.abs(fv - cmp) < 1e-4;
    }
    if (dateFields.includes(field)) {
      const cmp = parseDateToTs(raw);
      const fvTs = parseDateToTs(fv);
      if (!cmp) return true;
      if (op === ">") return fvTs > cmp;
      if (op === "<") return fvTs < cmp;
      if (op === ">=") return fvTs >= cmp;
      if (op === "<=") return fvTs <= cmp;
      if (op === "!=") return fvTs !== cmp;
      return fvTs === cmp;
    }
    if (timeFields.includes(field)) {
      const toSec = (t) => {
        const m2 = String(t).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        return m2 ? +m2[1] * 3600 + +m2[2] * 60 + +(m2[3] || 0) : null;
      };
      const cmp = toSec(raw), fvSec = toSec(fv);
      if (cmp == null) return true;
      if (fvSec == null) return false;
      if (op === ">") return fvSec > cmp;
      if (op === "<") return fvSec < cmp;
      if (op === ">=") return fvSec >= cmp;
      if (op === "<=") return fvSec <= cmp;
      if (op === "!=") return fvSec !== cmp;
      return fvSec === cmp;
    }
    const fvStr = String(fv), rawStr = raw;
    if (op === ":") return fvStr.toLowerCase().includes(rawStr.toLowerCase());
    if (op === "=") return fvStr.toLowerCase() === rawStr.toLowerCase();
    if (op === "!=") return !fvStr.toLowerCase().includes(rawStr.toLowerCase());
    const cmpAlpha = fvStr.localeCompare(rawStr, "de", { sensitivity: "base" });
    if (op === ">") return cmpAlpha > 0;
    if (op === "<") return cmpAlpha < 0;
    if (op === ">=") return cmpAlpha >= 0;
    if (op === "<=") return cmpAlpha <= 0;
    return fvStr.toLowerCase().includes(rawStr.toLowerCase());
  }
  const hay = [f.name, f.site, f.glider, f.pilot, f.customFields?.landung, f.customFields?.land, f.customFields?.reise, f.comment, f.notes, f.date, f.year].join(" ").toLowerCase();
  return hay.includes(tok.toLowerCase());
}
const SORT_OPTIONS = [
  { id: "number", label: "Nummer" },
  { id: "date", label: "Datum" },
  { id: "jahr", label: "Jahr" },
  { id: "startTime", label: "Startzeit" },
  { id: "endTime", label: "Landezeit" },
  { id: "site", label: "Startplatz" },
  { id: "landung", label: "Landeplatz" },
  { id: "land", label: "Land" },
  { id: "glider", label: "Schirm" },
  { id: "typ", label: "Typ" },
  { id: "reise", label: "Reise" },
  { id: "duration", label: "Dauer" },
  { id: "dist", label: "Distanz" },
  { id: "maxSpeed", label: "Max Speed" },
  { id: "alt", label: "Max. Höhe" },
  { id: "startAlt", label: "Start müM" },
  { id: "endAlt", label: "Landung müM" },
  { id: "hDiff", label: "H.Diff." },
  { id: "speed", label: "Ø Speed" },
  { id: "maxSteigen", label: "Max.Steigen" },
  { id: "maxSteigen20", label: "Max.Steigen 20s" },
  { id: "maxSinken", label: "Max.Sinken" },
  { id: "hGew", label: "H.Gew." },
  { id: "entfernungSL", label: "Entf. S-L" },
  { id: "spiraleMaxSinken", label: "Spirale Max.Sinken" },
  { id: "spiraleSinkenSchnitt", label: "Spirale Ø Sinken" },
  { id: "spiraleAnzahlKreise", label: "Spirale Kreise" },
  { id: "spiraleHoehenabbau", label: "Spirale Höhenabbau" },
  { id: "wingoverMaxSinken", label: "Wingover Max.Sinken" },
  { id: "wingoverSinkenSchnitt", label: "Wingover Ø Sinken" },
  { id: "wingoverAnzahl", label: "Anzahl Wingover" },
  { id: "wingoverHoehenabbau", label: "Wingover Höhenabbau" }
];
function parseDateToTs(d, timeStr) {
  if (!d) return 0;
  const m = String(d).match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return 0;
  let [_, dd, mm, yy] = m;
  yy = yy.length === 2 ? +yy >= 30 ? "19" + yy : "20" + yy : yy;
  let hh = 0, min = 0, sec = 0;
  if (timeStr) {
    const tm = String(timeStr).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (tm) {
      hh = +tm[1];
      min = +tm[2];
      sec = +(tm[3] || 0);
    }
  }
  return new Date(+yy, +mm - 1, +dd, hh, min, sec).getTime();
}
function sortFieldValue(f, sortId) {
  const cf = f.customFields || {};
  switch (sortId) {
    case "year":
      return f.year || 0;
    case "date":
      return parseDateToTs(f.date || f.rawDate, f.startTime);
    case "number":
    case "name":
      return parseInt((f.name || "").match(/\d+/)?.[0] || "0", 10);
    case "startTime":
      return parseDurToSec(f.startTime);
    case "endTime":
      return parseDurToSec(f.endTime);
    case "duration":
      return f.durationSec || parseDurToSec(f.durationStr);
    case "dist":
      return f.totalDist || parseFloat(cf.distKm || cf.dk || 0) || 0;
    case "maxSpeed":
      return f.maxSpeedKmh || 0;
    case "alt":
      return f.maxAlt || +(cf.hMax || cf.hm || 0) || 0;
    case "startAlt":
      return f.startAlt || +(cf.msa || 0) || 0;
    case "endAlt":
      return f.endAlt || +(cf.ml || 0) || 0;
    case "hDiff":
      return +(cf.hDiff || 0) || 0;
    case "maxSteigen":
      return +(cf.maxSteigen || 0) || 0;
    case "maxSteigen20":
      return +(cf.maxSteigen20 || 0) || 0;
    case "maxSinken":
      return +(cf.maxSinken || 0) || 0;
    case "hGew":
      return +(cf.hGew || 0) || 0;
    case "entfernungSL":
      return f.entfernungSL || 0;
    case "spiraleMaxSinken":
      return +(cf.spiraleMaxSinken || 0) || 0;
    case "spiraleSinkenSchnitt":
      return +(cf.spiraleSinkenSchnitt || 0) || 0;
    case "spiraleAnzahlKreise":
      return +(cf.spiraleAnzahlKreise || 0) || 0;
    case "spiraleHoehenabbau":
      return +(cf.spiraleHoehenabbau || 0) || 0;
    case "wingoverMaxSinken":
      return +(cf.wingoverMaxSinken || 0) || 0;
    case "wingoverSinkenSchnitt":
      return +(cf.wingoverSinkenSchnitt || 0) || 0;
    case "wingoverAnzahl":
      return +(cf.wingoverAnzahl || 0) || 0;
    case "wingoverHoehenabbau":
      return +(cf.wingoverHoehenabbau || 0) || 0;
    case "site":
      return (f.site || "").toLowerCase();
    case "landung":
      return (cf.landung || "").toLowerCase();
    case "land":
      return (cf.land || "").toLowerCase();
    case "glider":
      return (f.glider || "").toLowerCase();
    case "typ":
      return (cf.typ || "").toLowerCase();
    case "pilot":
      return (f.pilot || "").toLowerCase();
    case "reise":
      return (cf.reise || "").toLowerCase();
    case "speed":
      return parseFloat(cf.kmh || 0) || 0;
    case "jahr":
      return f.year || 0;
    default:
      return 0;
  }
}
function sortFlights(flights, sortId, dir) {
  if (!sortId) return flights;
  const sorted = [...flights].sort((a, b) => {
    const av = sortFieldValue(a, sortId), bv = sortFieldValue(b, sortId);
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv));
    }
    return av - bv;
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}
const FLIGHT_ROW_VISIBLE_SORT_IDS = /* @__PURE__ */ new Set([
  "date",
  "site",
  "landung",
  "reise",
  "glider",
  "maxSpeed",
  "dist",
  "duration"
]);
function sortFieldDisplay(f, sortId) {
  const cf = f.customFields || {};
  switch (sortId) {
    case "number":
    case "name":
      return f.name || null;
    case "jahr":
    case "year":
      return f.year || null;
    case "startTime":
      return f.startTime || null;
    case "endTime":
      return f.endTime || null;
    case "land":
      return cf.land || null;
    case "typ":
      return cf.typ || null;
    case "pilot":
      return f.pilot || null;
    case "alt":
      return f.maxAlt ? f.maxAlt + " m" : cf.hMax || cf.hm ? (cf.hMax || cf.hm) + " m" : null;
    case "startAlt":
      return f.startAlt > 0 ? f.startAlt + " m" : cf.msa ? cf.msa + " m" : null;
    case "endAlt":
      return f.endAlt > 0 ? f.endAlt + " m" : cf.ml ? cf.ml + " m" : null;
    case "hDiff":
      return cf.hDiff ? cf.hDiff + " m" : null;
    case "speed":
      return cf.kmh ? cf.kmh + " km/h" : null;
    case "maxSteigen":
      return cf.maxSteigen || f.maxClimb ? fmt1(cf.maxSteigen || f.maxClimb) + " m/s" : null;
    case "maxSteigen20":
      return cf.maxSteigen20 || f.maxClimb20 ? fmt1(cf.maxSteigen20 || f.maxClimb20) + " m/s" : null;
    case "maxSinken":
      return cf.maxSinken ? fmt1(cf.maxSinken) + " m/s" : null;
    case "hGew":
      return cf.hGew ? cf.hGew + " m" : null;
    case "entfernungSL":
      return f.entfernungSL != null ? f.entfernungSL + " km" : null;
    case "spiraleMaxSinken":
      return cf.spiraleMaxSinken ? fmt1(cf.spiraleMaxSinken) + " m/s" : null;
    case "spiraleSinkenSchnitt":
      return cf.spiraleSinkenSchnitt ? fmt1(cf.spiraleSinkenSchnitt) + " m/s" : null;
    case "spiraleAnzahlKreise":
      return cf.spiraleAnzahlKreise || null;
    case "spiraleHoehenabbau":
      return cf.spiraleHoehenabbau ? cf.spiraleHoehenabbau + " m" : null;
    case "wingoverMaxSinken":
      return cf.wingoverMaxSinken ? fmt1(cf.wingoverMaxSinken) + " m/s" : null;
    case "wingoverSinkenSchnitt":
      return cf.wingoverSinkenSchnitt ? fmt1(cf.wingoverSinkenSchnitt) + " m/s" : null;
    case "wingoverAnzahl":
      return cf.wingoverAnzahl || null;
    case "wingoverHoehenabbau":
      return cf.wingoverHoehenabbau ? cf.wingoverHoehenabbau + " m" : null;
    default:
      return null;
  }
}
function FlightRow({ f, isLongest, onClick, selectMode, isSelected, onToggleSelect, sortId }) {
  const distText = f.totalDist ? `${f.totalDist} km` : null;
  const speedText = f.maxSpeedKmh ? `${f.maxSpeedKmh} km/h` : null;
  const sortExtra = !FLIGHT_ROW_VISIBLE_SORT_IDS.has(sortId) ? sortFieldDisplay(f, sortId) : null;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: selectMode ? () => onToggleSelect(f.id) : onClick,
      style: { padding: "5px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, background: isSelected ? "rgba(14,165,233,0.1)" : "transparent", transition: "background 0.15s", whiteSpace: "nowrap", overflow: "hidden" },
      onMouseEnter: (e) => {
        if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)";
      },
      onMouseLeave: (e) => {
        if (!isSelected) e.currentTarget.style.background = "transparent";
      }
    },
    selectMode && /* @__PURE__ */ React.createElement("div", { style: { flexShrink: 0, width: 20, height: 20, borderRadius: 6, border: `2px solid ${isSelected ? "#7dd3fc" : "rgba(232,244,253,0.3)"}`, background: isSelected ? "#7dd3fc" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" } }, isSelected && /* @__PURE__ */ React.createElement("span", { style: { color: "#0a1628", fontSize: 13, fontWeight: 900 } }, "✓")),
    isLongest && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, flexShrink: 0 } }, "🏆"),
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#a8d8f5", flexShrink: 0 } }, f.date),
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#a8d8f5", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 } }, f.site || "—"),
    f.customFields?.landung && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#a8d8f5", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 } }, "→ ", f.customFields.landung),
    f.customFields?.reise && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 700, color: "#fcd34d", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 2 } }, "· ", f.customFields.reise),
    f.glider && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#a8d8f5", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 2 } }, "· ", f.glider),
    /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }),
    /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 } }, sortExtra && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#a8d8f5" } }, sortExtra), speedText && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#a8d8f5" } }, speedText), distText && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#a8d8f5" } }, distText), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: "#7dd3fc" } }, f.durationStr || "—"))
  );
}
function matchFlights(flights, q) {
  if (!q || !q.trim()) return flights;
  let s = q.trim().replace(/\s+(UND|AND)\s+/gi, " && ").replace(/\s+(ODER|OR)\s+/gi, " || ").replace(/&&/g, " && ").replace(/\|\|/g, " || ").replace(/([\wäöü]+)\s*(>=|<=|!=|≠|>|<|=|:)\s+(?=\S)/gi, "$1$2").replace(/([\wäöü]+)\s+(>=|<=|!=|≠|>|<|=|:)(?=\S)/gi, "$1$2");
  const orGroups = s.split(/\s*\|\|\s*/);
  return flights.filter((f) => {
    return orGroups.some((group) => {
      const andTerms = group.split(/\s*&&\s*/).flatMap((t) => {
        return t.match(/(?:[\wäöü]+(?:>=|<=|!=|≠|>|<|=|:)"[^"]+"|[\wäöü]+(?:>=|<=|!=|≠|>|<|=|:)\S+|\+\S+|\-\S+|"[^"]+"|\S+)/gi) || [];
      }).map((t) => t.replace(/^"(.*)"$/, "$1"));
      if (!andTerms.length) return true;
      return andTerms.every((term) => {
        if (term.startsWith("+")) return evalToken(f, term.slice(1));
        if (term.startsWith("-")) return !evalToken(f, term.slice(1));
        return evalToken(f, term);
      });
    });
  });
}
const SEARCH_FIELDS = [
  { id: "name", label: "Name/Titel", type: "text" },
  { id: "site", label: "Startplatz", type: "text" },
  { id: "landung", label: "Landeplatz", type: "text" },
  { id: "land", label: "Land", type: "text" },
  { id: "glider", label: "Schirm", type: "text" },
  { id: "typ", label: "Typ", type: "text" },
  { id: "pilot", label: "Pilot", type: "text" },
  { id: "reise", label: "Reise", type: "text" },
  { id: "datum", label: "Datum", type: "date" },
  { id: "startzeit", label: "Startzeit", type: "time" },
  { id: "landezeit", label: "Landezeit", type: "time" },
  { id: "jahr", label: "Jahr", type: "number" },
  { id: "bemerkung", label: "Bemerkung", type: "text" },
  { id: "dauer", label: "Dauer (h)", type: "number" },
  { id: "distanz", label: "Distanz (km)", type: "number" },
  { id: "maxspeed", label: "Max Speed (km/h)", type: "number" },
  { id: "hoehe", label: "Max. Höhe (m)", type: "number" },
  { id: "startalt", label: "Start müM", type: "number" },
  { id: "endalt", label: "Landung müM", type: "number" },
  { id: "hdiff", label: "H.Diff. (m)", type: "number" },
  { id: "speed", label: "Ø Speed (km/h)", type: "number" },
  { id: "maxsteigen", label: "Max.Steigen (m/s)", type: "number" },
  { id: "maxsteigen20", label: "Max.Steigen 20s (m/s)", type: "number" },
  { id: "maxsinken", label: "Max.Sinken (m/s)", type: "number" },
  { id: "hgew", label: "H.Gew. (m)", type: "number" },
  { id: "entfernungsl", label: "Entf. S-L (km)", type: "number" },
  { id: "startlat", label: "Start Lat", type: "number" },
  { id: "startlon", label: "Start Lon", type: "number" },
  { id: "endlat", label: "Landung Lat", type: "number" },
  { id: "endlon", label: "Landung Lon", type: "number" },
  { id: "naehe", label: "In der Nähe (Standort)", type: "geo" },
  { id: "igc", label: "IGC-Track", type: "bool" },
  { id: "training", label: "Training", type: "bool" },
  { id: "ogoy", label: "OGOY", type: "bool" }
];
const BOOL_OPTIONS = [
  { value: "ja", label: "Vorhanden" },
  { value: "nein", label: "Nicht vorhanden" }
];
const ADV_OPS_NUM = [">=", "<=", "!=", ">", "<", "=", "between"];
const ADV_OPS_TEXT = [":", "=", "!=", ">", "<", ">=", "<="];
const ADV_OPS_GEO = [":", "!="];
const TILE_FIELD_OPTIONS = [
  { key: "duration", label: "Dauer", icon: "⏱", get: (fl) => fl.durationStr || "—" },
  { key: "maxAlt", label: "Max. Höhe", icon: "⬆", get: (fl) => fl.maxAlt ? fl.maxAlt + " m" : "—" },
  { key: "distanz", label: "Distanz", icon: "📏", get: (fl) => fl.totalDist ? fl.totalDist + " km" : fl.customFields?.distKm || fl.customFields?.dk ? (fl.customFields.distKm || fl.customFields.dk) + " km" : "—" },
  { key: "maxSpeed", label: "Max Speed", icon: "⚡", get: (fl) => fl.maxSpeedKmh ? fl.maxSpeedKmh + " km/h" : "—" },
  { key: "startAlt", label: "Start müM", icon: "↑", get: (fl) => fl.startAlt > 0 ? fl.startAlt + " m" : fl.customFields?.msa ? fl.customFields.msa + " m" : "—" },
  { key: "endAlt", label: "Land. müM", icon: "↓", get: (fl) => fl.endAlt > 0 ? fl.endAlt + " m" : fl.customFields?.ml ? fl.customFields.ml + " m" : "—" },
  { key: "hDiff", label: "H.Diff.", icon: "↕", get: (fl) => fl.customFields?.hDiff ? fl.customFields.hDiff + " m" : "—" },
  { key: "maxSinken", label: "Max.Sinken", icon: "⬇", get: (fl) => fl.customFields?.maxSinken ? fmt1(fl.customFields.maxSinken) + " m/s" : "—" },
  { key: "maxSteigen", label: "Max.Steigen", icon: "⬆", get: (fl) => fl.customFields?.maxSteigen || fl.maxClimb ? fmt1(fl.customFields?.maxSteigen || fl.maxClimb) + " m/s" : "—" },
  { key: "maxSteigen20", label: "Max.Steigen 20s", icon: "⬆", get: (fl) => fl.customFields?.maxSteigen20 || fl.maxClimb20 ? fmt1(fl.customFields?.maxSteigen20 || fl.maxClimb20) + " m/s" : "—" },
  { key: "speed", label: "Ø Speed", icon: "💨", get: (fl) => fl.customFields?.kmh ? fl.customFields.kmh + " km/h" : "—" },
  { key: "hGew", label: "Höhengewinn", icon: "📈", get: (fl) => fl.customFields?.hGew ? fl.customFields.hGew + " m" : "—" },
  { key: "entfernungSL", label: "Entf. S-L", icon: "📐", get: (fl) => fl.entfernungSL != null ? fl.entfernungSL + " km" : "—" },
  { key: "spiraleMaxSinken", label: "Spirale Max.Sinken", icon: "🌀", get: (fl) => fl.customFields?.spiraleMaxSinken ? fmt1(fl.customFields.spiraleMaxSinken) + " m/s" : "—" },
  { key: "spiraleSinkenSchnitt", label: "Spirale Ø Sinken", icon: "🌀", get: (fl) => fl.customFields?.spiraleSinkenSchnitt ? fmt1(fl.customFields.spiraleSinkenSchnitt) + " m/s" : "—" },
  { key: "spiraleAnzahlKreise", label: "Spirale Kreise", icon: "🌀", get: (fl) => fl.customFields?.spiraleAnzahlKreise || "—" },
  { key: "spiraleHoehenabbau", label: "Spirale Höhenabbau", icon: "🌀", get: (fl) => fl.customFields?.spiraleHoehenabbau ? fl.customFields.spiraleHoehenabbau + " m" : "—" },
  { key: "wingoverMaxSinken", label: "Wingover Max.Sinken", icon: "🪽", get: (fl) => fl.customFields?.wingoverMaxSinken ? fmt1(fl.customFields.wingoverMaxSinken) + " m/s" : "—" },
  { key: "wingoverSinkenSchnitt", label: "Wingover Ø Sinken", icon: "🪽", get: (fl) => fl.customFields?.wingoverSinkenSchnitt ? fmt1(fl.customFields.wingoverSinkenSchnitt) + " m/s" : "—" },
  { key: "wingoverAnzahl", label: "Anzahl Wingover", icon: "🪽", get: (fl) => fl.customFields?.wingoverAnzahl || "—" },
  { key: "wingoverHoehenabbau", label: "Wingover Höhenabbau", icon: "🪽", get: (fl) => fl.customFields?.wingoverHoehenabbau ? fl.customFields.wingoverHoehenabbau + " m" : "—" }
];
const DEFAULT_TILE_KEYS = ["duration", "maxAlt", "distanz", "startAlt", "endAlt", "hDiff", "maxSinken", "maxSteigen", "speed"];
function buildAdvancedQuery(rows) {
  const quoteIfNeeded = (v) => /\s/.test(v) ? `"${v}"` : v;
  const termFor = (r) => {
    const fieldDef = SEARCH_FIELDS.find((f) => f.id === r.field);
    const isNumeric = fieldDef?.type === "number" || fieldDef?.type === "date" || fieldDef?.type === "time";
    const op = r.op || (isNumeric ? "=" : ":");
    if (op === "between") {
      if (r.value2 === "" || r.value2 == null) return `${r.field}>=${String(r.value).trim()}`;
      return `${r.field}>=${String(r.value).trim()} && ${r.field}<=${String(r.value2).trim()}`;
    }
    return `${r.field}${op}${quoteIfNeeded(String(r.value).trim())}`;
  };
  let out = "";
  for (const r of rows) {
    if (r.value === "" || r.value == null) continue;
    const term = termFor(r);
    if (!out) {
      out = term;
      continue;
    }
    out += (r.connector === "OR" ? " || " : " && ") + term;
  }
  return out;
}
function newSearchRow(connector) {
  return { field: "site", op: ":", value: "", connector: connector || "AND" };
}
function parseQueryToRows(query) {
  if (!query || !query.trim()) return [newSearchRow()];
  const pieces = query.trim().split(/\s*(&&|\|\|)\s*/).filter((p) => p !== "");
  const parseTerm = (part) => {
    const m = part.trim().match(/^([\wäöü]+)\s*(>=|<=|!=|≠|>|<|=|:)\s*(.+)$/i);
    if (!m) return null;
    const field = m[1].toLowerCase();
    if (!SEARCH_FIELDS.find((f) => f.id === field)) return null;
    const op = m[2] === "≠" ? "!=" : m[2];
    const value = m[3].trim().replace(/^"(.*)"$/, "$1");
    return { field, op, value };
  };
  const terms = [];
  const connectors = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const t = parseTerm(pieces[i]);
    if (!t) return [newSearchRow()];
    terms.push(t);
    connectors.push(i === 0 ? "AND" : pieces[i - 1] === "||" ? "OR" : "AND");
  }
  const rows = [];
  for (let i = 0; i < terms.length; i++) {
    const cur = terms[i], next = terms[i + 1];
    if (next && connectors[i + 1] === "AND" && cur.field === next.field && cur.op === ">=" && next.op === "<=") {
      rows.push({ field: cur.field, op: "between", value: cur.value, value2: next.value, connector: connectors[i] });
      i++;
    } else {
      rows.push({ ...cur, connector: connectors[i] });
    }
  }
  return rows.length ? rows : [newSearchRow()];
}
function NearbyValueEditor({ value, defaultRadiusKm, onChange }) {
  const parsed = parseNearbyValue(value);
  const radiusStr = parsed ? String(parsed.radiusKm) : value || "";
  const hasCoords = !!(parsed && parsed.lat != null && parsed.lon != null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setRadius = (newRadiusStr) => {
    onChange(hasCoords ? `${newRadiusStr}@${parsed.lat},${parsed.lon}` : newRadiusStr);
  };
  const useCurrentLocation = async () => {
    setBusy(true);
    setError("");
    try {
      const pt = await requestGeoPosition();
      const radius = parsed && parsed.radiusKm || parseFloat(String(radiusStr).replace(",", ".")) || defaultRadiusKm;
      onChange(`${radius}@${pt.lat.toFixed(5)},${pt.lon.toFixed(5)}`);
    } catch (e) {
      setError(e.message || "Standort nicht verfügbar.");
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 4, alignItems: "center" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      value: radiusStr,
      onChange: (e) => setRadius(e.target.value),
      inputMode: "decimal",
      placeholder: String(defaultRadiusKm),
      style: { width: 48, flexShrink: 0, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "5px 6px", color: "#e8f4fd", fontSize: 12 }
    }
  ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "rgba(232,244,253,0.5)", flexShrink: 0 } }, "km"), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: useCurrentLocation,
      disabled: busy,
      title: "Aktuellen Standort verwenden",
      style: { flexShrink: 0, background: hasCoords ? "rgba(74,222,128,0.15)" : "rgba(125,211,252,0.15)", border: `1px solid ${hasCoords ? "rgba(74,222,128,0.3)" : "rgba(125,211,252,0.3)"}`, borderRadius: 8, padding: "5px 8px", color: hasCoords ? "#4ade80" : "#7dd3fc", fontSize: 12, cursor: busy ? "default" : "pointer" }
    },
    busy ? "…" : hasCoords ? "📍✓" : "📍"
  )), error ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#f87171" } }, error) : !hasCoords && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "rgba(232,244,253,0.4)" } }, "Standort noch nicht erfasst — 📍 tippen"));
}
function SearchBar({ filterText, setFilterText, knownGliders }) {
  const [advOpen, setAdvOpen] = useState(false);
  const [rows, setRows] = useState(() => parseQueryToRows(filterText));
  const [defaultNearbyRadiusKm, setDefaultNearbyRadiusKm] = useState(5);
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("settings:nearbyRadiusKm");
        const n = r && r.value ? parseFloat(r.value) : NaN;
        if (isFinite(n) && n > 0) setDefaultNearbyRadiusKm(n);
      } catch {
      }
    })();
  }, []);
  const applyRows = (nextRows) => {
    setRows(nextRows);
    setFilterText(buildAdvancedQuery(nextRows));
  };
  const updateRow = (idx, patch) => applyRows(rows.map((r, i) => i === idx ? { ...r, ...patch } : r));
  const addRow = () => applyRows([...rows, newSearchRow()]);
  const removeRow = (idx) => {
    const next = rows.filter((_, i) => i !== idx);
    applyRows(next.length ? next : [newSearchRow()]);
  };
  const showNearbySearch = () => {
    setAdvOpen(true);
    if (rows.some((r) => r.field === "naehe")) return;
    const nextRows = rows.length === 1 && rows[0].value === "" ? [{ ...rows[0], field: "naehe", op: ":", value: String(defaultNearbyRadiusKm) }] : [...rows, { field: "naehe", op: ":", value: String(defaultNearbyRadiusKm), connector: "AND" }];
    applyRows(nextRows);
  };
  return /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      value: filterText,
      onChange: (e) => setFilterText(e.target.value),
      onFocus: () => setAdvOpen(true),
      placeholder: "🔍 Suchen…",
      style: { width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 58px 8px 12px", color: "#e8f4fd", fontSize: 13, boxSizing: "border-box" }
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: showNearbySearch,
      title: "Flüge in der Nähe des aktuellen Standorts suchen",
      style: { background: "none", border: "none", color: "rgba(232,244,253,0.45)", cursor: "pointer", fontSize: 14, padding: 0 }
    },
    "📍"
  ), filterText && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setFilterText(""),
      style: { background: "none", border: "none", color: "rgba(232,244,253,0.4)", cursor: "pointer", fontSize: 14, padding: 0 }
    },
    "✕"
  ))), advOpen && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: "calc(100% + 8px)", left: 0, width: "min(92vw, 420px)", zIndex: 2e3, background: "#0f1f36", boxShadow: "0 12px 32px rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, rows.map((row, idx) => {
    const fieldDef = SEARCH_FIELDS.find((f) => f.id === row.field);
    return /* @__PURE__ */ React.createElement("div", { key: idx, style: { display: "flex", gap: 6, alignItems: "center" } }, idx === 0 ? /* @__PURE__ */ React.createElement("span", { style: { minWidth: 34, flexShrink: 0 } }) : /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => updateRow(idx, { connector: row.connector === "OR" ? "AND" : "OR" }),
        title: "UND/ODER für diese Zeile umschalten",
        style: { fontSize: 10, fontWeight: 700, minWidth: 34, textAlign: "center", flexShrink: 0, background: row.connector === "OR" ? "rgba(167,139,250,0.18)" : "rgba(125,211,252,0.15)", border: `1px solid ${row.connector === "OR" ? "rgba(167,139,250,0.4)" : "rgba(125,211,252,0.35)"}`, borderRadius: 6, padding: "4px 2px", color: row.connector === "OR" ? "#a78bfa" : "#7dd3fc", cursor: "pointer" }
      },
      row.connector === "OR" ? "ODER" : "UND"
    ), /* @__PURE__ */ React.createElement(
      "select",
      {
        value: row.field,
        onChange: (e) => {
          const nf = SEARCH_FIELDS.find((f) => f.id === e.target.value);
          const isNum = nf?.type === "number" || nf?.type === "date" || nf?.type === "time";
          const isBool = nf?.type === "bool";
          const isGeo = nf?.type === "geo";
          updateRow(idx, { field: e.target.value, op: isNum ? "=" : ":", value2: void 0, value: isBool ? "ja" : isGeo ? String(defaultNearbyRadiusKm) : "" });
        },
        style: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "5px 4px", color: "#e8f4fd", fontSize: 12, minWidth: 0 }
      },
      SEARCH_FIELDS.map((f) => /* @__PURE__ */ React.createElement("option", { key: f.id, value: f.id, style: { background: "#0a1628" } }, f.label))
    ), (() => {
      if (fieldDef?.type === "bool") return null;
      const isNumeric = fieldDef?.type === "number" || fieldDef?.type === "date" || fieldDef?.type === "time";
      const isGeo = fieldDef?.type === "geo";
      const ops = isGeo ? ADV_OPS_GEO : isNumeric ? ADV_OPS_NUM : ADV_OPS_TEXT;
      return /* @__PURE__ */ React.createElement(
        "select",
        {
          value: row.op || (isNumeric ? "=" : ":"),
          onChange: (e) => updateRow(idx, { op: e.target.value }),
          style: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "5px 2px", color: "#e8f4fd", fontSize: 12, width: isNumeric ? 68 : 44, flexShrink: 0 }
        },
        ops.map((o) => /* @__PURE__ */ React.createElement("option", { key: o, value: o, style: { background: "#0a1628" } }, o === "between" ? "zw." : o))
      );
    })(), fieldDef?.type === "bool" ? /* @__PURE__ */ React.createElement(
      "select",
      {
        value: row.value || "ja",
        onChange: (e) => updateRow(idx, { value: e.target.value }),
        style: { flex: 1, minWidth: 0, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "5px 8px", color: "#e8f4fd", fontSize: 12 }
      },
      BOOL_OPTIONS.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.value, value: o.value, style: { background: "#0a1628" } }, o.label))
    ) : fieldDef?.type === "geo" ? /* @__PURE__ */ React.createElement(
      NearbyValueEditor,
      {
        value: row.value,
        defaultRadiusKm: defaultNearbyRadiusKm,
        onChange: (v) => updateRow(idx, { value: v })
      }
    ) : /* @__PURE__ */ React.createElement(
      "input",
      {
        value: row.value === "*" ? "" : row.value,
        onChange: (e) => updateRow(idx, { value: e.target.value }),
        placeholder: row.op === "between" ? "von…" : "Wert…",
        disabled: row.value === "*",
        list: row.field === "glider" && knownGliders?.length ? "glider-datalist" : void 0,
        style: { flex: 1, minWidth: 0, background: row.value === "*" ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "5px 8px", color: "#e8f4fd", fontSize: 12 }
      }
    ), row.op === "between" && /* @__PURE__ */ React.createElement(
      "input",
      {
        value: row.value2 || "",
        onChange: (e) => updateRow(idx, { value2: e.target.value }),
        placeholder: "bis…",
        style: { flex: 1, minWidth: 0, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "5px 8px", color: "#e8f4fd", fontSize: 12 }
      }
    ), /* @__PURE__ */ React.createElement("button", { onClick: () => removeRow(idx), style: { background: "none", border: "none", color: "rgba(232,244,253,0.35)", cursor: "pointer", fontSize: 14, padding: "0 2px", flexShrink: 0 } }, "✕"));
  })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 } }, /* @__PURE__ */ React.createElement("button", { onClick: addRow, style: { background: "rgba(125,211,252,0.12)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 8, padding: "5px 10px", color: "#7dd3fc", fontSize: 11, fontWeight: 700, cursor: "pointer" } }, "+ Zeile"), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setAdvOpen(false),
      title: "Schliessen",
      style: { background: "rgba(34,197,94,0.18)", border: "1px solid rgba(34,197,94,0.4)", borderRadius: 8, width: 30, height: 30, color: "#4ade80", fontSize: 14, fontWeight: 900, cursor: "pointer", flexShrink: 0 }
    },
    "✓"
  ))), knownGliders?.length > 0 && /* @__PURE__ */ React.createElement("datalist", { id: "glider-datalist" }, knownGliders.map((g) => /* @__PURE__ */ React.createElement("option", { key: g, value: g }))));
}
function renumberFlightName(name, newNumber) {
  if (!name) return String(newNumber);
  const m = name.match(/\d+/);
  if (!m) return `${name} ${newNumber}`;
  return name.slice(0, m.index) + String(newNumber) + name.slice(m.index + m[0].length);
}
function renumberAllFlights(flights) {
  const sorted = [...flights].sort((a, b) => parseDateToTs(a.date || a.rawDate, a.startTime) - parseDateToTs(b.date || b.rawDate, b.startTime));
  const numberById = new Map(sorted.map((f, i) => [f.id, i + 1]));
  return flights.map((f) => ({ ...f, name: renumberFlightName(f.name, numberById.get(f.id)) }));
}
function CoordEdit({ lat, lon, alt, color, onSave }) {
  const [editing, setEditing] = useState(false);
  const [combined, setCombined] = useState(lat != null && lon != null ? `${lat}, ${lon}` : "");
  const [al, setAl] = useState(alt != null && alt > 0 ? String(alt) : "");
  const parseLatLon = (str) => {
    if (!str) return null;
    const tokens = str.replace(/°/g, " ").split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
    if (tokens.length < 2) return null;
    const plat = parseFloat(tokens[0]);
    const plon = parseFloat(tokens[1]);
    if (isNaN(plat) || isNaN(plon)) return null;
    return { lat: plat, lon: plon };
  };
  const start = () => {
    setCombined(lat != null && lon != null ? `${lat}, ${lon}` : "");
    setAl(alt != null && alt > 0 ? String(alt) : "");
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const parsed = parseLatLon(combined);
    const nalt = al.trim() === "" ? 0 : parseInt(al, 10);
    onSave(parsed ? parsed.lat : null, parsed ? parsed.lon : null, isNaN(nalt) ? 0 : nalt);
  };
  const iStyle = { width: "100%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(125,211,252,0.4)", borderRadius: 6, padding: "3px 6px", color: "#e8f4fd", fontSize: 11, fontFamily: "monospace", boxSizing: "border-box", marginBottom: 3 };
  if (editing) {
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(
      "input",
      {
        value: combined,
        onChange: (e) => setCombined(e.target.value),
        placeholder: "Lat, Lon (z.B. 47.21990, 8.45354) — leer = löschen",
        autoFocus: true,
        style: iStyle,
        onKeyDown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }
      }
    ), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: al,
        onChange: (e) => setAl(e.target.value),
        placeholder: "müM",
        style: iStyle,
        onKeyDown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }
      }
    ), /* @__PURE__ */ React.createElement("button", { onClick: commit, style: { width: "100%", background: "rgba(125,211,252,0.15)", border: "1px solid rgba(125,211,252,0.3)", borderRadius: 6, padding: "3px", color: "#7dd3fc", fontSize: 10, cursor: "pointer" } }, "✓ Speichern"));
  }
  return /* @__PURE__ */ React.createElement("div", { onClick: start, style: { cursor: "pointer" } }, lat != null && lon != null ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.7)", fontFamily: "monospace" } }, lat.toFixed(5), "° N", /* @__PURE__ */ React.createElement("br", null), lon.toFixed(5), "° E") : /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.3)", fontFamily: "monospace" } }, "— tippen zum Erfassen —"), alt > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color, opacity: 0.6, marginTop: 3 } }, alt, " m ü.M."));
}
function EditableTitle({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const commit = () => {
    setEditing(false);
    if (val.trim() !== (value || "") && val.trim() !== "") onSave(val.trim());
  };
  if (editing) {
    return /* @__PURE__ */ React.createElement(
      "input",
      {
        value: val,
        onChange: (e) => setVal(e.target.value),
        onBlur: commit,
        autoFocus: true,
        onKeyDown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        },
        style: { fontSize: 22, fontWeight: 800, marginBottom: 4, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(125,211,252,0.4)", borderRadius: 8, padding: "2px 8px", color: "#e8f4fd", width: "100%", boxSizing: "border-box" }
      }
    );
  }
  return /* @__PURE__ */ React.createElement("div", { onClick: () => {
    setVal(value || "");
    setEditing(true);
  }, style: { fontSize: 22, fontWeight: 800, marginBottom: 4, cursor: "pointer" } }, value || "—");
}
function StaticField({ label, value, unit }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "rgba(232,244,253,0.45)", minWidth: 90 } }, label), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 500, color: value ? "#e8f4fd" : "rgba(232,244,253,0.25)", textAlign: "right" } }, value ? value + (unit ? " " + unit : "") : "—"));
}
function UrlField({ label, value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  useEffect(() => {
    setVal(value || "");
  }, [value]);
  const commit = () => {
    setEditing(false);
    let v = val.trim();
    if (v && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = "https://" + v;
    if (v !== (value || "")) onSave(v);
  };
  const safe = value && /^https?:\/\//i.test(value);
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "rgba(232,244,253,0.45)", minWidth: 90 } }, label), editing || !value ? /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "url",
      value: val,
      autoFocus: editing,
      onChange: (e) => setVal(e.target.value),
      onBlur: commit,
      placeholder: "URL einfügen (https://…)",
      onKeyDown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.target.blur();
        }
      },
      style: { flex: 1, minWidth: 0, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(125,211,252,0.4)", borderRadius: 8, padding: "4px 8px", color: "#e8f4fd", fontSize: 13, textAlign: "right" }
    }
  ) : /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } }, value && (safe ? /* @__PURE__ */ React.createElement(
    "a",
    {
      href: value,
      target: "_blank",
      rel: "noopener noreferrer",
      style: { fontSize: 13, fontWeight: 500, color: "#7dd3fc", textDecoration: "underline", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }
    },
    value
  ) : /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "#e8f4fd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 } }, value)), /* @__PURE__ */ React.createElement(
    "span",
    {
      onClick: () => {
        setVal(value || "");
        setEditing(true);
      },
      title: "Bearbeiten",
      style: { fontSize: 16, cursor: "pointer", padding: "2px 6px", color: "rgba(232,244,253,0.5)" }
    },
    "✎"
  ), /* @__PURE__ */ React.createElement(
    "span",
    {
      onClick: () => {
        setVal("");
        onSave("");
      },
      title: "Link löschen",
      style: { fontSize: 16, cursor: "pointer", padding: "2px 6px", color: "#f87171" }
    },
    "✕"
  )));
}
function InlineField({ label, value, onSave, multiline, unit }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const committedByEnter = useRef(false);
  const commit = () => {
    if (committedByEnter.current) {
      committedByEnter.current = false;
      return;
    }
    setEditing(false);
    if (val !== (value || "")) onSave(val);
  };
  const commitAndAdvance = (e) => {
    committedByEnter.current = true;
    setEditing(false);
    if (val !== (value || "")) onSave(val);
    const row = e.target.closest("[data-inline-row]");
    const allRows = [...document.querySelectorAll("[data-inline-row]")];
    const idx = allRows.indexOf(row);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (let i = idx + 1; i < allRows.length; i++) {
          const nextRow = allRows[i];
          const trigger = nextRow?.querySelector("[data-inline-field-trigger]");
          const select = nextRow?.querySelector("select");
          if (trigger) {
            trigger.click();
            return;
          }
          if (select) {
            select.focus();
            return;
          }
        }
      });
    });
  };
  return /* @__PURE__ */ React.createElement("div", { "data-inline-row": true, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "rgba(232,244,253,0.45)", minWidth: 90 } }, label), editing ? multiline ? /* @__PURE__ */ React.createElement(
    "textarea",
    {
      value: val,
      onChange: (e) => setVal(e.target.value),
      onBlur: commit,
      autoFocus: true,
      style: { flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(125,211,252,0.4)", borderRadius: 8, padding: "4px 8px", color: "#e8f4fd", fontSize: 13, resize: "vertical", minHeight: 48 }
    }
  ) : /* @__PURE__ */ React.createElement(
    "input",
    {
      value: val,
      onChange: (e) => setVal(e.target.value),
      onBlur: commit,
      autoFocus: true,
      "data-inline-field": true,
      onKeyDown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitAndAdvance(e);
        }
      },
      style: { flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(125,211,252,0.4)", borderRadius: 8, padding: "4px 8px", color: "#e8f4fd", fontSize: 13, textAlign: "right" }
    }
  ) : /* @__PURE__ */ React.createElement(
    "span",
    {
      "data-inline-field-trigger": true,
      onClick: () => {
        setVal(value || "");
        setEditing(true);
      },
      style: { fontSize: 13, fontWeight: 500, color: value ? "#e8f4fd" : "rgba(232,244,253,0.25)", cursor: "pointer", minWidth: 60, textAlign: "right" }
    },
    value || (unit ? "— " + unit : "—")
  ));
}
function PlaceInlineField({ label, value, onSave, suggestions, flights, kind }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const inputRef = useRef(null);
  const committedByEnter = useRef(false);
  const applySuggestion = (typed) => {
    if (!typed) return typed;
    const match = suggestions.find((s) => s.toLowerCase().startsWith(typed.toLowerCase()) && s.length > typed.length);
    return match || typed;
  };
  const prevLen = useRef((value || "").length);
  const onChange = (e) => {
    const typed = e.target.value;
    const isDeleting = typed.length < prevLen.current;
    prevLen.current = typed.length;
    if (isDeleting) {
      setVal(typed);
      return;
    }
    const suggested = applySuggestion(typed);
    setVal(suggested);
    prevLen.current = suggested.length;
    if (suggested !== typed) {
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(typed.length, suggested.length);
      });
    }
  };
  const [coordChoice, setCoordChoice] = useState(null);
  const findPlaceCandidates = (name) => {
    if (!name || !flights) return [];
    const matches = flights.filter((f) => (kind === "start" ? f.site : f.customFields?.landung) === name).filter((f) => kind === "start" ? f.startPt : f.endPt).sort((a, b) => parseDateToTs(b.date || b.rawDate) - parseDateToTs(a.date || a.rawDate));
    const seen = /* @__PURE__ */ new Map();
    for (const f of matches) {
      const pt = kind === "start" ? f.startPt : f.endPt;
      const alt = kind === "start" ? f.startAlt : f.endAlt;
      const key = `${pt.lat.toFixed(5)},${pt.lon.toFixed(5)},${alt || 0}`;
      if (!seen.has(key)) seen.set(key, { pt, alt, date: f.date, flightName: f.name });
    }
    return [...seen.values()];
  };
  const findPlaceExtras = (name) => {
    const candidates = findPlaceCandidates(name);
    if (!candidates.length) return null;
    return candidates[0];
  };
  const commitValue = (name) => {
    const candidates = findPlaceCandidates(name);
    if (candidates.length > 1) {
      onSave(name, null);
      setCoordChoice({ name, candidates });
    } else {
      onSave(name, candidates[0] || null);
    }
  };
  const commit = () => {
    if (committedByEnter.current) {
      committedByEnter.current = false;
      return;
    }
    setEditing(false);
    if (val !== (value || "")) commitValue(val);
  };
  const commitAndAdvance = (e) => {
    committedByEnter.current = true;
    setEditing(false);
    if (val !== (value || "")) commitValue(val);
    const row = e.target.closest("[data-inline-row]");
    const allRows = [...document.querySelectorAll("[data-inline-row]")];
    const idx = allRows.indexOf(row);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (let i = idx + 1; i < allRows.length; i++) {
          const nextRow = allRows[i];
          const trigger = nextRow?.querySelector("[data-inline-field-trigger]");
          const select = nextRow?.querySelector("select");
          if (trigger) {
            trigger.click();
            return;
          }
          if (select) {
            select.focus();
            return;
          }
        }
      });
    });
  };
  return /* @__PURE__ */ React.createElement("div", { "data-inline-row": true, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", position: "relative" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "rgba(232,244,253,0.45)", minWidth: 90 } }, label), editing ? /* @__PURE__ */ React.createElement(
    "input",
    {
      ref: inputRef,
      value: val,
      onChange,
      onBlur: commit,
      autoFocus: true,
      "data-inline-field": true,
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          commitAndAdvance(e);
        }
      },
      style: { flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(125,211,252,0.4)", borderRadius: 8, padding: "4px 8px", color: "#e8f4fd", fontSize: 13, textAlign: "right" }
    }
  ) : /* @__PURE__ */ React.createElement(
    "span",
    {
      "data-inline-field-trigger": true,
      onClick: () => {
        setVal(value || "");
        setEditing(true);
      },
      style: { fontSize: 13, fontWeight: 500, color: value ? "#e8f4fd" : "rgba(232,244,253,0.25)", cursor: "pointer", minWidth: 60, textAlign: "right" }
    },
    value || "—"
  ), coordChoice && /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: () => setCoordChoice(null),
      style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }
    },
    /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: (e) => e.stopPropagation(),
        style: { background: "#14253a", borderRadius: 16, padding: "18px 20px", maxWidth: 340, width: "100%", border: "1px solid rgba(255,255,255,0.1)" }
      },
      /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 4 } }, 'Mehrere Koordinaten für "', coordChoice.name, '"'),
      /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.5)", marginBottom: 14 } }, "Welche soll für diesen Flug gelten?"),
      /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, coordChoice.candidates.map((c, i) => /* @__PURE__ */ React.createElement(
        "button",
        {
          key: i,
          onClick: () => {
            onSave(coordChoice.name, c);
            setCoordChoice(null);
          },
          style: { textAlign: "left", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 12px", color: "#e8f4fd", cursor: "pointer" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, fontFamily: "monospace" } }, c.pt.lat.toFixed(5), ", ", c.pt.lon.toFixed(5)),
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.5)", marginTop: 2 } }, c.alt || 0, " m müM · zuletzt bei ", c.flightName, " (", c.date, ")")
      )), /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => setCoordChoice(null),
          style: { textAlign: "center", background: "none", border: "none", color: "rgba(232,244,253,0.4)", fontSize: 12, cursor: "pointer", marginTop: 2 }
        },
        "Keine übernehmen"
      ))
    )
  ));
}
function ReiseSelect({ value, onSave, flights }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const names = useMemo(() => {
    const fromFlights = (flights || []).map((f) => f.customFields?.reise).filter(Boolean);
    return [...new Set(fromFlights)].sort((a, b) => a.localeCompare(b, "de"));
  }, [flights]);
  const options = value && !names.includes(value) ? [value, ...names] : names;
  const commitNewName = () => {
    const trimmed = newName.trim();
    setAdding(false);
    setNewName("");
    if (!trimmed) return;
    onSave(trimmed);
  };
  if (adding) {
    return /* @__PURE__ */ React.createElement("div", { "data-inline-row": true, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "rgba(232,244,253,0.45)", minWidth: 90 } }, "Reise"), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: newName,
        onChange: (e) => setNewName(e.target.value),
        autoFocus: true,
        placeholder: "Name der Reise…",
        onKeyDown: (e) => {
          if (e.key === "Enter") commitNewName();
          if (e.key === "Escape") {
            setAdding(false);
            setNewName("");
          }
        },
        onBlur: commitNewName,
        style: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "4px 8px", color: "#e8f4fd", fontSize: 13, textAlign: "left", maxWidth: 180, boxSizing: "border-box" }
      }
    ));
  }
  return /* @__PURE__ */ React.createElement("div", { "data-inline-row": true, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "rgba(232,244,253,0.45)", minWidth: 90 } }, "Reise"), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: value || "",
      onChange: (e) => {
        if (e.target.value === "__NEW__") {
          setAdding(true);
        } else {
          onSave(e.target.value);
        }
      },
      style: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "4px 8px", color: value ? "#e8f4fd" : "rgba(232,244,253,0.4)", fontSize: 13, textAlign: "left", maxWidth: 180 }
    },
    /* @__PURE__ */ React.createElement("option", { value: "", style: { background: "#0a1628" } }, "—"),
    options.map((n) => /* @__PURE__ */ React.createElement("option", { key: n, value: n, style: { background: "#0a1628" } }, n)),
    /* @__PURE__ */ React.createElement("option", { value: "__NEW__", style: { background: "#0a1628", color: "#4ade80" } }, "+ Neue Reise…")
  ));
}
function SchirmSelect({ value, onSave, extra }) {
  const [names, setNames] = useState([]);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    (async () => {
      const combined = /* @__PURE__ */ new Set();
      try {
        const r = await window.storage.get("schirme:list");
        if (r) {
          const list = JSON.parse(r.value) || [];
          list.forEach((s) => {
            if (s?.name) combined.add(String(s.name).trim());
          });
        }
      } catch {
      }
      try {
        const r2 = await window.storage.get("service:schirme");
        if (r2) {
          const schirme = JSON.parse(r2.value) || {};
          Object.values(schirme).forEach((s) => {
            if (s?.name) combined.add(String(s.name).trim());
          });
        }
      } catch {
      }
      setNames([...combined].filter(Boolean).sort((a, b) => a.localeCompare(b, "de")));
    })();
  }, []);
  const options = value && !names.includes(value) ? [value, ...names] : names;
  if (!editing) {
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        "data-inline-row": true,
        onClick: () => setEditing(true),
        style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }
      },
      /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "rgba(232,244,253,0.45)", minWidth: 90 } }, "Schirm"), extra),
      /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: value ? "#e8f4fd" : "rgba(232,244,253,0.4)" } }, value || "—")
    );
  }
  return /* @__PURE__ */ React.createElement("div", { "data-inline-row": true, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "rgba(232,244,253,0.45)", minWidth: 90 } }, "Schirm"), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: value || "",
      autoFocus: true,
      onBlur: () => setEditing(false),
      onChange: (e) => {
        onSave(e.target.value);
        setEditing(false);
      },
      style: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "4px 8px", color: value ? "#e8f4fd" : "rgba(232,244,253,0.4)", fontSize: 13, textAlign: "left", maxWidth: 180 }
    },
    /* @__PURE__ */ React.createElement("option", { value: "", style: { background: "#0a1628" } }, "—"),
    options.map((n) => /* @__PURE__ */ React.createElement("option", { key: n, value: n, style: { background: "#0a1628" } }, n))
  ));
}
function DetailContent({ fl, flights, navFlights, customFieldDefs, setFlights, setSelected, setView, setEditData, saveFlight, showFieldEditor, setShowFieldEditor, handleSaveFields, confirmDelete, setConfirmDelete, hideBackButton, isWide, returnTo, mapTilerKey }) {
  const autoFields = customFieldDefs.filter((d) => d.formula).map((d) => ({ ...d, value: evalFormula(d.formula, fl, flights) }));
  const manualFields = customFieldDefs.filter((d) => !d.formula);
  const navList = navFlights || flights;
  const flIdx = navList.findIndex((f) => f.id === fl.id);
  const [typRevealed, setTypRevealed] = useState(false);
  const [confirmTypAuto, setConfirmTypAuto] = useState(null);
  useEffect(() => {
    setTypRevealed(false);
    setConfirmTypAuto(null);
  }, [fl.id]);
  const touchStart = useRef(null);
  const goToFlight = (delta) => {
    const next = navList[flIdx + delta];
    if (!next) return;
    setSelected(next);
  };
  const onTouchStart = (e) => {
    if (profileZoomActive || e.target.closest?.("[data-no-swipe]")) {
      touchStart.current = null;
      return;
    }
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!touchStart.current || profileZoomActive) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    const SWIPE_THRESHOLD = 60;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) goToFlight(-1);
    else goToFlight(1);
  };
  const saveField = async (patch) => {
    const upd = {
      ...fl,
      ...patch,
      customFields: { ...fl.customFields || {}, ...patch.customFields || {} }
    };
    const result = await saveFlight(upd);
    if (!result.ok) {
      alert("Speichern fehlgeschlagen — die Änderung wurde NICHT übernommen.\n\nFehler: " + (result.error?.message || String(result.error)));
      return;
    }
    setFlights((p) => p.map((f) => f.id === upd.id ? upd : f));
    setSelected(upd);
  };
  useEffect(() => {
    const computed = "GS";
    const cf = fl.customFields || {};
    if (cf.typAuto === false) return;
    if (cf.typ === computed) return;
    if (cf.typAuto === true) {
      saveField({ customFields: { typ: computed, typAuto: true } });
      return;
    }
    const hasExistingCsvTyp = !!fl.pdfOnly && !!cf.typ;
    if (hasExistingCsvTyp) {
      setConfirmTypAuto(computed);
    } else {
      saveField({ customFields: { typ: computed, typAuto: true } });
    }
  }, [fl.id]);
  const saveComputedField = async (currentFl, patch) => {
    const upd = {
      ...currentFl,
      ...patch,
      customFields: { ...currentFl.customFields || {}, ...patch.customFields || {} }
    };
    const startTs = parseDateToTs(upd.date || upd.rawDate, upd.startTime);
    const endTs = parseDateToTs(upd.date || upd.rawDate, upd.endTime);
    if (upd.startTime && upd.endTime) {
      let diffSec = Math.round((endTs - startTs) / 1e3);
      if (diffSec < 0) diffSec += 24 * 3600;
      if (diffSec > 0) {
        upd.durationSec = diffSec;
        upd.durationStr = formatDurationHM(diffSec);
      }
    }
    const startAltNum = +upd.startAlt || +(upd.customFields?.msa || 0) || 0;
    const endAltNum = +upd.endAlt || +(upd.customFields?.ml || 0) || 0;
    if (startAltNum && endAltNum) {
      upd.customFields = { ...upd.customFields, hDiff: String(Math.abs(startAltNum - endAltNum)) };
    }
    const distNum = parseFloat(upd.totalDist || upd.customFields?.distKm || upd.customFields?.dk || 0);
    if (distNum > 0 && upd.durationSec > 0) {
      const kmh = distNum / (upd.durationSec / 3600);
      upd.customFields = { ...upd.customFields, kmh: kmh.toFixed(1) };
    }
    const result = await saveFlight(upd);
    if (!result.ok) {
      alert("Speichern fehlgeschlagen — die Änderung wurde NICHT übernommen.\n\nFehler: " + (result.error?.message || String(result.error)));
      return;
    }
    setFlights((p) => p.map((f) => f.id === upd.id ? upd : f));
    setSelected(upd);
  };
  const [notesEditing, setNotesEditing] = useState(false);
  const [profileRange, setProfileRange] = useState(null);
  const [playbackDistance, setPlaybackDistance] = useState(null);
  const [controlsSlotEl, setControlsSlotEl] = useState(null);
  const controlsSlotRef = useCallback((node) => {
    if (node) setControlsSlotEl(node);
  }, []);
  const [isPlaybackActive, setIsPlaybackActive] = useState(false);
  const [playbackPhase, setPlaybackPhase] = useState("flight");
  const [fsProfileSlotEl, setFsProfileSlotEl] = useState(null);
  const [scrubDistanceKm, setScrubDistanceKm] = useState(null);
  const [tileConfig, setTileConfig] = useState(DEFAULT_TILE_KEYS);
  const [tilePickerIdx, setTilePickerIdx] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("settings:tileConfig");
        if (r) {
          const arr = JSON.parse(r.value);
          if (Array.isArray(arr) && arr.length === 9) setTileConfig(arr);
        }
      } catch {
      }
    })();
  }, []);
  const saveTileConfig = async (next) => {
    setTileConfig(next);
    try {
      await window.storage.set("settings:tileConfig", JSON.stringify(next));
    } catch {
    }
  };
  const [notesVal, setNotesVal] = useState(fl.notes || "");
  const commitNotes = () => {
    setNotesEditing(false);
    if (notesVal !== (fl.notes || "")) saveField({ notes: notesVal });
  };
  const saveDateField = async (newDateStr) => {
    const withUpdated = flights.map((f) => f.id === fl.id ? { ...f, date: newDateStr } : f);
    const renumbered = renumberAllFlights(withUpdated);
    await Promise.all(renumbered.map((f, i) => {
      if (f.name !== withUpdated[i].name || f.id === fl.id) {
        return saveFlight(f).catch(() => {
        });
      }
      return null;
    }));
    setFlights(renumbered);
    const newSelected = renumbered.find((f) => f.id === fl.id);
    if (newSelected) setSelected(newSelected);
  };
  const [confirmDateChange, setConfirmDateChange] = useState(null);
  const [confirmNameChange, setConfirmNameChange] = useState(null);
  const [showDeleteMenu, setShowDeleteMenu] = useState(false);
  const [confirmDeleteKind, setConfirmDeleteKind] = useState(null);
  const deleteTrack = async () => {
    const upd = { ...fl, track: [] };
    await saveFlight(upd);
    setFlights((p) => p.map((f) => f.id === upd.id ? upd : f));
    setSelected(upd);
    setConfirmDeleteKind(null);
  };
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      onTouchStart,
      onTouchEnd,
      style: { maxWidth: isWide ? 1100 : 480, margin: "0 auto", padding: "0 0 32px", background: "#040e20", minHeight: "100vh", color: "#e8f4fd", fontFamily: "system-ui,sans-serif" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "calc(16px + env(safe-area-inset-top, 0px)) 16px 10px" } }, !hideBackButton && /* @__PURE__ */ React.createElement("button", { onClick: () => {
      if (returnTo) {
        window.location.href = returnTo;
      } else {
        setView("list");
      }
    }, style: { background: "none", border: "none", color: "#7dd3fc", fontSize: 22, cursor: "pointer" } }, "←"), hideBackButton && /* @__PURE__ */ React.createElement("button", { onClick: () => {
      if (returnTo) {
        window.location.href = returnTo;
      } else {
        setView("list");
      }
    }, style: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "6px 14px", color: "rgba(232,244,253,0.6)", fontSize: 13, cursor: "pointer" } }, "✕ Liste"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" } }, fl.track?.length > 1 && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: async () => {
          const raw = await loadRawIgcFile(fl.id);
          let blob;
          if (raw) {
            blob = new Blob([raw], { type: "application/octet-stream" });
          } else {
            const t = fl.track;
            const d = fl.rawDate || fl.date || "";
            const parts = d.split(".");
            const dateStr = parts.length === 3 ? parts[0].padStart(2, "0") + parts[1].padStart(2, "0") + parts[2].slice(-2) : "010101";
            const fmtTime = (s) => {
              const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
              return String(h).padStart(2, "0") + String(m).padStart(2, "0") + String(sec).padStart(2, "0");
            };
            const fmtLat = (lat) => {
              const a2 = Math.abs(lat), d2 = Math.floor(a2), m = (a2 - d2) * 6e4;
              return String(d2).padStart(2, "0") + String(Math.round(m)).padStart(5, "0") + (lat >= 0 ? "N" : "S");
            };
            const fmtLon = (lon) => {
              const a2 = Math.abs(lon), d2 = Math.floor(a2), m = (a2 - d2) * 6e4;
              return String(d2).padStart(3, "0") + String(Math.round(m)).padStart(5, "0") + (lon >= 0 ? "E" : "W");
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
            blob = new Blob([igc], { type: "application/octet-stream" });
          }
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = (fl.customFields?.igcFilename || fl.name || "flug") + ".igc";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1e3);
        },
        style: { background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 16, padding: "4px 8px", color: "#fcd34d", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }
      },
      "⬇ IGC"
    ), fl.track?.length > 1 && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          const gpx = buildGpxFromFlight(fl);
          if (gpx) {
            const blob = new Blob([gpx], { type: "application/gpx+xml" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${fl?.customFields?.igcFilename || fl?.name || "flug"}.gpx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1e3);
          }
        },
        style: { background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 16, padding: "4px 8px", color: "#4ade80", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }
      },
      "⬇ GPX"
    ), /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setShowDeleteMenu((s) => !s),
        style: { background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 16, padding: "4px 8px", color: "#f87171", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }
      },
      "🗑 ▾"
    ), showDeleteMenu && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { onClick: () => setShowDeleteMenu(false), style: { position: "fixed", inset: 0, zIndex: 99 } }), /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: (e) => e.stopPropagation(),
        style: { position: "absolute", top: "calc(100% + 4px)", right: 0, background: "#14253a", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: 2, minWidth: 150, zIndex: 100 }
      },
      fl.track?.length > 1 && /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => {
            setShowDeleteMenu(false);
            setConfirmDeleteKind("igc");
          },
          style: { background: "transparent", border: "none", borderRadius: 6, padding: "8px 10px", color: "#e8f4fd", fontSize: 13, cursor: "pointer", textAlign: "left" }
        },
        "IGC-Track"
      ),
      /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => {
            setShowDeleteMenu(false);
            setConfirmDelete(fl.id);
          },
          style: { background: "transparent", border: "none", borderRadius: 6, padding: "8px 10px", color: "#f87171", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left" }
        },
        "Alles (ganzer Flug)"
      )
    ))))),
    /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#7dd3fc" } }, fl.date), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 4 } }, fl.pdfOnly && /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(139,92,246,0.2)", color: "#c4b5fd", borderRadius: 20, padding: "2px 10px", fontSize: 10, fontWeight: 700 } }, "CSV"))), /* @__PURE__ */ React.createElement(EditableTitle, { value: fl.name, onSave: (v) => setConfirmNameChange(v) }), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "rgba(232,244,253,0.5)", marginBottom: 12 } }, fl.startTime, fl.endTime ? " – " + fl.endTime : ""), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 14, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" } }, fl.track?.length > 1 && /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(30,64,175,0.22)", color: "#60a5fa", borderRadius: 20, padding: "2px 10px", fontSize: 10, fontWeight: 700, flexShrink: 0 } }, "IGC")), /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: "13px 15px", marginBottom: 14, border: "1px solid rgba(255,255,255,0.06)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: "rgba(232,244,253,0.4)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 9 } }, "Notizen"), notesEditing ? /* @__PURE__ */ React.createElement(
      "textarea",
      {
        value: notesVal,
        onChange: (e) => setNotesVal(e.target.value),
        onBlur: commitNotes,
        autoFocus: true,
        style: { width: "100%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(125,211,252,0.4)", borderRadius: 8, padding: "8px 10px", color: "#e8f4fd", fontSize: 13, resize: "vertical", minHeight: 60, textAlign: "left", boxSizing: "border-box" }
      }
    ) : /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => {
          setNotesVal(fl.notes || "");
          setNotesEditing(true);
        },
        style: { width: "100%", fontSize: 13, fontWeight: 500, color: fl.notes ? "#e8f4fd" : "rgba(232,244,253,0.25)", cursor: "pointer", textAlign: "left", whiteSpace: "pre-wrap", minHeight: 20, lineHeight: 1.5 }
      },
      fl.notes || "Notiz hinzufügen…"
    )), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", fontSize: 11, color: "rgba(232,244,253,0.3)", marginBottom: 10 } }, "‹ wischen ›"), /* @__PURE__ */ React.createElement("div", { "data-no-swipe": "true" }, /* @__PURE__ */ React.createElement("div", { style: { borderRadius: 14, marginBottom: 14, border: "1px solid rgba(100,180,255,0.12)" } }, /* @__PURE__ */ React.createElement(FlightMap, { flight: fl, highlightRange: profileRange, onPlaybackPositionChange: setPlaybackDistance, onPlaybackActiveChange: setIsPlaybackActive, onPlaybackPhaseChange: setPlaybackPhase, controlsSlot: controlsSlotEl, isWide, mapTilerKey, onFullscreenProfileSlot: setFsProfileSlotEl, scrubDistanceKm })), /* @__PURE__ */ React.createElement(FlightProfile, { flight: fl, onPositionChange: setProfileRange, playbackDistanceKm: playbackDistance, isPlaybackActive, playbackPhase, controlsSlot: controlsSlotEl, isWide, fullscreenSlot: fsProfileSlotEl, onScrubChange: setScrubDistanceKm })), /* @__PURE__ */ React.createElement("div", { ref: controlsSlotRef, style: { display: "flex", gap: 5, margin: "10px 0 14px" } }), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 } }, tileConfig.map((key, i) => {
      const opt = TILE_FIELD_OPTIONS.find((o) => o.key === key) || TILE_FIELD_OPTIONS[0];
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          key: i,
          onClick: () => setTilePickerIdx(i),
          style: { background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "7px 6px", textAlign: "center", border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, marginBottom: 1 } }, opt.icon),
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 800, color: "#7dd3fc" } }, opt.get(fl)),
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 8, color: "rgba(232,244,253,0.4)", marginTop: 1, textTransform: "uppercase", letterSpacing: 0.4 } }, opt.label)
      );
    })), tilePickerIdx !== null && /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => setTilePickerIdx(null),
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 250, display: "flex", alignItems: "flex-end", justifyContent: "center" }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: (e) => e.stopPropagation(),
          style: { background: "#14253a", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: "16px 18px calc(20px + env(safe-area-inset-bottom, 0px))", maxWidth: 480, width: "100%", maxHeight: "75vh", overflowY: "auto", border: "1px solid rgba(255,255,255,0.1)" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 10 } }, "Kachel ", tilePickerIdx + 1, ": Feld wählen"),
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } }, TILE_FIELD_OPTIONS.map((opt) => /* @__PURE__ */ React.createElement(
          "button",
          {
            key: opt.key,
            onClick: () => {
              const next = [...tileConfig];
              next[tilePickerIdx] = opt.key;
              saveTileConfig(next);
              setTilePickerIdx(null);
            },
            style: { display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: tileConfig[tilePickerIdx] === opt.key ? "rgba(125,211,252,0.15)" : "transparent", border: "1px solid " + (tileConfig[tilePickerIdx] === opt.key ? "rgba(125,211,252,0.35)" : "rgba(255,255,255,0.06)"), borderRadius: 10, padding: "9px 12px", color: "#e8f4fd", fontSize: 13, cursor: "pointer" }
          },
          /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15 } }, opt.icon),
          /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }, opt.label),
          /* @__PURE__ */ React.createElement("span", { style: { color: "rgba(232,244,253,0.4)", fontSize: 12 } }, opt.get(fl))
        )))
      )
    ), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(34,197,94,0.07)", borderRadius: 12, padding: "10px", border: "1px solid rgba(34,197,94,0.18)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, fontWeight: 700, color: "#4ade80", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 5 } }, "📍 Start"), /* @__PURE__ */ React.createElement(
      CoordEdit,
      {
        lat: fl.startPt?.lat,
        lon: fl.startPt?.lon,
        alt: fl.startAlt,
        color: "#4ade80",
        onSave: (lat, lon, alt) => {
          const sp = lat != null && lon != null ? { lat, lon, gpsAlt: alt || 0 } : null;
          saveComputedField(fl, { startPt: sp, startAlt: alt || 0 });
        }
      }
    )), /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(239,68,68,0.07)", borderRadius: 12, padding: "10px", border: "1px solid rgba(239,68,68,0.18)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, fontWeight: 700, color: "#f87171", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 5 } }, "🏁 Landung"), /* @__PURE__ */ React.createElement(
      CoordEdit,
      {
        lat: fl.endPt?.lat,
        lon: fl.endPt?.lon,
        alt: fl.endAlt,
        color: "#f87171",
        onSave: (lat, lon, alt) => {
          const ep = lat != null && lon != null ? { lat, lon, gpsAlt: alt || 0 } : null;
          saveComputedField(fl, { endPt: ep, endAlt: alt || 0 });
        }
      }
    ))), /* @__PURE__ */ React.createElement("div", { id: "flugdaten-section", style: { background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: "13px 15px", marginBottom: 11, border: "1px solid rgba(255,255,255,0.06)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: "#7dd3fc", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 9 } }, "Flugdaten"), /* @__PURE__ */ React.createElement(InlineField, { label: "Datum", value: fl.date, onSave: (v) => setConfirmDateChange(v) }), /* @__PURE__ */ React.createElement(
      SchirmSelect,
      {
        value: fl.glider,
        onSave: (v) => saveField({ glider: v }),
        extra: !fl.customFields?.typ && !typRevealed ? /* @__PURE__ */ React.createElement(
          "span",
          {
            onClick: (e) => {
              e.stopPropagation();
              setTypRevealed(true);
            },
            style: { fontSize: 11, color: "rgba(232,244,253,0.25)", cursor: "pointer" }
          },
          "+ Typ"
        ) : null
      }
    ), (fl.customFields?.typ || typRevealed) && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement(InlineField, { label: "Typ", value: fl.customFields?.typ || "", onSave: (v) => saveField({ customFields: { typ: v, typAuto: false } }) })), !fl.customFields?.typ && /* @__PURE__ */ React.createElement(
      "span",
      {
        onClick: () => setTypRevealed(false),
        style: { fontSize: 13, color: "rgba(232,244,253,0.25)", cursor: "pointer", padding: "0 2px" }
      },
      "✕"
    )), /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => saveField({ customFields: { training: (fl.customFields?.training || "").trim().toUpperCase() === "T" ? "" : "T" } }),
        style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 0", cursor: "pointer" }
      },
      /* @__PURE__ */ React.createElement("div", { style: { width: 18, height: 18, borderRadius: 5, border: `2px solid ${(fl.customFields?.training || "").trim().toUpperCase() === "T" ? "#7dd3fc" : "rgba(232,244,253,0.3)"}`, background: (fl.customFields?.training || "").trim().toUpperCase() === "T" ? "#7dd3fc" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 } }, (fl.customFields?.training || "").trim().toUpperCase() === "T" && /* @__PURE__ */ React.createElement("span", { style: { color: "#0a1628", fontSize: 11, fontWeight: 900 } }, "✓")),
      /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "rgba(232,244,253,0.7)" } }, "Training")
    ), /* @__PURE__ */ React.createElement(InlineField, { label: "Startzeit", value: fl.startTime, onSave: (v) => saveComputedField(fl, { startTime: v }) }), /* @__PURE__ */ React.createElement(InlineField, { label: "Landezeit", value: fl.endTime, onSave: (v) => saveComputedField(fl, { endTime: v }) }), /* @__PURE__ */ React.createElement(
      PlaceInlineField,
      {
        label: "Startplatz",
        value: fl.site,
        flights,
        kind: "start",
        onSave: (v, extras) => saveField({
          site: v,
          ...extras ? { startPt: extras.pt, startAlt: extras.alt } : {}
        }),
        suggestions: [...new Set(flights.map((f) => f.site).filter(Boolean))]
      }
    ), /* @__PURE__ */ React.createElement(
      PlaceInlineField,
      {
        label: "Landeplatz",
        value: fl.customFields?.landung,
        flights,
        kind: "end",
        onSave: (v, extras) => saveField({
          customFields: { landung: v },
          ...extras ? { endPt: extras.pt, endAlt: extras.alt } : {}
        }),
        suggestions: [...new Set(flights.map((f) => f.customFields?.landung).filter(Boolean))]
      }
    ), /* @__PURE__ */ React.createElement(InlineField, { label: "Land", value: fl.customFields?.land || "", onSave: (v) => saveField({ customFields: { land: v } }) }), /* @__PURE__ */ React.createElement(ReiseSelect, { value: fl.customFields?.reise, flights, onSave: (v) => saveField({ customFields: { reise: v } }) }), fl.customFields?.igcFilename && /* @__PURE__ */ React.createElement(StaticField, { label: "IGC-Dateiname", value: fl.customFields.igcFilename }), /* @__PURE__ */ React.createElement(UrlField, { label: "OGOY", value: fl.customFields?.ogoy || "", onSave: (v) => saveField({ customFields: { ogoy: v } }) }), /* @__PURE__ */ React.createElement(InlineField, { label: "Start müM", value: fl.startAlt > 0 ? String(fl.startAlt) : fl.customFields?.msa || "", onSave: (v) => saveComputedField(fl, { startAlt: +v, customFields: { msa: v } }), unit: "m" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Landung müM", value: fl.endAlt > 0 ? String(fl.endAlt) : fl.customFields?.ml || "", onSave: (v) => saveComputedField(fl, { endAlt: +v, customFields: { ml: v } }), unit: "m" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Max. Höhe", value: fl.maxAlt ? String(fl.maxAlt) : "", onSave: (v) => saveField({ maxAlt: +v, customFields: { hm: v } }), unit: "m" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Distanz", value: getDisplayDistance(fl), onSave: (v) => saveComputedField(fl, { totalDist: parseFloat(v) || 0, customFields: { distKm: v } }), unit: "km" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Max Speed", value: fl.maxSpeedKmh ? String(fl.maxSpeedKmh) : "", onSave: (v) => saveField({ maxSpeedKmh: parseFloat(v) || 0 }), unit: "km/h" }), /* @__PURE__ */ React.createElement(StaticField, { label: "Dauer", value: fl.durationStr }), /* @__PURE__ */ React.createElement(StaticField, { label: "H.Diff.", value: fl.customFields?.hDiff, unit: "m" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Ø Speed", value: fl.customFields?.kmh, onSave: (v) => saveField({ customFields: { kmh: v } }), unit: "km/h" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Max.Steigen Druckdifferenz", value: fmt1(fl.customFields?.maxSteigenBaro), onSave: (v) => saveField({ customFields: { maxSteigenBaro: v } }), unit: "m/s" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Max.Steigen", value: fmt1(fl.customFields?.maxSteigen), onSave: (v) => saveField({ customFields: { maxSteigen: v } }), unit: "m/s" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Max.Steigen 20s", value: fmt1(fl.customFields?.maxSteigen20), onSave: (v) => saveField({ customFields: { maxSteigen20: v } }), unit: "m/s" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Max.Sinken", value: fmt1(fl.customFields?.maxSinken), onSave: (v) => saveField({ customFields: { maxSinken: v } }), unit: "m/s" }), /* @__PURE__ */ React.createElement(InlineField, { label: "H.Gew.", value: fl.customFields?.hGew, onSave: (v) => saveField({ customFields: { hGew: v } }), unit: "m" }), /* @__PURE__ */ React.createElement(StaticField, { label: "Entf. S-L", value: fl.entfernungSL != null ? String(fl.entfernungSL) : "", unit: "km" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Spirale Max.Sinken", value: fmt1(fl.customFields?.spiraleMaxSinken), onSave: (v) => saveField({ customFields: { spiraleMaxSinken: v } }), unit: "m/s" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Spirale Ø Sinken", value: fmt1(fl.customFields?.spiraleSinkenSchnitt), onSave: (v) => saveField({ customFields: { spiraleSinkenSchnitt: v } }), unit: "m/s" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Spirale Kreise", value: fl.customFields?.spiraleAnzahlKreise || "", onSave: (v) => saveField({ customFields: { spiraleAnzahlKreise: v } }) }), /* @__PURE__ */ React.createElement(InlineField, { label: "Spirale Höhenabbau", value: fl.customFields?.spiraleHoehenabbau || "", onSave: (v) => saveField({ customFields: { spiraleHoehenabbau: v } }), unit: "m" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Wingover Max.Sinken", value: fmt1(fl.customFields?.wingoverMaxSinken), onSave: (v) => saveField({ customFields: { wingoverMaxSinken: v } }), unit: "m/s" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Wingover Ø Sinken", value: fmt1(fl.customFields?.wingoverSinkenSchnitt), onSave: (v) => saveField({ customFields: { wingoverSinkenSchnitt: v } }), unit: "m/s" }), /* @__PURE__ */ React.createElement(InlineField, { label: "Anzahl Wingover", value: fl.customFields?.wingoverAnzahl || "", onSave: (v) => saveField({ customFields: { wingoverAnzahl: v } }) }), /* @__PURE__ */ React.createElement(InlineField, { label: "Wingover Höhenabbau", value: fl.customFields?.wingoverHoehenabbau || "", onSave: (v) => saveField({ customFields: { wingoverHoehenabbau: v } }), unit: "m" })), autoFields.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: "13px 15px", marginBottom: 11, border: "1px solid rgba(255,255,255,0.06)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: "#f59e0b", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 9 } }, "⚡ Auto-Felder"), autoFields.map((f) => /* @__PURE__ */ React.createElement("div", { key: f.id, style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "rgba(232,244,253,0.45)" } }, f.icon, " ", f.name), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: "#fcd34d" } }, f.value)))), manualFields.filter((f) => !["landung", "distKm", "kmh", "hDiff", "msa", "ml", "hm", "hGew", "maxSinken", "maxSteigen"].includes(f.id)).length > 0 && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: "13px 15px", marginBottom: 11, border: "1px solid rgba(255,255,255,0.06)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: "rgba(232,244,253,0.4)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 9 } }, "Eigene Felder"), manualFields.filter((f) => !["landung", "distKm", "kmh", "hDiff", "msa", "ml", "hm", "hGew", "maxSinken", "maxSteigen"].includes(f.id)).map((f) => /* @__PURE__ */ React.createElement(InlineField, { key: f.id, label: f.name, value: fl.customFields?.[f.id] || "", onSave: (v) => saveField({ customFields: { [f.id]: v } }) })))),
    showFieldEditor && /* @__PURE__ */ React.createElement(FieldEditor, { customFieldDefs, onSave: handleSaveFields, onClose: () => setShowFieldEditor(false) }),
    confirmDelete === fl.id && /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => setConfirmDelete(null),
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: (e) => e.stopPropagation(),
          style: { background: "#14253a", borderRadius: 16, padding: "20px 22px", maxWidth: 320, width: "100%", border: "1px solid rgba(255,255,255,0.1)" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 700, marginBottom: 6 } }, "Flug löschen?"),
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "rgba(232,244,253,0.6)", marginBottom: 18 } }, fl.name, " wird endgültig entfernt."),
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => setConfirmDelete(null),
            style: { flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }
          },
          "Abbrechen"
        ), /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: async () => {
              try {
                await window.storage.delete(`flight:${fl.id}`);
              } catch {
              }
              await deleteRawIgcFile(fl.id);
              setFlights((prev) => prev.filter((f) => f.id !== fl.id));
              setSelected(null);
              setConfirmDelete(null);
              setView("list");
            },
            style: { flex: 1, background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 10, padding: "10px", color: "#f87171", fontSize: 14, fontWeight: 700, cursor: "pointer" }
          },
          "Löschen"
        ))
      )
    ),
    confirmDeleteKind && /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => setConfirmDeleteKind(null),
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: (e) => e.stopPropagation(),
          style: { background: "#14253a", borderRadius: 16, padding: "20px 22px", maxWidth: 320, width: "100%", border: "1px solid rgba(255,255,255,0.1)" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 700, marginBottom: 6 } }, "IGC-Track löschen?"),
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "rgba(232,244,253,0.6)", marginBottom: 18 } }, "Der GPS-Track von ", fl.name, " wird entfernt. Start- und Landepunkt bleiben erhalten. Diese Aktion kann nicht rückgängig gemacht werden."),
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => setConfirmDeleteKind(null),
            style: { flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }
          },
          "Abbrechen"
        ), /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: deleteTrack,
            style: { flex: 1, background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 10, padding: "10px", color: "#f87171", fontSize: 14, fontWeight: 700, cursor: "pointer" }
          },
          "Löschen"
        ))
      )
    ),
    confirmNameChange !== null && /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => setConfirmNameChange(null),
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: (e) => e.stopPropagation(),
          style: { background: "#14253a", borderRadius: 16, padding: "20px 22px", maxWidth: 320, width: "100%", border: "1px solid rgba(255,255,255,0.1)" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 700, marginBottom: 6 } }, "⚠️ Flugname/-nummer ändern?"),
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "rgba(232,244,253,0.6)", marginBottom: 18 } }, "„", fl.name, "“ wird zu „", confirmNameChange, "“. Die Nummer wird sonst nirgends automatisch angepasst — bei falscher Eingabe können Dopplungen oder Lücken in der Nummerierung entstehen."),
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => setConfirmNameChange(null),
            style: { flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }
          },
          "Abbrechen"
        ), /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => {
              saveField({ name: confirmNameChange });
              setConfirmNameChange(null);
            },
            style: { flex: 1, background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 10, padding: "10px", color: "#fcd34d", fontSize: 14, fontWeight: 700, cursor: "pointer" }
          },
          "Ändern"
        ))
      )
    ),
    confirmDateChange !== null && /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => setConfirmDateChange(null),
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: (e) => e.stopPropagation(),
          style: { background: "#14253a", borderRadius: 16, padding: "20px 22px", maxWidth: 320, width: "100%", border: "1px solid rgba(255,255,255,0.1)" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 700, marginBottom: 6 } }, "⚠️ Datum ändern?"),
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "rgba(232,244,253,0.6)", marginBottom: 18 } }, "Ein neues Datum verschiebt ", fl.name, " evtl. an eine andere Stelle in der Chronologie — dabei werden ", /* @__PURE__ */ React.createElement("b", null, "alle"), " Flugnummern neu, lückenlos durchnummeriert. Fortfahren?"),
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => setConfirmDateChange(null),
            style: { flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }
          },
          "Abbrechen"
        ), /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => {
              const d = confirmDateChange;
              setConfirmDateChange(null);
              saveDateField(d);
            },
            style: { flex: 1, background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 10, padding: "10px", color: "#fcd34d", fontSize: 14, fontWeight: 700, cursor: "pointer" }
          },
          "Ändern"
        ))
      )
    ),
    confirmTypAuto !== null && /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => {
          saveField({ customFields: { typAuto: false } });
          setConfirmTypAuto(null);
        },
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: (e) => e.stopPropagation(),
          style: { background: "#14253a", borderRadius: 16, padding: "20px 22px", maxWidth: 320, width: "100%", border: "1px solid rgba(255,255,255,0.1)" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 700, marginBottom: 6 } }, "Typ automatisch führen?"),
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "rgba(232,244,253,0.6)", marginBottom: 18 } }, "Dieser importierte Flug hat bereits einen Typ: „", fl.customFields?.typ, '". Automatischer Standard wäre: „', confirmTypAuto, '". Soll der Typ ab jetzt automatisch mitgeführt werden (aktueller Wert wird dabei ersetzt)? Diese Wahl gilt nur für diesen Flug und wird gemerkt.'),
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => {
              saveField({ customFields: { typAuto: false } });
              setConfirmTypAuto(null);
            },
            style: { flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }
          },
          "Beibehalten"
        ), /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => {
              const v = confirmTypAuto;
              setConfirmTypAuto(null);
              saveField({ customFields: { typ: v, typAuto: true } });
            },
            style: { flex: 1, background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 10, padding: "10px", color: "#fcd34d", fontSize: 14, fontWeight: 700, cursor: "pointer" }
          },
          "Automatisch"
        ))
      )
    )
  );
}
function SidebarList({ flights, selectedId, onSelect, longestId }) {
  const [filterText, setFilterText] = useState("");
  const [sortId, setSortId] = useState("number");
  const [sortDir, setSortDir] = useState("desc");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const filtered = matchFlights(flights, filterText);
  const years = [...new Set(filtered.map((f) => f.year).filter(Boolean))].sort((a, b) => b - a);
  const rowRefs = useRef({});
  useEffect(() => {
    const el = rowRefs.current[selectedId];
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);
  return /* @__PURE__ */ React.createElement("div", { style: { width: "clamp(340px, 22vw, 440px)", minWidth: 340, height: "100vh", overflowY: "auto", borderRight: "1px solid rgba(255,255,255,0.08)", background: "#040e20", fontFamily: "system-ui,sans-serif" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "calc(14px + env(safe-area-inset-top, 0px)) 14px 8px", position: "sticky", top: 0, background: "#040e20", zIndex: 5, borderBottom: "1px solid rgba(255,255,255,0.06)" } }, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 6 } }, /* @__PURE__ */ React.createElement(SearchBar, { filterText, setFilterText, knownGliders: [...new Set(flights.map((f) => f.glider).filter(Boolean))].sort() })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, position: "relative" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setShowSortMenu((s) => !s),
      style: { flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 10px", color: "rgba(232,244,253,0.8)", fontSize: 11, cursor: "pointer" }
    },
    /* @__PURE__ */ React.createElement("span", null, "⇅ ", SORT_OPTIONS.find((o) => o.id === sortId)?.label || "—"),
    /* @__PURE__ */ React.createElement("span", null, showSortMenu ? "▾" : "▸")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setSortDir((d) => d === "asc" ? "desc" : "asc"),
      style: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "6px 10px", color: "#7dd3fc", fontSize: 12, cursor: "pointer" }
    },
    sortDir === "asc" ? "↑" : "↓"
  ), showSortMenu && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#14253a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 5, maxHeight: 240, overflowY: "auto", zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" } }, SORT_OPTIONS.map((o) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: o.id,
      onClick: () => {
        setSortId(o.id);
        setShowSortMenu(false);
      },
      style: { padding: "7px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", color: o.id === sortId ? "#7dd3fc" : "rgba(232,244,253,0.75)", background: o.id === sortId ? "rgba(14,165,233,0.15)" : "transparent" }
    },
    o.label
  ))))), sortId !== "date" ? sortFlights(filtered, sortId, sortDir).map((f) => /* @__PURE__ */ React.createElement(
    SidebarFlightRow,
    {
      key: f.id,
      f,
      selectedId,
      longestId,
      onSelect,
      sortId,
      registerRef: (el) => {
        rowRefs.current[f.id] = el;
      }
    }
  )) : years.map((yr) => {
    const yFlights = sortFlights(filtered.filter((f) => f.year === yr), sortId, sortDir);
    return /* @__PURE__ */ React.createElement("div", { key: yr }, /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "#7dd3fc", background: "rgba(255,255,255,0.02)" } }, yr, " · ", yFlights.length), yFlights.map((f) => /* @__PURE__ */ React.createElement(
      SidebarFlightRow,
      {
        key: f.id,
        f,
        selectedId,
        longestId,
        onSelect,
        sortId,
        registerRef: (el) => {
          rowRefs.current[f.id] = el;
        }
      }
    )));
  }));
}
const SIDEBAR_ROW_VISIBLE_SORT_IDS = /* @__PURE__ */ new Set(["date", "site"]);
function SidebarFlightRow({ f, selectedId, longestId, onSelect, registerRef, sortId }) {
  const sortExtra = !SIDEBAR_ROW_VISIBLE_SORT_IDS.has(sortId) ? sortFieldDisplay(f, sortId) : null;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      ref: registerRef,
      onClick: () => onSelect(f),
      style: { padding: "5px 14px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)", background: f.id === selectedId ? "rgba(14,165,233,0.12)" : "transparent", borderLeft: f.id === selectedId ? "3px solid #7dd3fc" : "3px solid transparent" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } }, f.id === longestId && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11 } }, "🏆"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#a8d8f5" } }, f.date)),
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#a8d8f5", marginTop: 2 } }, f.site),
    sortExtra && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#a8d8f5", marginTop: 2 } }, sortExtra)
  );
}
function useIsWide() {
  const [isWide, setIsWide] = useState(typeof window !== "undefined" ? window.innerWidth >= 1024 : false);
  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isWide;
}
function useIsLandscapePhone() {
  const check = () => typeof window !== "undefined" && window.innerWidth > window.innerHeight && window.innerWidth < 1024;
  const [isLandscapePhone, setIsLandscapePhone] = useState(check);
  useEffect(() => {
    const onResize = () => setIsLandscapePhone(check());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isLandscapePhone;
}
function CsvColumnConfigModal({ columns, onSave, onClose }) {
  const [local, setLocal] = useState(columns);
  const toggle = (key) => setLocal((cols) => cols.map((c) => c.key === key ? { ...c, enabled: !c.enabled } : c));
  const move = (idx, dir) => setLocal((cols) => {
    const next = [...cols];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return cols;
    [next[idx], next[j]] = [next[j], next[idx]];
    return next;
  });
  const labelFor = (key) => CSV_COLUMN_DEFS.find((c) => c.key === key)?.label || key;
  return /* @__PURE__ */ React.createElement("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 } }, /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: (e) => e.stopPropagation(),
      style: { background: "#0a1628", borderRadius: 16, padding: "18px 16px", maxWidth: 400, width: "100%", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh", display: "flex", flexDirection: "column" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 800, marginBottom: 4 } }, 'Spalten für "Kopieren"'),
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.5)", marginBottom: 14 } }, "Auswählen und mit ↑/↓ in die gewünschte Reihenfolge bringen, passend zur Ziel-Tabelle."),
    /* @__PURE__ */ React.createElement("div", { style: { overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 } }, local.map((c, idx) => /* @__PURE__ */ React.createElement("div", { key: c.key, style: { display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 8, background: c.enabled ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.03)" } }, /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => toggle(c.key),
        style: { width: 20, height: 20, borderRadius: 6, border: `2px solid ${c.enabled ? "#4ade80" : "rgba(232,244,253,0.3)"}`, background: c.enabled ? "#4ade80" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }
      },
      c.enabled && /* @__PURE__ */ React.createElement("span", { style: { color: "#0a1628", fontSize: 13, fontWeight: 900 } }, "✓")
    ), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, fontSize: 13, color: c.enabled ? "#e8f4fd" : "rgba(232,244,253,0.4)" } }, labelFor(c.key)), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => move(idx, -1),
        disabled: idx === 0,
        style: { background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 6, width: 26, height: 26, color: idx === 0 ? "rgba(232,244,253,0.2)" : "#e8f4fd", fontSize: 13, cursor: idx === 0 ? "default" : "pointer" }
      },
      "▲"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => move(idx, 1),
        disabled: idx === local.length - 1,
        style: { background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 6, width: 26, height: 26, color: idx === local.length - 1 ? "rgba(232,244,253,0.2)" : "#e8f4fd", fontSize: 13, cursor: idx === local.length - 1 ? "default" : "pointer" }
      },
      "▼"
    )))),
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 16 } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setLocal(CSV_COLUMN_DEFS.map((c) => ({ key: c.key, enabled: true }))),
        style: { flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "9px", color: "rgba(232,244,253,0.7)", fontSize: 13, cursor: "pointer" }
      },
      "Zurücksetzen"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          onSave(local);
          onClose();
        },
        style: { flex: 1, background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "#fff", border: "none", borderRadius: 10, padding: 9, fontSize: 13, fontWeight: 800, cursor: "pointer" }
      },
      "Speichern"
    ))
  ));
}
function DateAmbiguousResolver({ item, onAssign, onCreateNew, onClose, description }) {
  return /* @__PURE__ */ React.createElement("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 } }, /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: (e) => e.stopPropagation(),
      style: { background: "#0a1628", borderRadius: 16, padding: "18px 16px", maxWidth: 380, width: "100%", border: "1px solid rgba(255,255,255,0.1)" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 800, marginBottom: 6 } }, "Welchem Flug zuordnen?"),
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.5)", marginBottom: 10 } }, description || `"${item.file.name}" (${item.date}) passt zu keiner Flug-Nr., aber es gibt mehrere Flüge an diesem Datum ohne GPS-Track.`),
    (item.igcData?.startTime || item.igcData?.durationStr) && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#7dd3fc", background: "rgba(125,211,252,0.08)", border: "1px solid rgba(125,211,252,0.2)", borderRadius: 8, padding: "7px 10px", marginBottom: 12 } }, "IGC-Datei: ", item.igcData?.startTime ? `Start ${item.igcData.startTime}` : "", item.igcData?.startTime && item.igcData?.durationStr ? " · " : "", item.igcData?.durationStr ? `Dauer ${item.igcData.durationStr}` : ""),
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 12, maxHeight: "40vh", overflowY: "auto" } }, item.candidates.map((c) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: c.id,
        onClick: () => onAssign(c),
        style: { textAlign: "left", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 12px", color: "#e8f4fd", fontSize: 13, cursor: "pointer" }
      },
      /* @__PURE__ */ React.createElement("b", null, c.name),
      c.site ? " · " + c.site : "",
      c.startTime ? " · " + c.startTime : "",
      !c.startTime && c.durationStr ? " · " + c.durationStr : ""
    ))),
    onCreateNew && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: onCreateNew,
        style: { width: "100%", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 10, padding: "9px", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: "pointer" }
      },
      "+ Stattdessen neuen Flug anlegen"
    )
  ));
}
function NewSchirmDialog({ items, onConfirm, onCancel }) {
  const [edited, setEdited] = useState(() => items.map((it) => ({ name: it.name, hersteller: it.hersteller })));
  const setField = (i, field, value) => setEdited((prev) => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e));
  return /* @__PURE__ */ React.createElement("div", { onClick: onCancel, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 } }, /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: (e) => e.stopPropagation(),
      style: { background: "#0a1628", borderRadius: 16, padding: "18px 16px", maxWidth: 420, width: "100%", maxHeight: "85vh", overflowY: "auto", border: "1px solid rgba(255,255,255,0.1)" }
    },
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 800, marginBottom: 6 } }, items.length === 1 ? "Neuer Schirm gefunden" : `${items.length} neue Schirme gefunden`),
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.5)", marginBottom: 14 } }, "Aus der IGC-Datei erkannt, aber noch nicht in deiner Schirme-Liste. Bitte prüfen/ergänzen — Hersteller lässt sich aus der Datei nicht immer sicher bestimmen."),
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, marginBottom: 16 } }, items.map((it, i) => /* @__PURE__ */ React.createElement("div", { key: it.key, style: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 12px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "rgba(232,244,253,0.4)", marginBottom: 8, fontFamily: "monospace" } }, "Original: „", it.raw, '"'), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "rgba(232,244,253,0.4)", marginBottom: 3 } }, "Schirm"), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: edited[i].name,
        onChange: (e) => setField(i, "name", e.target.value),
        style: { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "8px 10px", color: "#e8f4fd", fontSize: 13, fontWeight: 700 }
      }
    )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "rgba(232,244,253,0.4)", marginBottom: 3 } }, "Hersteller"), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: edited[i].hersteller,
        onChange: (e) => setField(i, "hersteller", e.target.value),
        placeholder: "z.B. Niviuk",
        style: { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "8px 10px", color: "#e8f4fd", fontSize: 13 }
      }
    ))))),
    /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => onConfirm(edited),
        style: { width: "100%", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 10, padding: "11px", color: "#4ade80", fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 8 }
      },
      "✓ Übernehmen & Import fortsetzen"
    ),
    /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: onCancel,
        style: { width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "9px", color: "rgba(232,244,253,0.6)", fontSize: 13, cursor: "pointer" }
      },
      "Import abbrechen"
    )
  ));
}
function DateDupWarningDialog({ items, onImportAnyway, onSkip }) {
  return /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { background: "#0a1628", borderRadius: 16, padding: "18px 16px", maxWidth: 420, width: "100%", maxHeight: "85vh", overflowY: "auto", border: "1px solid rgba(255,255,255,0.1)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 800, marginBottom: 6 } }, items.length === 1 ? "Flug vermutlich schon vorhanden" : `${items.length} Flüge vermutlich schon vorhanden`), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.5)", marginBottom: 14 } }, "Gleiches Datum und dieselbe Startzeit wie ein bereits vorhandener Flug mit GPS-Track, aber unter einem anderen Dateinamen — vermutlich dieselbe Aufzeichnung, nochmal exportiert."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 } }, items.map(({ item, existing }) => /* @__PURE__ */ React.createElement("div", { key: item.baseName, style: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 12px", fontSize: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, marginBottom: 2 } }, item.file.name), /* @__PURE__ */ React.createElement("div", { style: { color: "rgba(232,244,253,0.5)" } }, item.date, " · ", item.igcData.startTime, " — passt zu Flug „", existing.name, '"', existing.site ? ` (${existing.site})` : "")))), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onSkip,
      style: { width: "100%", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 10, padding: "11px", color: "#4ade80", fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 8 }
    },
    "Überspringen (empfohlen)"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onImportAnyway,
      style: { width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "9px", color: "rgba(232,244,253,0.6)", fontSize: 13, cursor: "pointer" }
    },
    "Trotzdem als neue Flüge importieren"
  )));
}
function splitDialogRowStats(igcData) {
  const fmtClock = (t) => (t || "").slice(0, 5);
  const distKm = igcData.scoreDistanceKm;
  const maxSpeed = igcData.maxSpeedKmh;
  const avgSpeed = distKm && igcData.durationSec ? +(distKm / (igcData.durationSec / 3600)).toFixed(1) : null;
  return {
    zeit: `${fmtClock(igcData.startTime)}–${fmtClock(igcData.endTime)}`,
    dauer: igcData.durationStr || "—",
    distanz: distKm != null ? `${distKm} km` : "—",
    maxSpeed: maxSpeed ? `${maxSpeed} km/h` : "—",
    avgSpeed: avgSpeed != null ? `${avgSpeed} km/h` : "—"
  };
}
function SplitFlightDialogRow({ label, stats, highlight }) {
  return /* @__PURE__ */ React.createElement("div", { style: { background: highlight ? "rgba(14,165,233,0.08)" : "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 4, color: highlight ? "#7dd3fc" : "#e8f4fd" } }, label), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "3px 14px", fontSize: 12, color: "rgba(232,244,253,0.7)" } }, /* @__PURE__ */ React.createElement("span", null, "🕐 ", stats.zeit), /* @__PURE__ */ React.createElement("span", null, "⏱ ", stats.dauer), /* @__PURE__ */ React.createElement("span", null, "📏 ", stats.distanz), /* @__PURE__ */ React.createElement("span", null, "⚡ ", stats.maxSpeed), /* @__PURE__ */ React.createElement("span", null, "Ø ", stats.avgSpeed)));
}
function SplitFlightDialog({ candidate, subtitle, onKeep, onSplit }) {
  const combined = splitDialogRowStats(candidate.combinedIgcData);
  const parts = candidate.segments.map((seg) => splitDialogRowStats(seg.igcData));
  return /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { background: "#0a1628", borderRadius: 16, padding: "18px 16px", maxWidth: 440, width: "100%", maxHeight: "85vh", overflowY: "auto", border: "1px solid rgba(255,255,255,0.1)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 800, marginBottom: 4 } }, "Mehrere Flüge in einer Datei erkannt"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.5)", marginBottom: 4 } }, subtitle || candidate.file?.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.5)", marginBottom: 14 } }, "Zwischen den erkannten Abschnitten liegt eine längere Pause (Bodentransport/Warten). Als ein Flug behalten oder in ", candidate.segments.length, " Flüge aufteilen?"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.4)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 } }, "Ohne Split"), /* @__PURE__ */ React.createElement(SplitFlightDialogRow, { label: "1 Flug (gesamt)", stats: combined }), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "rgba(232,244,253,0.4)", margin: "10px 0 6px", textTransform: "uppercase", letterSpacing: 0.5 } }, "Mit Split"), parts.map((p, i) => /* @__PURE__ */ React.createElement(SplitFlightDialogRow, { key: i, label: `Teil ${i + 1}`, stats: p, highlight: true })), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onSplit,
      style: { width: "100%", background: "rgba(14,165,233,0.15)", border: "1px solid rgba(14,165,233,0.4)", borderRadius: 10, padding: "11px", color: "#7dd3fc", fontSize: 14, fontWeight: 700, cursor: "pointer", marginTop: 10, marginBottom: 8 }
    },
    "In ",
    candidate.segments.length,
    " Flüge aufteilen"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onKeep,
      style: { width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "9px", color: "rgba(232,244,253,0.6)", fontSize: 13, cursor: "pointer" }
    },
    "Nicht aufteilen (1 Flug)"
  )));
}
function FlugbuchApp() {
  const isWide = useIsWide();
  const isLandscapePhone = useIsLandscapePhone();
  const [flights, setFlights] = useState([]);
  const [showSeason, setShowSeason] = useState(false);
  const [mapTilerKey, setMapTilerKey] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("settings:maptilerApiKey");
        if (r && r.value) setMapTilerKey(r.value);
      } catch {
      }
    })();
  }, []);
  const [placeMatchRadiusKm, setPlaceMatchRadiusKm] = useState(0.5);
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("settings:placeMatchRadiusKm");
        const n = r && r.value ? parseFloat(r.value) : NaN;
        if (isFinite(n) && n > 0) setPlaceMatchRadiusKm(n);
      } catch {
      }
    })();
  }, []);
  const igcDirFsapiSupported = typeof window !== "undefined" && !!window.showDirectoryPicker;
  const [igcDirHandle, setIgcDirHandle] = useState(null);
  const [igcDirName, setIgcDirName] = useState(null);
  useEffect(() => {
    if (!igcDirFsapiSupported) return;
    (async () => {
      try {
        const handle = await window.fsapiHandle.get("igcDir");
        if (handle) {
          setIgcDirHandle(handle);
          setIgcDirName(handle.name);
        }
      } catch (e) {
        console.error("IGC-Ordner laden fehlgeschlagen:", e);
      }
    })();
  }, [igcDirFsapiSupported]);
  const chooseIgcDir = async () => {
    if (!igcDirFsapiSupported) return;
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      await window.fsapiHandle.set("igcDir", handle);
      setIgcDirHandle(handle);
      setIgcDirName(handle.name);
      await runIgcDirImport(handle);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      console.error("IGC-Ordnerauswahl fehlgeschlagen:", e);
    }
  };
  const clearIgcDir = async () => {
    await window.fsapiHandle.delete("igcDir");
    setIgcDirHandle(null);
    setIgcDirName(null);
  };
  const scanIgcDirRecursive = async (dirHandle) => {
    const files = [];
    const walk = async (handle) => {
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind === "directory") {
          await walk(entry);
          continue;
        }
        if (entry.kind === "file" && /\.igc$/i.test(name)) {
          try {
            files.push(await entry.getFile());
          } catch (e) {
            console.error("IGC-Datei lesen fehlgeschlagen:", name, e);
          }
        }
      }
    };
    await walk(dirHandle);
    return files;
  };
  const flightsWithRanks = useMemo(() => attachComputedRanks(flights), [flights]);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("list");
  const listScrollRef = useRef(0);
  useLayoutEffect(() => {
    window.scrollTo(0, view === "list" ? listScrollRef.current : 0);
  }, [view]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [igcResult, setIgcResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const schirmeListRef = useRef(null);
  const [pendingDups, setPendingDups] = useState([]);
  const [dupWarning, setDupWarning] = useState(null);
  const [pendingDateAmbiguous, setPendingDateAmbiguous] = useState([]);
  const [pendingSplitDecisions, setPendingSplitDecisions] = useState(null);
  const [pendingNewSchirme, setPendingNewSchirme] = useState(null);
  const [pendingDateDups, setPendingDateDups] = useState(null);
  const pendingImportRef = useRef(null);
  const [editData, setEditData] = useState({});
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [showFieldEditor, setShowFieldEditor] = useState(false);
  const [filterText, setFilterTextRaw] = useState("");
  const [sortId, setSortIdRaw] = useState("number");
  const [sortDir, setSortDirRaw] = useState("desc");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [searchRowOpen, setSearchRowOpen] = useState(false);
  const [savedViews, setSavedViewsRaw] = useState([]);
  const [showViewsMenu, setShowViewsMenu] = useState(false);
  const [viewsMode, setViewsMode] = useState("none");
  const [savingViewName, setSavingViewName] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("flugbuchSavedViews");
        if (r && r.value) {
          const v = JSON.parse(r.value);
          if (Array.isArray(v)) setSavedViewsRaw(v);
        }
      } catch (e) {
      }
    })();
  }, []);
  const setSavedViews = (updater) => {
    setSavedViewsRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try {
        window.storage.set("flugbuchSavedViews", JSON.stringify(next));
      } catch (e) {
      }
      return next;
    });
  };
  const applyView = (view2) => {
    const c = view2.config || {};
    setFilterTextRaw(c.filterText || "");
    setSortIdRaw(c.sortId || "number");
    setSortDirRaw(c.sortDir || "desc");
    persistListSettings({
      filterText: c.filterText || "",
      sortId: c.sortId || "number",
      sortDir: c.sortDir || "desc"
    });
    setShowViewsMenu(false);
    setSearchRowOpen(false);
  };
  const saveCurrentAsView = (name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    const config = { filterText, sortId, sortDir };
    setSavedViews((prev) => [...prev, { id: "view_" + Date.now(), name: trimmed, config }]);
    setSavingViewName(null);
  };
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("flugbuchListSettings");
        if (r && r.value) {
          const s = JSON.parse(r.value);
          if (typeof s.filterText === "string") setFilterTextRaw(s.filterText);
          if (s.sortId) setSortIdRaw(s.sortId);
          if (s.sortDir) setSortDirRaw(s.sortDir);
        }
      } catch (e) {
      }
    })();
  }, []);
  const persistListSettings = (patch) => {
    try {
      window.storage.set("flugbuchListSettings", JSON.stringify({
        filterText,
        sortId,
        sortDir,
        ...patch
      }));
    } catch (e) {
    }
  };
  const setFilterText = (v) => {
    setFilterTextRaw(v);
    persistListSettings({ filterText: v });
  };
  const setSortId = (v) => {
    setSortIdRaw(v);
    persistListSettings({ sortId: v });
  };
  const setSortDir = (updater) => {
    setSortDirRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      persistListSettings({ sortDir: next });
      return next;
    });
  };
  const [showFilterHelp, setShowFilterHelp] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showRowImport, setShowRowImport] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [csvColumns, setCsvColumns] = useState(
    CSV_COLUMN_DEFS.map((c) => ({ key: c.key, enabled: true }))
  );
  const [showCsvColumnConfig, setShowCsvColumnConfig] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("csvColumnConfig");
        if (r) {
          const saved = JSON.parse(r.value);
          const savedKeys = new Set(saved.map((c) => c.key));
          const merged = [...saved, ...CSV_COLUMN_DEFS.filter((c) => !savedKeys.has(c.key)).map((c) => ({ key: c.key, enabled: true }))];
          setCsvColumns(merged);
        }
      } catch (e) {
        console.error("Load error (csvColumnConfig):", e);
      }
    })();
  }, []);
  const saveCsvColumns = async (next) => {
    setCsvColumns(next);
    try {
      await window.storage.set("csvColumnConfig", JSON.stringify(next));
    } catch (e) {
      console.error("Save error (csvColumnConfig):", e);
    }
  };
  const [selectedIds, setSelectedIds] = useState(/* @__PURE__ */ new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditData, setBulkEditData] = useState({});
  const [confirmBulkDateRenumber, setConfirmBulkDateRenumber] = useState(false);
  const reisenNames = useMemo(() => {
    const fromFlights = flights.map((f) => f.customFields?.reise).filter(Boolean);
    return [...new Set(fromFlights)].sort((a, b) => a.localeCompare(b, "de"));
  }, [flights]);
  const [returnTo, setReturnTo] = useState(null);
  const [copyMsg, setCopyMsg] = useState("");
  const [rowImportText, setRowImportText] = useState("");
  const [rowImportError, setRowImportError] = useState("");
  const fileRef = useRef(null);
  const dirtyTrackingReadyRef = useRef(false);
  const suppressNextDirtyRef = useRef(false);
  useEffect(() => {
    if (!dirtyTrackingReadyRef.current) return;
    if (suppressNextDirtyRef.current) {
      suppressNextDirtyRef.current = false;
      return;
    }
    try {
      window.storage.set("settings:backupDirty", "1");
    } catch {
    }
  }, [flights, customFieldDefs]);
  useEffect(() => {
    const handler = (e) => {
      if (importProgress) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [importProgress]);
  useEffect(() => {
    (async () => {
      let loaded = [];
      try {
        const keys = await window.storage.list("flight:");
        const raw = await Promise.all((keys?.keys || []).map(async (k2) => {
          try {
            const r = await window.storage.get(k2);
            return r ? JSON.parse(r.value) : null;
          } catch {
            return null;
          }
        }));
        loaded = raw.filter(Boolean);
      } catch (e) {
        console.error("Storage load error:", e);
        loaded = [];
      }
      const sorted = loaded.sort((a, b) => parseInt((b.name || "").match(/\d+/)?.[0] || "0", 10) - parseInt((a.name || "").match(/\d+/)?.[0] || "0", 10));
      setFlights(sorted);
      try {
        const params = new URLSearchParams(window.location.search);
        const openId = params.get("openFlightId");
        const ret = params.get("returnTo");
        if (openId) {
          const target = sorted.find((f) => String(f.id) === openId);
          if (target) {
            setSelected(target);
            setView("detail");
            if (ret) setReturnTo(ret);
          }
        }
      } catch {
      }
      try {
        const r = await window.storage.get("customFieldDefs");
        if (r) {
          const s = JSON.parse(r.value).filter((d) => d.id !== "passagier");
          if (s.length) setCustomFieldDefs(s);
        }
      } catch {
      }
      setTimeout(() => {
        dirtyTrackingReadyRef.current = true;
      }, 500);
    })();
  }, []);
  const saveFlight = useCallback(async (f) => {
    try {
      await window.storage.set(`flight:${f.id}`, JSON.stringify(f));
      return { ok: true };
    } catch (e) {
      console.error("Flug konnte nicht gespeichert werden:", f?.id, e);
      return { ok: false, error: e };
    }
  }, []);
  const addNewFlight = useCallback(async () => {
    const maxNr = flights.reduce((m, f) => {
      const n = parseInt((f.name || "").match(/\d+/)?.[0] || "0", 10);
      return n > m ? n : m;
    }, 0);
    const newNr = maxNr + 1;
    const now = /* @__PURE__ */ new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = String(now.getFullYear());
    const newFlight = {
      id: `manual_${newNr}_${Date.now()}`,
      name: String(newNr),
      pdfOnly: false,
      date: `${dd}.${mm}.${yyyy}`,
      rawDate: `${dd}.${mm}.${yyyy}`,
      year: yyyy,
      month: mm,
      startTime: "",
      endTime: "",
      site: "",
      glider: "",
      pilot: "",
      comment: "",
      notes: "",
      durationStr: "",
      durationSec: 0,
      totalDist: 0,
      maxAlt: 0,
      startAlt: 0,
      endAlt: 0,
      startPt: null,
      endPt: null,
      track: [],
      customFields: { landung: "", typ: "GS", typAuto: true }
    };
    await saveFlight(newFlight);
    setFlights((prev) => [newFlight, ...prev].sort((a, b) => parseInt((b.name || "").match(/\d+/)?.[0] || "0", 10) - parseInt((a.name || "").match(/\d+/)?.[0] || "0", 10)));
    setSelected(newFlight);
    setView("detail");
  }, [flights, saveFlight]);
  const handleSaveFields = useCallback(async (defs) => {
    setCustomFieldDefs(defs);
    setShowFieldEditor(false);
    try {
      await window.storage.set("customFieldDefs", JSON.stringify(defs));
    } catch {
    }
  }, []);
  const doImport = useCallback(async (igcFiles) => {
    if (!igcFiles.length) return;
    setImporting(true);
    setImportProgress({ done: 0, total: igcFiles.length });
    const toImport = [];
    const dups = [];
    const flightsWithTrack = new Map(
      flights.filter((f) => f.track && f.track.length > 1 && f.customFields?.igcFilename).map((f) => [f.customFields.igcFilename, f])
    );
    for (const file of igcFiles) {
      const baseName = file.name.replace(/\.igc$/i, "");
      if (flightsWithTrack.has(baseName)) dups.push(file);
      else toImport.push(file);
    }
    if (dups.length) {
      setPendingDups({ confirmed: [...toImport], ask: dups });
      setDupWarning(dups.map((f) => f.name).join(", "));
      setImporting(false);
      setImportProgress(null);
      return;
    }
    await processIGCFiles(toImport);
  }, [flights]);
  const [igcDirScanning, setIgcDirScanning] = useState(false);
  const [igcDirResult, setIgcDirResult] = useState(null);
  const runIgcDirImport = useCallback(async (handleOverride) => {
    const handle = handleOverride || igcDirHandle;
    if (!handle) return;
    setIgcDirScanning(true);
    setIgcDirResult(null);
    try {
      const allFiles = await scanIgcDirRecursive(handle);
      const knownNames = new Set(
        flights.map((f) => f.customFields?.igcFilename).filter(Boolean)
      );
      const newFiles = allFiles.filter((f) => !knownNames.has(f.name.replace(/\.igc$/i, "")));
      setIgcDirScanning(false);
      setIgcDirResult({ total: allFiles.length, neu: newFiles.length });
      if (newFiles.length) await doImport(newFiles);
    } catch (e) {
      console.error("Vario-Import fehlgeschlagen:", e);
      setIgcDirScanning(false);
      setIgcDirResult({ error: e.message || String(e) });
    }
  }, [igcDirHandle, flights, doImport]);
  const resolveSchirmForGlider = useCallback(async (rawGlider, overrideMap) => {
    const { hersteller, cleaned } = splitFirstWordAsHersteller(rawGlider);
    if (!cleaned) return { name: "", schirmId: null };
    const norm = (s) => (s || "").trim().toLowerCase();
    if (overrideMap && overrideMap.has(norm(cleaned))) {
      const ov = overrideMap.get(norm(cleaned));
      return { name: ov.name, schirmId: ov.id };
    }
    let list = schirmeListRef.current;
    if (!list) {
      try {
        const r = await window.storage.get(SCHIRME_KEY);
        list = r ? JSON.parse(r.value) : [];
      } catch (e) {
        console.error("Schirme-Liste laden fehlgeschlagen:", e);
        list = [];
      }
      schirmeListRef.current = list;
    }
    let entry = list.find((s) => norm(s.name) === norm(cleaned));
    let changed = false;
    if (entry) {
      if (!entry.hersteller && hersteller) {
        entry = { ...entry, hersteller };
        list = list.map((s) => s.id === entry.id ? entry : s);
        changed = true;
      }
    } else {
      entry = {
        id: `schirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: cleaned,
        hersteller: hersteller || "",
        typ: "",
        letzterCheck: "",
        materialEntryId: null
      };
      list = [...list, entry];
      changed = true;
    }
    schirmeListRef.current = list;
    if (changed) {
      try {
        await window.storage.set(SCHIRME_KEY, JSON.stringify(list));
        await window.storage.set("settings:backupDirty", "1");
      } catch (e) {
        console.error("Schirme-Liste speichern fehlgeschlagen:", e);
      }
    }
    return { name: cleaned, schirmId: entry.id };
  }, []);
  const attachIgcToFlight = useCallback(async (existing, file, track, date, pilot, glider, igcData, igcFilename, overrideMap) => {
    const cf = { ...existing.customFields || {} };
    if (!(cf.typ || "").trim() && cf.typAuto !== false) {
      cf.typ = "GS";
      cf.typAuto = true;
    }
    if (!(cf.hGew || "").trim() && !isNaN(igcData.totalGain)) cf.hGew = String(igcData.totalGain);
    if (igcData.hDiff) cf.hDiff = String(igcData.hDiff);
    cf.maxSteigen = String(igcData.maxClimb);
    cf.maxSteigen20 = String(igcData.maxClimb20);
    cf.maxSinken = String(igcData.maxSinkRate);
    cf.maxSteigenBaro = igcData.maxClimbBaro != null ? String(igcData.maxClimbBaro) : "";
    cf.spiraleMaxSinken = igcData.spiraleMaxSinken != null ? String(igcData.spiraleMaxSinken) : "";
    cf.spiraleSinkenSchnitt = igcData.spiraleSinkenSchnitt != null ? String(igcData.spiraleSinkenSchnitt) : "";
    cf.spiraleAnzahlKreise = igcData.spiraleAnzahlKreise != null ? String(igcData.spiraleAnzahlKreise) : "";
    cf.spiraleHoehenabbau = igcData.spiraleHoehenabbau != null ? String(igcData.spiraleHoehenabbau) : "";
    cf.wingoverMaxSinken = igcData.wingoverMaxSinken != null ? String(igcData.wingoverMaxSinken) : "";
    cf.wingoverSinkenSchnitt = igcData.wingoverSinkenSchnitt != null ? String(igcData.wingoverSinkenSchnitt) : "";
    cf.wingoverAnzahl = igcData.wingoverAnzahl != null ? String(igcData.wingoverAnzahl) : "";
    cf.wingoverHoehenabbau = igcData.wingoverHoehenabbau != null ? String(igcData.wingoverHoehenabbau) : "";
    if (igcFilename) cf.igcFilename = igcFilename;
    let cleanedGlider = "";
    if (!cf.schirmId) {
      const resolved = await resolveSchirmForGlider(glider, overrideMap);
      cleanedGlider = resolved.name;
      if (resolved.schirmId) cf.schirmId = resolved.schirmId;
    }
    const startPtForInfer = existing.startPt || igcData.startPt;
    const endPtForInfer = existing.endPt || igcData.endPt;
    const needsSite = !(existing.site || "").trim();
    const needsLandung = !(cf.landung || "").trim();
    const needsLand = !(cf.land || "").trim();
    let inferredSite = "", inferredLandung = "";
    if (needsSite || needsLandung || needsLand) {
      const inferred = await inferPlaceAndCountry(startPtForInfer, endPtForInfer, flights, placeMatchRadiusKm, mapTilerKey);
      inferredSite = inferred.site;
      inferredLandung = inferred.landung;
      if (needsLandung && inferred.landung) cf.landung = inferred.landung;
      if (needsLand && inferred.land) cf.land = inferred.land;
    }
    const backfill = computeDistanceSpeedBackfill(existing.totalDist, cf, igcData.scoreDistanceKm, igcData.durationSec || existing.durationSec);
    if (backfill.distKm != null) cf.distKm = backfill.distKm;
    if (backfill.kmh != null) cf.kmh = backfill.kmh;
    const updated = {
      ...existing,
      track,
      customFields: cf,
      pilot: (existing.pilot || "").trim() ? existing.pilot : pilot || existing.pilot,
      glider: (existing.glider || "").trim() ? existing.glider : cleanedGlider || existing.glider,
      site: needsSite && inferredSite ? inferredSite : existing.site,
      maxAlt: existing.maxAlt || igcData.maxAlt,
      minAlt: existing.minAlt || igcData.minAlt,
      // Immer aus dem gerade eingelesenen Track neu gesetzt (nicht nur wenn
      // leer) — siehe Begründung bei Max.Steigen/-20s/Max.Sinken oben.
      maxSpeedKmh: igcData.maxSpeedKmh,
      thermalBest: igcData.thermalBest,
      startPt: existing.startPt || igcData.startPt,
      endPt: existing.endPt || igcData.endPt,
      startAlt: existing.startAlt || igcData.startAlt,
      endAlt: existing.endAlt || igcData.endAlt,
      durationSec: igcData.durationSec || existing.durationSec,
      durationStr: igcData.durationStr || existing.durationStr,
      startTime: (existing.startTime || "").trim() ? existing.startTime : igcData.startTime,
      endTime: (existing.endTime || "").trim() ? existing.endTime : igcData.endTime,
      totalDist: backfill.totalDist != null ? backfill.totalDist : existing.totalDist
    };
    await saveFlight(updated);
    await storeRawIgcFile(updated.id, file);
    setFlights((prev) => prev.map((f) => f.id === updated.id ? updated : f));
    if (selected?.id === updated.id) setSelected(updated);
  }, [selected, saveFlight, flights, placeMatchRadiusKm, mapTilerKey, resolveSchirmForGlider]);
  const runImportLoop = useCallback(async (parsedList, overrideMap) => {
    const newFlights = [];
    let updatedCount = 0;
    const dateAmbiguous = [];
    let maxNr = flights.reduce((m, f) => {
      const n = /^\d+$/.test(f.name || "") ? parseInt(f.name, 10) : 0;
      return n > m ? n : m;
    }, 0);
    for (let i = 0; i < parsedList.length; i++) {
      const { file, track, date, pilot, glider, igcData, baseName } = parsedList[i];
      const existing = flights.find((f) => f.customFields?.igcFilename === baseName);
      const dateParts = date.split(".");
      let yr = "", mo = "", dateStr = date;
      if (dateParts.length === 3) {
        yr = dateParts[2];
        mo = dateParts[1];
        dateStr = date;
      }
      if (existing) {
        await attachIgcToFlight(existing, file, track, date, pilot, glider, igcData, baseName, overrideMap);
        updatedCount++;
      } else {
        const dateCandidates = flights.filter((f) => f.date === dateStr && (!f.track || f.track.length <= 1));
        if (dateCandidates.length === 1) {
          await attachIgcToFlight(dateCandidates[0], file, track, date, pilot, glider, igcData, baseName, overrideMap);
          updatedCount++;
        } else if (dateCandidates.length > 1) {
          dateAmbiguous.push({ file, date: dateStr, track, pilot, glider, igcData, candidates: dateCandidates, baseName });
        } else {
          maxNr += 1;
          const backfill = computeDistanceSpeedBackfill(0, {}, igcData.scoreDistanceKm, igcData.durationSec);
          const inferred = await inferPlaceAndCountry(igcData.startPt, igcData.endPt, flights, placeMatchRadiusKm, mapTilerKey);
          const { name: cleanedGlider, schirmId } = await resolveSchirmForGlider(glider, overrideMap);
          const newF = {
            id: `igc_${baseName}_${Date.now()}`,
            name: String(maxNr),
            pdfOnly: false,
            date: dateStr,
            rawDate: date,
            year: yr,
            month: mo,
            pilot: pilot || "",
            site: inferred.site || "",
            glider: cleanedGlider || "",
            startTime: "",
            endTime: "",
            comment: "",
            notes: "",
            track,
            customFields: {
              landung: inferred.landung || "",
              land: inferred.land || "",
              igcFilename: baseName,
              schirmId: schirmId || "",
              // Typ direkt beim Import setzen (wie beim manuellen Neuanlegen
              // eines Flugs) — vorher wurde "GS" erst beim ersten Öffnen der
              // Detailansicht gesetzt (siehe useEffect in FlightDetail), was
              // frisch importierte, noch nie geöffnete Flüge bei der Suche
              // nach Typ=GS unauffindbar machte, obwohl die Detailansicht
              // "GS" angezeigt hätte, sobald man sie geöffnet hätte.
              typ: "GS",
              typAuto: true,
              hGew: igcData.totalGain ? String(igcData.totalGain) : "",
              hDiff: igcData.hDiff ? String(igcData.hDiff) : "",
              maxSteigen: igcData.maxClimb ? String(igcData.maxClimb) : "",
              maxSteigen20: igcData.maxClimb20 ? String(igcData.maxClimb20) : "",
              maxSinken: igcData.maxSinkRate ? String(igcData.maxSinkRate) : "",
              maxSteigenBaro: igcData.maxClimbBaro != null ? String(igcData.maxClimbBaro) : "",
              spiraleMaxSinken: igcData.spiraleMaxSinken != null ? String(igcData.spiraleMaxSinken) : "",
              spiraleSinkenSchnitt: igcData.spiraleSinkenSchnitt != null ? String(igcData.spiraleSinkenSchnitt) : "",
              spiraleAnzahlKreise: igcData.spiraleAnzahlKreise != null ? String(igcData.spiraleAnzahlKreise) : "",
              spiraleHoehenabbau: igcData.spiraleHoehenabbau != null ? String(igcData.spiraleHoehenabbau) : "",
              wingoverMaxSinken: igcData.wingoverMaxSinken != null ? String(igcData.wingoverMaxSinken) : "",
              wingoverSinkenSchnitt: igcData.wingoverSinkenSchnitt != null ? String(igcData.wingoverSinkenSchnitt) : "",
              wingoverAnzahl: igcData.wingoverAnzahl != null ? String(igcData.wingoverAnzahl) : "",
              wingoverHoehenabbau: igcData.wingoverHoehenabbau != null ? String(igcData.wingoverHoehenabbau) : "",
              distKm: backfill.distKm || "",
              kmh: backfill.kmh || ""
            },
            ...igcData,
            startPt: igcData.startPt,
            endPt: igcData.endPt,
            totalDist: backfill.totalDist || 0
          };
          await saveFlight(newF);
          await storeRawIgcFile(newF.id, file);
          newFlights.push(newF);
        }
      }
      setImportProgress({ done: i + 1, total: parsedList.length });
    }
    if (newFlights.length) setFlights((prev) => [...newFlights, ...prev].sort((a, b) => parseInt((b.name || "").match(/\d+/)?.[0] || "0", 10) - parseInt((a.name || "").match(/\d+/)?.[0] || "0", 10)));
    if (dateAmbiguous.length) setPendingDateAmbiguous(dateAmbiguous);
    setIgcResult({ created: newFlights.length, updated: updatedCount, total: parsedList.length, deferred: dateAmbiguous.length });
    setTimeout(() => setIgcResult(null), 6e3);
    setImporting(false);
    setImportProgress(null);
  }, [flights, saveFlight, attachIgcToFlight, placeMatchRadiusKm, mapTilerKey, resolveSchirmForGlider]);
  const detectAndHandleNewSchirme = useCallback(async (parsedList) => {
    const schirmeList = schirmeListRef.current || [];
    const norm = (s) => (s || "").trim().toLowerCase();
    const unknown = /* @__PURE__ */ new Map();
    for (const p of parsedList) {
      const { hersteller, cleaned } = splitFirstWordAsHersteller(p.glider);
      if (!cleaned) continue;
      const key = norm(cleaned);
      if (schirmeList.some((s) => norm(s.name) === key)) continue;
      if (unknown.has(key)) continue;
      unknown.set(key, { key, raw: p.glider, name: cleaned, hersteller });
    }
    if (unknown.size) {
      pendingImportRef.current = { parsedList };
      setPendingNewSchirme([...unknown.values()]);
      setImporting(false);
      setImportProgress(null);
      return;
    }
    await runImportLoop(parsedList, null);
  }, [runImportLoop]);
  const findDateTimeDuplicate = (p) => {
    if (!p.igcData.startTime) return null;
    if (flights.some((f) => f.customFields?.igcFilename === p.baseName)) return null;
    return flights.find((f) => f.track && f.track.length > 1 && f.date === p.date && f.startTime === p.igcData.startTime) || null;
  };
  const continueImportAfterParsing = useCallback(async (parsedList) => {
    const dateDups = [];
    const nonDupList = [];
    for (const p of parsedList) {
      const existing = findDateTimeDuplicate(p);
      if (existing) dateDups.push({ item: p, existing });
      else nonDupList.push(p);
    }
    if (dateDups.length) {
      pendingImportRef.current = { nonDupList, dateDups };
      setPendingDateDups(dateDups);
      setImporting(false);
      setImportProgress(null);
      return;
    }
    await detectAndHandleNewSchirme(parsedList);
  }, [flights, detectAndHandleNewSchirme]);
  const processIGCFiles = useCallback(async (igcFiles) => {
    setImporting(true);
    setImportProgress({ done: 0, total: igcFiles.length });
    let schirmeList;
    try {
      const r = await window.storage.get(SCHIRME_KEY);
      schirmeList = r ? JSON.parse(r.value) : [];
    } catch (e) {
      console.error("Schirme-Liste laden fehlgeschlagen:", e);
      schirmeList = [];
    }
    schirmeListRef.current = schirmeList;
    const parsedList = [];
    const splitCandidates = [];
    for (const file of igcFiles) {
      const text = await file.text();
      const { track, date, pilot, glider, tzOffsetHours } = parseIGC(text);
      const baseName = file.name.replace(/\.igc$/i, "");
      const segments = detectFlightSegments(track);
      if (segments.length > 1) {
        const combinedBounds = findFlightBoundsExcludingGroundTransport(track);
        const combinedIgcData = analyzeIGC(track.slice(combinedBounds.startIdx, combinedBounds.endIdx + 1), tzOffsetHours, date);
        const segmentDetails = segments.map((seg) => {
          const segTrack = track.slice(seg.startIdx, seg.endIdx + 1);
          const innerBounds = findFlightBoundsExcludingGroundTransport(segTrack);
          const trimmedSegTrack = segTrack.slice(innerBounds.startIdx, innerBounds.endIdx + 1);
          return { track: trimmedSegTrack, igcData: analyzeIGC(trimmedSegTrack, tzOffsetHours, date) };
        });
        splitCandidates.push({ file, track, date, pilot, glider, tzOffsetHours, baseName, combinedIgcData, segments: segmentDetails });
        continue;
      }
      const igcData = analyzeIGC(trimGroundTransportTrack(track), tzOffsetHours, date);
      parsedList.push({ file, track, date, pilot, glider, igcData, baseName });
    }
    if (splitCandidates.length) {
      pendingImportRef.current = { simpleList: parsedList, splitCandidates, resolvedList: [] };
      setPendingSplitDecisions(splitCandidates);
      setImporting(false);
      setImportProgress(null);
      return;
    }
    await continueImportAfterParsing(parsedList);
  }, [continueImportAfterParsing]);
  const resolveSplitDecision = useCallback(async (choice) => {
    const pending = pendingImportRef.current;
    if (!pending || !pending.splitCandidates?.length) return;
    const [candidate, ...restCandidates] = pending.splitCandidates;
    const resolvedList = [...pending.resolvedList];
    if (choice === "split") {
      candidate.segments.forEach((seg, idx) => {
        resolvedList.push({
          file: candidate.file,
          track: seg.track,
          date: candidate.date,
          pilot: candidate.pilot,
          glider: candidate.glider,
          igcData: seg.igcData,
          baseName: `${candidate.baseName} (Teil ${idx + 1})`
        });
      });
    } else {
      resolvedList.push({
        file: candidate.file,
        track: candidate.track,
        date: candidate.date,
        pilot: candidate.pilot,
        glider: candidate.glider,
        igcData: candidate.combinedIgcData,
        baseName: candidate.baseName
      });
    }
    if (restCandidates.length) {
      pendingImportRef.current = { ...pending, splitCandidates: restCandidates, resolvedList };
      setPendingSplitDecisions(restCandidates);
      return;
    }
    const finalList = [...pending.simpleList, ...resolvedList];
    pendingImportRef.current = null;
    setPendingSplitDecisions(null);
    setImporting(true);
    setImportProgress({ done: 0, total: finalList.length });
    await continueImportAfterParsing(finalList);
  }, [continueImportAfterParsing]);
  const resolveDateDups = useCallback(async (importAnyway) => {
    const { nonDupList, dateDups } = pendingImportRef.current || { nonDupList: [], dateDups: [] };
    const parsedList = importAnyway ? [...nonDupList, ...dateDups.map((d) => d.item)] : nonDupList;
    pendingImportRef.current = null;
    setPendingDateDups(null);
    setImporting(true);
    setImportProgress({ done: 0, total: parsedList.length });
    await detectAndHandleNewSchirme(parsedList);
  }, [detectAndHandleNewSchirme]);
  const confirmNewSchirme = useCallback(async (edited) => {
    const pending = pendingNewSchirme || [];
    const norm = (s) => (s || "").trim().toLowerCase();
    let list = schirmeListRef.current || [];
    const overrideMap = /* @__PURE__ */ new Map();
    let changed = false;
    pending.forEach((item, i) => {
      const finalName = (edited[i]?.name || "").trim() || item.name;
      const finalHersteller = (edited[i]?.hersteller || "").trim();
      let entry = list.find((s) => norm(s.name) === norm(finalName));
      if (!entry) {
        entry = {
          id: `schirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${i}`,
          name: finalName,
          hersteller: finalHersteller,
          typ: "",
          letzterCheck: "",
          materialEntryId: null
        };
        list = [...list, entry];
        changed = true;
      } else if (!entry.hersteller && finalHersteller) {
        entry = { ...entry, hersteller: finalHersteller };
        list = list.map((s) => s.id === entry.id ? entry : s);
        changed = true;
      }
      overrideMap.set(item.key, { id: entry.id, name: entry.name });
    });
    schirmeListRef.current = list;
    if (changed) {
      try {
        await window.storage.set(SCHIRME_KEY, JSON.stringify(list));
        await window.storage.set("settings:backupDirty", "1");
      } catch (e) {
        console.error("Schirme-Liste speichern fehlgeschlagen:", e);
      }
    }
    setPendingNewSchirme(null);
    const { parsedList } = pendingImportRef.current || { parsedList: [] };
    pendingImportRef.current = null;
    setImporting(true);
    setImportProgress({ done: 0, total: parsedList.length });
    await runImportLoop(parsedList, overrideMap);
  }, [pendingNewSchirme, runImportLoop]);
  const cancelNewSchirme = useCallback(() => {
    pendingImportRef.current = null;
    setPendingNewSchirme(null);
  }, []);
  const importIGCFiles = useCallback(async (files) => {
    const igc = files.filter((f) => f.name.toLowerCase().endsWith(".igc"));
    if (!igc.length) return;
    await doImport(igc);
  }, [doImport]);
  const saveEdit = useCallback(async () => {
    if (!selected) return;
    const updated = {
      ...selected,
      ...editData,
      customFields: { ...selected.customFields || {}, ...editData.customFields || {} }
    };
    await saveFlight(updated);
    setFlights((prev) => prev.map((f) => f.id === updated.id ? updated : f));
    setSelected(updated);
    setView("detail");
  }, [selected, editData, saveFlight]);
  const filteredFlights = matchFlights(flightsWithRanks, filterText);
  const parseDurForList = (s) => {
    if (!s) return 0;
    const a = s.match(/(\d+):(\d{2}):(\d{2})/);
    if (a) return +a[1] * 3600 + +a[2] * 60 + +a[3];
    const b = s.match(/(\d+):(\d{2})/);
    if (b) return +b[1] * 60 + +b[2];
    const c = s.match(/(\d+)h\s*(\d+)m/);
    if (c) return +c[1] * 3600 + +c[2] * 60;
    return 0;
  };
  const getDurFlight = (f) => f.durationSec || parseDurForList(f.durationStr);
  const longestId = flights.length ? flights.reduce((a, b) => getDurFlight(a) > getDurFlight(b) ? a : b).id : null;
  const enrichedSelected = selected ? flightsWithRanks.find((f) => f.id === selected.id) || selected : null;
  if (view === "worldmap") return /* @__PURE__ */ React.createElement(WorldMapView, { flights: filteredFlights, selectedIds, onBack: () => setView("list"), mapTilerKey, allFlights: flights, setFlights, saveFlight, placeMatchRadiusKm });
  if (view === "detail" && selected && isWide) {
    return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", height: "100vh", overflow: "hidden", background: "#040e20" } }, /* @__PURE__ */ React.createElement(
      SidebarList,
      {
        flights: filterText.trim() ? filteredFlights : flights,
        selectedId: selected.id,
        longestId,
        onSelect: (f) => {
          setSelected(f);
        }
      }
    ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, height: "100vh", overflowY: "auto" } }, /* @__PURE__ */ React.createElement(
      DetailContent,
      {
        fl: enrichedSelected,
        flights: flightsWithRanks,
        navFlights: filterText.trim() ? filteredFlights : flightsWithRanks,
        customFieldDefs,
        setFlights,
        setSelected,
        setView,
        setEditData,
        saveFlight,
        showFieldEditor,
        setShowFieldEditor,
        handleSaveFields,
        confirmDelete,
        setConfirmDelete,
        returnTo,
        mapTilerKey,
        hideBackButton: true,
        isWide: true
      }
    )));
  }
  if (view === "detail" && selected) {
    return /* @__PURE__ */ React.createElement(
      DetailContent,
      {
        fl: enrichedSelected,
        flights: flightsWithRanks,
        navFlights: filterText.trim() ? filteredFlights : flightsWithRanks,
        customFieldDefs,
        setFlights,
        setSelected,
        setView,
        setEditData,
        saveFlight,
        showFieldEditor,
        setShowFieldEditor,
        handleSaveFields,
        confirmDelete,
        setConfirmDelete,
        returnTo,
        mapTilerKey,
        isWide
      }
    );
  }
  if (view === "edit" && selected) {
    const fl = selected;
    const manualFields = customFieldDefs.filter((d) => !d.formula);
    return /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 480, margin: "0 auto", padding: "0 0 32px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "calc(16px + env(safe-area-inset-top, 0px)) 16px 12px" } }, /* @__PURE__ */ React.createElement("button", { onClick: () => setView("detail"), style: { background: "none", border: "none", color: "#7dd3fc", fontSize: 22, cursor: "pointer" } }, "←"), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 800, fontSize: 17 } }, fl.name, " bearbeiten")), /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px" } }, [
      ["Name / Titel", editData.name || "", "name"],
      ["Startplatz", editData.site || "", "site"],
      ["Landeplatz", editData.customFields?.landung || "", "landung"],
      ["Schirm", editData.glider || "", "glider"]
    ].map(([l, v, k2]) => /* @__PURE__ */ React.createElement("div", { key: k2, style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, l), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: v,
        onChange: (e) => {
          if (k2 === "landung") setEditData((d) => ({ ...d, customFields: { ...d.customFields || {}, landung: e.target.value } }));
          else setEditData((d) => ({ ...d, [k2]: e.target.value }));
        },
        style: { width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14, boxSizing: "border-box" }
      }
    ))), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "Notizen"), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        value: editData.notes || "",
        onChange: (e) => setEditData((d) => ({ ...d, notes: e.target.value })),
        rows: 2,
        style: { width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 13, resize: "vertical", boxSizing: "border-box" }
      }
    )), manualFields.length > 0 && manualFields.map((f) => /* @__PURE__ */ React.createElement("div", { key: f.id, style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, f.name), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: editData.customFields?.[f.id] || "",
        onChange: (e) => setEditData((d) => ({ ...d, customFields: { ...d.customFields || {}, [f.id]: e.target.value } })),
        type: f.type === "number" ? "number" : f.type === "date" ? "date" : "text",
        style: { width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14, boxSizing: "border-box" }
      }
    ))), /* @__PURE__ */ React.createElement("button", { onClick: () => setShowFieldEditor(true), style: { width: "100%", background: "rgba(139,92,246,0.1)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.22)", borderRadius: 12, padding: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 14 } }, "⚙️ Felder verwalten"), /* @__PURE__ */ React.createElement("button", { onClick: saveEdit, style: { width: "100%", background: "linear-gradient(135deg,#0ea5e9,#0284c7)", color: "#fff", border: "none", borderRadius: 13, padding: 14, fontSize: 15, fontWeight: 800, cursor: "pointer" } }, "Speichern")), showFieldEditor && /* @__PURE__ */ React.createElement(FieldEditor, { customFieldDefs, onSave: handleSaveFields, onClose: () => setShowFieldEditor(false) }));
  }
  const headerIconButtons = [
    { key: "import", title: "Import", active: showImportMenu, onClick: () => {
      setShowImportMenu((m) => !m);
    }, icon: "📥" },
    { key: "select", title: "Auswahl", active: selectMode, onClick: () => {
      setSelectMode((m) => !m);
      setSelectedIds(/* @__PURE__ */ new Set());
      setCopyMsg("");
    }, icon: selectMode ? "✕" : "☑" },
    { key: "map", title: "Weltkarte", active: false, onClick: () => setView("worldmap"), icon: "🗺️" },
    { key: "season", title: "Saison-Rückblick (Video)", active: showSeason, onClick: () => setShowSeason(true), icon: "🎬" },
    { key: "views", title: "Gespeicherte Darstellungen", active: showViewsMenu, onClick: () => {
      setShowViewsMenu((m) => !m);
      setShowImportMenu(false);
      setViewsMode("none");
      setSavingViewName(null);
    }, icon: "💡" },
    { key: "search", title: "Suchen/Sortieren", active: searchRowOpen, onClick: () => {
      setSearchRowOpen((o) => !o);
      setShowImportMenu(false);
    }, icon: "🔍" }
  ];
  const headerTileStyle = (active, compact) => compact ? { width: 34, height: 34, flexShrink: 0, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", background: active ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${active ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: 9, color: "#fff", fontSize: 16, cursor: "pointer" } : { flex: "1 1 0", minWidth: 0, aspectRatio: "2/1", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", background: active ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${active ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.1)"}`, borderRadius: 10, color: "#fff", fontSize: 26, cursor: "pointer" };
  const addFlugBtnStyle = isLandscapePhone ? { height: 34, boxSizing: "border-box", background: "rgba(255,255,255,0.05)", color: "#e8f4fd", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, padding: "0 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 } : { background: "rgba(34,197,94,0.15)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 20, padding: "7px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
  return /* @__PURE__ */ React.createElement("div", { style: { maxWidth: isWide ? 1400 : isLandscapePhone ? "100%" : 480, margin: "0 auto", minHeight: "100vh", background: "#040e20", color: "#e8f4fd", fontFamily: "system-ui,sans-serif" } }, /* @__PURE__ */ React.createElement("input", { ref: fileRef, type: "file", accept: ".igc", multiple: true, style: { display: "none" }, onChange: (e) => importIGCFiles(Array.from(e.target.files)) }), showSeason && /* @__PURE__ */ React.createElement(SeasonVideoDialog, { flights, mapTilerKey, onClose: () => setShowSeason(false) }), /* @__PURE__ */ React.createElement("div", { style: { position: "sticky", top: 0, zIndex: 10, background: "#040e20" } }, /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: `calc(${isLandscapePhone ? 14 : 28}px + env(safe-area-inset-top, 0px)) 16px 12px`, display: "flex", alignItems: "center", gap: 8, backdropFilter: "blur(10px)" } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        window.location.href = "index.html";
      },
      title: "Zur Startseite",
      style: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "rgba(232,244,253,0.8)", cursor: "pointer", flexShrink: 0, lineHeight: 1 }
    },
    "‹"
  ), /* @__PURE__ */ React.createElement("span", { style: isLandscapePhone ? { fontWeight: 900, fontSize: 16, letterSpacing: -0.5, flexShrink: 0, whiteSpace: "nowrap" } : { fontWeight: 900, fontSize: 18, letterSpacing: -0.5, flex: 1, textAlign: "center", marginLeft: -8 } }, "✈️ Flugbuch"), isLandscapePhone && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center", flex: 1, justifyContent: "center", overflow: "hidden" } }, headerIconButtons.map((b) => /* @__PURE__ */ React.createElement("button", { key: b.key, onClick: b.onClick, title: b.title, style: headerTileStyle(b.active, true) }, b.icon))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("button", { onClick: addNewFlight, style: addFlugBtnStyle }, "+ Flug"))), !isLandscapePhone && /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 16px 0", display: "flex", gap: 8 } }, headerIconButtons.map((b) => /* @__PURE__ */ React.createElement("button", { key: b.key, onClick: b.onClick, title: b.title, style: headerTileStyle(b.active, false) }, b.icon))), showViewsMenu && /* @__PURE__ */ React.createElement("div", { style: { margin: "8px 16px 0", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 10, maxHeight: 340, overflowY: "auto" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        setSavingViewName((s) => s === null ? "" : null);
        setViewsMode("none");
      },
      title: "Speichern als…",
      style: { flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 16, cursor: "pointer", background: savingViewName !== null ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${savingViewName !== null ? "rgba(74,222,128,0.4)" : "rgba(255,255,255,0.1)"}` }
    },
    "💾"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        setViewsMode((m) => m === "move" ? "none" : "move");
        setSavingViewName(null);
      },
      title: "Verschieben",
      style: { flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 16, cursor: "pointer", background: viewsMode === "move" ? "rgba(14,165,233,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${viewsMode === "move" ? "rgba(14,165,233,0.4)" : "rgba(255,255,255,0.1)"}` }
    },
    "🔀"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        setViewsMode((m) => m === "delete" ? "none" : "delete");
        setSavingViewName(null);
      },
      title: "Löschen",
      style: { flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 16, cursor: "pointer", background: viewsMode === "delete" ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${viewsMode === "delete" ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.1)"}` }
    },
    "🗑"
  )), savingViewName !== null && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, padding: "8px 0 2px" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      value: savingViewName,
      onChange: (e) => setSavingViewName(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter") saveCurrentAsView(savingViewName);
        if (e.key === "Escape") setSavingViewName(null);
      },
      placeholder: "Name der Darstellung…",
      style: { flex: 1, minWidth: 0, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "7px 10px", color: "#e8f4fd", fontSize: 13 }
    }
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => saveCurrentAsView(savingViewName),
      style: { flexShrink: 0, background: "rgba(74,222,128,0.2)", border: "1px solid rgba(74,222,128,0.4)", borderRadius: 8, padding: "0 12px", color: "#4ade80", fontWeight: 700, cursor: "pointer" }
    },
    "✓"
  )), savedViews.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid rgba(255,255,255,0.08)", margin: "6px 0 4px" } }), savedViews.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 12px", fontSize: 12, color: "rgba(232,244,253,0.35)", fontStyle: "italic" } }, "Noch keine gespeicherten Darstellungen"), savedViews.map((v, idx) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: v.id,
      onClick: () => {
        if (viewsMode === "none") applyView(v);
      },
      style: { display: "flex", alignItems: "center", gap: 6, padding: "9px 12px", borderRadius: 8, fontSize: 13, cursor: viewsMode === "none" ? "pointer" : "default", color: "rgba(232,244,253,0.85)" }
    },
    /* @__PURE__ */ React.createElement("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, v.name),
    viewsMode === "move" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
      "button",
      {
        disabled: idx === 0,
        onClick: (e) => {
          e.stopPropagation();
          setSavedViews((prev) => {
            const n = [...prev];
            [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]];
            return n;
          });
        },
        style: { opacity: idx === 0 ? 0.3 : 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, width: 26, height: 26, color: "#e8f4fd", cursor: idx === 0 ? "default" : "pointer" }
      },
      "↑"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        disabled: idx === savedViews.length - 1,
        onClick: (e) => {
          e.stopPropagation();
          setSavedViews((prev) => {
            const n = [...prev];
            [n[idx + 1], n[idx]] = [n[idx], n[idx + 1]];
            return n;
          });
        },
        style: { opacity: idx === savedViews.length - 1 ? 0.3 : 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, width: 26, height: 26, color: "#e8f4fd", cursor: idx === savedViews.length - 1 ? "default" : "pointer" }
      },
      "↓"
    )),
    viewsMode === "delete" && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: (e) => {
          e.stopPropagation();
          setSavedViews((prev) => prev.filter((x) => x.id !== v.id));
        },
        style: { background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 6, width: 26, height: 26, color: "#f87171", cursor: "pointer" }
      },
      "✕"
    )
  ))), showImportMenu && /* @__PURE__ */ React.createElement("div", { style: { margin: "8px 16px 0", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 10, display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(
    "div",
    {
      onDragOver: (e) => {
        e.preventDefault();
        setDragOver(true);
      },
      onDragLeave: () => setDragOver(false),
      onDrop: (e) => {
        e.preventDefault();
        setDragOver(false);
        importIGCFiles(Array.from(e.dataTransfer.files));
      },
      onClick: () => {
        if (igcDirFsapiSupported) {
          igcDirHandle ? runIgcDirImport() : chooseIgcDir();
        } else fileRef.current?.click();
      },
      title: igcDirFsapiSupported ? igcDirHandle ? `Ordner „${igcDirName}" nach neuen IGC-Dateien durchsuchen (rekursiv, bereits bekannte werden übersprungen) — oder einzelne .igc-Dateien direkt hierher ziehen` : "IGC-Ordner einmalig auswählen (z.B. dein Vario-Laufwerk D:\\) — durchsucht künftig alle Unterordner automatisch. Oder einzelne .igc-Dateien direkt hierher ziehen." : "IGC-Dateien auswählen oder hierher ziehen",
      style: { flex: 1, border: `2px dashed ${dragOver ? "#fcd34d" : "rgba(245,158,11,0.25)"}`, borderRadius: 10, padding: "10px 8px", textAlign: "center", background: dragOver ? "rgba(245,158,11,0.08)" : "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, position: "relative" }
    },
    igcDirFsapiSupported && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: (e) => {
          e.stopPropagation();
          fileRef.current?.click();
        },
        title: "Einzelne(s) IGC-Datei(en) direkt über die Dateiauswahl wählen (statt Ordner-Scan)",
        style: { position: "absolute", top: 3, right: 3, width: 20, height: 20, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 6, color: "#fcd34d", fontSize: 10, cursor: "pointer" }
      },
      "📄"
    ),
    /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15 } }, "📂"),
    /* @__PURE__ */ React.createElement("div", { style: { color: dragOver ? "#fcd34d" : "rgba(252,211,77,0.5)", fontSize: 10 } }, importProgress ? `⏳ ${importProgress.done}/${importProgress.total}` : importing ? "⏳ Importiere…" : igcDirScanning ? "⏳ Suche…" : "IGC")
  )), igcDirResult && /* @__PURE__ */ React.createElement("div", { style: { margin: "8px 16px 0", background: igcDirResult.error ? "rgba(239,68,68,0.08)" : "rgba(167,139,250,0.1)", border: `1px solid ${igcDirResult.error ? "rgba(239,68,68,0.3)" : "rgba(167,139,250,0.3)"}`, borderRadius: 10, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: igcDirResult.error ? "#f87171" : "#a78bfa" } }, igcDirResult.error ? "❌ " + igcDirResult.error : `✅ ${igcDirResult.total} IGC-Dateien im Ordner · ${igcDirResult.neu} davon neu`), /* @__PURE__ */ React.createElement("button", { onClick: () => setIgcDirResult(null), style: { background: "none", border: "none", color: "rgba(167,139,250,0.5)", cursor: "pointer", fontSize: 16 } }, "✕")), igcDirHandle && showImportMenu && /* @__PURE__ */ React.createElement("div", { style: { margin: "4px 16px 0", fontSize: 11, color: "rgba(232,244,253,0.4)", display: "flex", justifyContent: "space-between", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", null, "📁 IGC-Ordner: ", igcDirName), /* @__PURE__ */ React.createElement("button", { onClick: clearIgcDir, style: { background: "none", border: "none", color: "rgba(248,113,113,0.6)", fontSize: 11, cursor: "pointer" } }, "ändern")), showCsvColumnConfig && /* @__PURE__ */ React.createElement(CsvColumnConfigModal, { columns: csvColumns, onSave: saveCsvColumns, onClose: () => setShowCsvColumnConfig(false) }), pendingSplitDecisions && pendingSplitDecisions.length > 0 && /* @__PURE__ */ React.createElement(
    SplitFlightDialog,
    {
      candidate: pendingSplitDecisions[0],
      onSplit: () => resolveSplitDecision("split"),
      onKeep: () => resolveSplitDecision("keep")
    }
  ), pendingDateDups && /* @__PURE__ */ React.createElement(
    DateDupWarningDialog,
    {
      items: pendingDateDups,
      onImportAnyway: () => resolveDateDups(true),
      onSkip: () => resolveDateDups(false)
    }
  ), pendingNewSchirme && /* @__PURE__ */ React.createElement(NewSchirmDialog, { items: pendingNewSchirme, onConfirm: confirmNewSchirme, onCancel: cancelNewSchirme }), pendingDateAmbiguous.length > 0 && /* @__PURE__ */ React.createElement(
    DateAmbiguousResolver,
    {
      item: pendingDateAmbiguous[0],
      onClose: () => setPendingDateAmbiguous((q) => q.slice(1)),
      onAssign: async (chosen) => {
        const item = pendingDateAmbiguous[0];
        await attachIgcToFlight(chosen, item.file, item.track, item.date, item.pilot, item.glider, item.igcData, item.baseName);
        setPendingDateAmbiguous((q) => q.slice(1).map((it) => ({
          ...it,
          candidates: it.candidates.filter((c) => c.id !== chosen.id)
        })));
      },
      onCreateNew: async () => {
        const item = pendingDateAmbiguous[0];
        const baseName = item.baseName || item.file.name.replace(/\.igc$/i, "");
        const dateParts = item.date.split(".");
        let yr = "", mo = "";
        if (dateParts.length === 3) {
          yr = dateParts[2];
          mo = dateParts[1];
        }
        const maxNr = flights.reduce((m, f) => {
          const n = /^\d+$/.test(f.name || "") ? parseInt(f.name, 10) : 0;
          return n > m ? n : m;
        }, 0);
        const backfill = computeDistanceSpeedBackfill(0, {}, item.igcData.scoreDistanceKm, item.igcData.durationSec);
        const inferred = await inferPlaceAndCountry(item.igcData.startPt, item.igcData.endPt, flights, placeMatchRadiusKm, mapTilerKey);
        const { name: cleanedGlider, schirmId } = await resolveSchirmForGlider(item.glider);
        const newF = {
          id: `igc_${baseName}_${Date.now()}`,
          name: String(maxNr + 1),
          pdfOnly: false,
          date: item.date,
          rawDate: item.date,
          year: yr,
          month: mo,
          pilot: item.pilot || "",
          site: inferred.site || "",
          glider: cleanedGlider || "",
          startTime: "",
          endTime: "",
          comment: "",
          notes: "",
          track: item.track,
          customFields: {
            landung: inferred.landung || "",
            land: inferred.land || "",
            igcFilename: baseName,
            schirmId: schirmId || "",
            // Siehe processIGCFiles weiter oben — Typ direkt beim Import
            // setzen statt erst beim ersten Öffnen der Detailansicht.
            typ: "GS",
            typAuto: true,
            hGew: item.igcData.totalGain ? String(item.igcData.totalGain) : "",
            hDiff: item.igcData.hDiff ? String(item.igcData.hDiff) : "",
            maxSteigen: item.igcData.maxClimb ? String(item.igcData.maxClimb) : "",
            maxSteigen20: item.igcData.maxClimb20 ? String(item.igcData.maxClimb20) : "",
            maxSinken: item.igcData.maxSinkRate ? String(item.igcData.maxSinkRate) : "",
            maxSteigenBaro: item.igcData.maxClimbBaro != null ? String(item.igcData.maxClimbBaro) : "",
            spiraleMaxSinken: item.igcData.spiraleMaxSinken != null ? String(item.igcData.spiraleMaxSinken) : "",
            spiraleSinkenSchnitt: item.igcData.spiraleSinkenSchnitt != null ? String(item.igcData.spiraleSinkenSchnitt) : "",
            spiraleAnzahlKreise: item.igcData.spiraleAnzahlKreise != null ? String(item.igcData.spiraleAnzahlKreise) : "",
            spiraleHoehenabbau: item.igcData.spiraleHoehenabbau != null ? String(item.igcData.spiraleHoehenabbau) : "",
            wingoverMaxSinken: item.igcData.wingoverMaxSinken != null ? String(item.igcData.wingoverMaxSinken) : "",
            wingoverSinkenSchnitt: item.igcData.wingoverSinkenSchnitt != null ? String(item.igcData.wingoverSinkenSchnitt) : "",
            wingoverAnzahl: item.igcData.wingoverAnzahl != null ? String(item.igcData.wingoverAnzahl) : "",
            wingoverHoehenabbau: item.igcData.wingoverHoehenabbau != null ? String(item.igcData.wingoverHoehenabbau) : "",
            distKm: backfill.distKm || "",
            kmh: backfill.kmh || ""
          },
          ...item.igcData,
          startPt: item.igcData.startPt,
          endPt: item.igcData.endPt,
          totalDist: backfill.totalDist || 0
        };
        await saveFlight(newF);
        await storeRawIgcFile(newF.id, item.file);
        setFlights((prev) => [newF, ...prev]);
        setPendingDateAmbiguous((q) => q.slice(1));
      }
    }
  ), selectMode && /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 16px 0", display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: async () => {
        if (!selectedIds.size) {
          setCopyMsg("Keine Flüge ausgewählt.");
          return;
        }
        const chosen = flights.filter((f) => selectedIds.has(f.id));
        const activeKeys = csvColumns.filter((c) => c.enabled).map((c) => c.key);
        const rowFor = (f) => buildCsvRow(f, activeKeys);
        const rows = chosen.map(rowFor).join("\r\n");
        try {
          const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const cellStyle = "font-family:Helvetica,sans-serif;font-size:10px;font-weight:normal;text-align:left;";
          const htmlTable = `<table style="${cellStyle}">` + chosen.map((f) => {
            const cols = rowFor(f).split("	");
            return "<tr>" + cols.map(
              (c, i) => i === 0 ? `<th style="${cellStyle}">${escapeHtml(c)}</th>` : `<td style="${cellStyle}">${escapeHtml(c)}</td>`
            ).join("") + "</tr>";
          }).join("") + "</table>";
          if (navigator.clipboard && window.ClipboardItem) {
            const item = new ClipboardItem({
              "text/plain": new Blob([rows], { type: "text/plain" }),
              "text/html": new Blob([htmlTable], { type: "text/html" })
            });
            await navigator.clipboard.write([item]);
          } else {
            await navigator.clipboard.writeText(rows);
          }
          setCopyMsg(`✓ ${chosen.length} Flug${chosen.length !== 1 ? "e" : ""} kopiert.`);
        } catch (e) {
          setCopyMsg("Fehler: " + e.message);
        }
      },
      title: "Auswahl kopieren",
      style: { flex: "1 1 0", minWidth: 0, boxSizing: "border-box", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 10, padding: "9px 4px", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "center" }
    },
    "📋 ",
    selectedIds.size
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setShowCsvColumnConfig(true),
      title: "Spalten für Kopieren einrichten",
      style: { flexShrink: 0, width: 40, boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "9px 4px", color: "rgba(232,244,253,0.7)", fontSize: 15, cursor: "pointer", textAlign: "center" }
    },
    "⚙️"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        if (!selectedIds.size) {
          setCopyMsg("Keine Flüge ausgewählt.");
          return;
        }
        setBulkEditOpen(true);
      },
      title: "Auswahl bearbeiten",
      style: { flex: "1 1 0", minWidth: 0, boxSizing: "border-box", background: "rgba(14,165,233,0.15)", border: "1px solid rgba(14,165,233,0.3)", borderRadius: 10, padding: "9px 4px", color: "#7dd3fc", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "center" }
    },
    "✏️ ",
    selectedIds.size
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        if (!selectedIds.size) {
          setCopyMsg("Keine Flüge ausgewählt.");
          return;
        }
        setConfirmBulkDelete(true);
      },
      title: "Auswahl löschen",
      style: { flex: "1 1 0", minWidth: 0, boxSizing: "border-box", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "9px 4px", color: "#f87171", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "center" }
    },
    "🗑 ",
    selectedIds.size
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setSelectedIds(new Set(filteredFlights.map((f) => f.id))),
      title: "Alle Flüge auswählen",
      style: { flex: "1 1 0", minWidth: 0, boxSizing: "border-box", background: "rgba(232,244,253,0.08)", border: "1px solid rgba(232,244,253,0.15)", borderRadius: 10, padding: "9px 4px", color: "#e8f4fd", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "center" }
    },
    "Alle"
  )), confirmBulkDelete && /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: () => setConfirmBulkDelete(false),
      style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 24 }
    },
    /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: (e) => e.stopPropagation(),
        style: { background: "#14253a", borderRadius: 16, padding: "20px 22px", maxWidth: 320, width: "100%", border: "1px solid rgba(255,255,255,0.1)" }
      },
      /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 700, marginBottom: 6 } }, selectedIds.size, " Flüge — was löschen?"),
      /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "rgba(232,244,253,0.6)", marginBottom: 18 } }, "Diese Aktion kann nicht rückgängig gemacht werden."),
      /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: async () => {
            const ids = [...selectedIds];
            for (const id of ids) {
              try {
                await window.storage.delete(`flight:${id}`);
              } catch {
              }
              await deleteRawIgcFile(id);
            }
            setFlights((prev) => prev.filter((f) => !selectedIds.has(f.id)));
            setCopyMsg(`✓ ${ids.length} Flug${ids.length !== 1 ? "e" : ""} gelöscht.`);
            setSelectedIds(/* @__PURE__ */ new Set());
            setConfirmBulkDelete(false);
            setSelectMode(false);
          },
          style: { background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 10, padding: "10px", color: "#f87171", fontSize: 14, fontWeight: 700, cursor: "pointer" }
        },
        "🗑 Ganze Flüge löschen"
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: async () => {
            const ids = [...selectedIds];
            let cleared = 0;
            for (const id of ids) {
              const f = flights.find((fl) => fl.id === id);
              if (f && f.track?.length > 1) {
                const upd = { ...f, track: [] };
                try {
                  await saveFlight(upd);
                  cleared++;
                } catch {
                }
                setFlights((prev) => prev.map((fl) => fl.id === id ? upd : fl));
              }
            }
            setCopyMsg(`✓ ${cleared} IGC-Track${cleared !== 1 ? "s" : ""} gelöscht (Start/Landung bleiben).`);
            setSelectedIds(/* @__PURE__ */ new Set());
            setConfirmBulkDelete(false);
            setSelectMode(false);
          },
          style: { background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "10px", color: "#fcd34d", fontSize: 14, fontWeight: 700, cursor: "pointer" }
        },
        "🛰 Nur IGC-Tracks löschen"
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => setConfirmBulkDelete(false),
          style: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }
        },
        "Abbrechen"
      ))
    )
  ), bulkEditOpen && (() => {
    const chosenCount = selectedIds.size;
    const applyBulkEdit = async () => {
      const d = bulkEditData;
      let updated = flights.map((f) => {
        if (!selectedIds.has(f.id)) return f;
        const patch = {};
        if (d.date) patch.date = d.date;
        if (d.site) patch.site = d.site;
        if (d.glider) patch.glider = d.glider;
        if (d.notes) patch.notes = d.notes;
        const cfPatch = {};
        if (d.landung) cfPatch.landung = d.landung;
        if (d.typ) {
          cfPatch.typ = d.typ;
          cfPatch.typAuto = false;
        }
        if (d.reise) cfPatch.reise = d.reise === "__CLEAR__" ? "" : d.reise;
        return { ...f, ...patch, customFields: { ...f.customFields || {}, ...cfPatch } };
      });
      if (d.date) updated = renumberAllFlights(updated);
      await Promise.all(updated.map((f, i) => {
        const before = flights[i];
        if (selectedIds.has(f.id) || f.name !== before.name) return saveFlight(f).catch(() => {
        });
        return null;
      }));
      setFlights(updated);
      setCopyMsg(`✓ ${chosenCount} Flug${chosenCount !== 1 ? "e" : ""} aktualisiert.`);
      setBulkEditOpen(false);
      setBulkEditData({});
    };
    const field = (label, key, opts) => /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, label), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: bulkEditData[key] || "",
        onChange: (e) => setBulkEditData((d) => ({ ...d, [key]: e.target.value })),
        placeholder: opts?.placeholder || "unverändert lassen",
        style: { width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14, boxSizing: "border-box" }
      }
    ));
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        onClick: () => setBulkEditOpen(false),
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 24 }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: (e) => e.stopPropagation(),
          style: { background: "#14253a", borderRadius: 16, padding: "20px 22px", maxWidth: 380, width: "100%", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh", overflowY: "auto" }
        },
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 700, marginBottom: 4 } }, chosenCount, " Flüge bearbeiten"),
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "rgba(232,244,253,0.5)", marginBottom: 16 } }, "Leer gelassene Felder bleiben unverändert. Ausgefüllte Felder werden auf alle ", chosenCount, " ausgewählten Flüge übertragen."),
        field("Datum (z.B. 24.06.2026)", "date"),
        field("Startplatz", "site"),
        field("Landeplatz", "landung"),
        field("Schirm", "glider"),
        field("Typ", "typ"),
        /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "Reise"), /* @__PURE__ */ React.createElement(
          "select",
          {
            value: bulkEditData.reise || "",
            onChange: (e) => setBulkEditData((d) => ({ ...d, reise: e.target.value })),
            style: { width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 14, boxSizing: "border-box", appearance: "none", WebkitAppearance: "none" }
          },
          /* @__PURE__ */ React.createElement("option", { value: "", style: { background: "#14253a" } }, "unverändert lassen"),
          /* @__PURE__ */ React.createElement("option", { value: "__CLEAR__", style: { background: "#14253a" } }, "Leer (keine Reise)"),
          reisenNames.map((n) => /* @__PURE__ */ React.createElement("option", { key: n, value: n, style: { background: "#14253a" } }, n))
        )),
        /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 18 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginBottom: 4 } }, "Notizen"), /* @__PURE__ */ React.createElement(
          "textarea",
          {
            value: bulkEditData.notes || "",
            onChange: (e) => setBulkEditData((d) => ({ ...d, notes: e.target.value })),
            rows: 2,
            placeholder: "unverändert lassen",
            style: { width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 13px", color: "#e8f4fd", fontSize: 13, resize: "vertical", boxSizing: "border-box" }
          }
        )),
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => {
              setBulkEditOpen(false);
              setBulkEditData({});
            },
            style: { flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }
          },
          "Abbrechen"
        ), /* @__PURE__ */ React.createElement(
          "button",
          {
            onClick: () => {
              if (bulkEditData.date) setConfirmBulkDateRenumber(true);
              else applyBulkEdit();
            },
            style: { flex: 1, background: "linear-gradient(135deg,#0ea5e9,#0284c7)", color: "#fff", border: "none", borderRadius: 10, padding: 10, fontSize: 14, fontWeight: 800, cursor: "pointer" }
          },
          "Speichern"
        ))
      ),
      confirmBulkDateRenumber && /* @__PURE__ */ React.createElement(
        "div",
        {
          onClick: () => setConfirmBulkDateRenumber(false),
          style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 210, padding: 24 }
        },
        /* @__PURE__ */ React.createElement(
          "div",
          {
            onClick: (e) => e.stopPropagation(),
            style: { background: "#14253a", borderRadius: 16, padding: "20px 22px", maxWidth: 320, width: "100%", border: "1px solid rgba(255,255,255,0.1)" }
          },
          /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 700, marginBottom: 6 } }, "⚠️ Datum ändern?"),
          /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "rgba(232,244,253,0.6)", marginBottom: 18 } }, "Das neue Datum verschiebt die ", chosenCount, " ausgewählten Flüge evtl. an eine andere Stelle in der Chronologie — dabei werden ", /* @__PURE__ */ React.createElement("b", null, "alle"), " Flugnummern neu, lückenlos durchnummeriert. Fortfahren?"),
          /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement(
            "button",
            {
              onClick: () => setConfirmBulkDateRenumber(false),
              style: { flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px", color: "#e8f4fd", fontSize: 14, cursor: "pointer" }
            },
            "Abbrechen"
          ), /* @__PURE__ */ React.createElement(
            "button",
            {
              onClick: () => {
                setConfirmBulkDateRenumber(false);
                applyBulkEdit();
              },
              style: { flex: 1, background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 10, padding: "10px", color: "#fcd34d", fontSize: 14, fontWeight: 700, cursor: "pointer" }
            },
            "Ändern"
          ))
        )
      )
    );
  })(), copyMsg && /* @__PURE__ */ React.createElement("div", { style: { padding: "6px 16px 0", fontSize: 11, color: copyMsg.startsWith("✓") ? "#4ade80" : "#f87171" } }, copyMsg), importProgress && /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, background: "rgba(10,22,40,0.92)", zIndex: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 36 } }, "⏳"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 700, color: "#e8f4fd" } }, "Speichere Flüge…"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "rgba(232,244,253,0.6)" } }, importProgress.done, " / ", importProgress.total), /* @__PURE__ */ React.createElement("div", { style: { width: 200, height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 10, overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { width: `${importProgress.total ? Math.round(importProgress.done / importProgress.total * 100) : 0}%`, height: "100%", background: "#7dd3fc", transition: "width 0.2s" } })), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "rgba(232,244,253,0.4)", marginTop: 6 } }, "Bitte Seite nicht schliessen oder neu laden")), igcResult && /* @__PURE__ */ React.createElement("div", { style: { margin: "10px 16px 0", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "#4ade80" } }, "✅ ", igcResult.created > 0 ? igcResult.created + " neu  " : "", igcResult.updated > 0 ? igcResult.updated + " aktualisiert" : "", igcResult.deferred > 0 ? "  " + igcResult.deferred + " zur Zuordnung" : "", " (", igcResult.total, " erkannt)"), /* @__PURE__ */ React.createElement("button", { onClick: () => setIgcResult(null), style: { background: "none", border: "none", color: "rgba(74,222,128,0.5)", cursor: "pointer", fontSize: 16 } }, "✕")), dupWarning && /* @__PURE__ */ React.createElement("div", { style: { margin: "10px 16px 0", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 12, padding: "12px 14px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "#fcd34d", marginBottom: 8 } }, "⚠️ Bereits vorhanden: ", dupWarning), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: async () => {
        setDupWarning(null);
        await processIGCFiles([...pendingDups.confirmed, ...pendingDups.ask]);
      },
      style: { flex: 1, background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 10, padding: "8px", color: "#fcd34d", fontSize: 12, cursor: "pointer" }
    },
    "Überschreiben"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: async () => {
        setDupWarning(null);
        if (pendingDups.confirmed.length) await processIGCFiles(pendingDups.confirmed);
      },
      style: { flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "8px", color: "rgba(232,244,253,0.6)", fontSize: 12, cursor: "pointer" }
    },
    "Überspringen"
  ))), searchRowOpen && /* @__PURE__ */ React.createElement("div", { style: { padding: "12px 16px 6px", position: "relative" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: "1 1 0", minWidth: 0, position: "relative" } }, /* @__PURE__ */ React.createElement(SearchBar, { filterText, setFilterText, knownGliders: [...new Set(flights.map((f) => f.glider).filter(Boolean))].sort() })), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setShowSortMenu((s) => !s),
      style: { flex: "1 1 0", minWidth: 0, boxSizing: "border-box", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 8px", color: "#fff", fontSize: 12, cursor: "pointer" }
    },
    /* @__PURE__ */ React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, "⇅ ", SORT_OPTIONS.find((o) => o.id === sortId)?.label || "—"),
    /* @__PURE__ */ React.createElement("span", { style: { flexShrink: 0, marginLeft: 4 } }, showSortMenu ? "▾" : "▸")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setSortDir((d) => d === "asc" ? "desc" : "asc"),
      title: sortDir === "asc" ? "Aufsteigend" : "Absteigend",
      style: { flexShrink: 0, width: 34, height: 34, boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer" }
    },
    sortDir === "asc" ? "↑" : "↓"
  )), showFilterHelp && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8, background: "rgba(125,211,252,0.07)", border: "1px solid rgba(125,211,252,0.2)", borderRadius: 10, padding: "10px 12px", fontSize: 11, lineHeight: 1.6, color: "rgba(232,244,253,0.7)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, color: "#7dd3fc", marginBottom: 4 } }, "Filter-Syntax"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, "UND"), " / ", /* @__PURE__ */ React.createElement("b", null, "ODER"), " — z.B. ", /* @__PURE__ */ React.createElement("code", null, "Fiesch ODER Rigi")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, "+wort"), " muss / ", /* @__PURE__ */ React.createElement("b", null, "-wort"), " darf nicht — z.B. ", /* @__PURE__ */ React.createElement("code", null, "2026 -tandem")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, "feld:wert"), " — ", /* @__PURE__ */ React.createElement("code", null, "site:Fiesch"), ", ", /* @__PURE__ */ React.createElement("code", null, "schirm:Wisp"), ", ", /* @__PURE__ */ React.createElement("code", null, "pilot:…")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, "feld>wert"), " / ", /* @__PURE__ */ React.createElement("b", null, "<"), " / ", /* @__PURE__ */ React.createElement("b", null, ">="), " — ", /* @__PURE__ */ React.createElement("code", null, "dauer>2"), " (h), ", /* @__PURE__ */ React.createElement("code", null, "dist>30"), " (km), ", /* @__PURE__ */ React.createElement("code", null, "höhe>3000"), " (m), ", /* @__PURE__ */ React.createElement("code", null, "jahr>2020")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4, opacity: 0.7 } }, "Kombinierbar: ", /* @__PURE__ */ React.createElement("code", null, "site:Fiesch UND dauer>2 -tandem"))), showSortMenu && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, background: "#14253a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 6, maxHeight: 280, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" } }, SORT_OPTIONS.map((o) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: o.id,
      onClick: () => {
        setSortId(o.id);
        setShowSortMenu(false);
      },
      style: { padding: "9px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer", color: o.id === sortId ? "#7dd3fc" : "rgba(232,244,253,0.75)", background: o.id === sortId ? "rgba(14,165,233,0.15)" : "transparent" }
    },
    o.label
  )))), /* @__PURE__ */ React.createElement("div", { style: { margin: "0 16px 10px" } }, showRowImport && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 10 } }, /* @__PURE__ */ React.createElement(
    "textarea",
    {
      value: rowImportText,
      onChange: (e) => setRowImportText(e.target.value),
      placeholder: "Eine oder mehrere Zeilen aus Numbers/Excel/CSV hier einfügen (eine Zeile pro Flug, gleiche Spalten wie Flugbuch-CSV)…",
      style: { width: "100%", minHeight: 90, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 8, color: "#e8f4fd", fontSize: 11, fontFamily: "monospace", boxSizing: "border-box", resize: "vertical" }
    }
  ), rowImportText.trim() && (() => {
    const rows = parseMultipleRows(rowImportText);
    if (!rows.length) return null;
    const okCount = rows.filter((r) => r.p && r.p._colCount >= 40).length;
    const badCount = rows.length - okCount;
    return /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, fontSize: 10, lineHeight: 1.6 } }, /* @__PURE__ */ React.createElement("div", { style: { color: okCount > 0 ? "rgba(74,222,128,0.8)" : "rgba(248,113,113,0.8)" } }, rows.length, " Zeile", rows.length !== 1 ? "n" : "", " erkannt · ", okCount, " gültig", badCount > 0 ? ` · ${badCount} fehlerhaft` : ""), rows.map((r, i) => {
      const ok = r.p && r.p._colCount >= 40;
      return /* @__PURE__ */ React.createElement("div", { key: i, style: { color: ok ? "rgba(232,244,253,0.4)" : "rgba(248,113,113,0.7)" } }, "Zeile ", i + 1, ": ", ok ? `✓ Flug ${r.p._nr || "(auto)"} — ${r.p.st || "—"}` : `✗ ${r.error || (r.p ? r.p._colCount + " Spalten (erwartet ≥40)" : "Fehler")}`);
    }));
  })(), rowImportError && /* @__PURE__ */ React.createElement("div", { style: { color: "#f87171", fontSize: 11, marginTop: 6 } }, rowImportError), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        if (!rowImportText.trim()) {
          setRowImportError("Bitte mindestens eine Zeile einfügen.");
          return;
        }
        const rows = parseMultipleRows(rowImportText);
        const valid = rows.filter((r) => r.p && r.p._colCount >= 40);
        if (!valid.length) {
          setRowImportError("Keine gültige Zeile gefunden. Bitte die komplette(n) Zeile(n) mit allen Spalten einfügen, inkl. leerer Zellen.");
          return;
        }
        try {
          let maxNr = flights.reduce((m, f) => {
            const n = parseInt((f.name || "").match(/\d+/)?.[0] || "0", 10);
            return n > m ? n : m;
          }, 0);
          const newFlights = [];
          for (const r of valid) {
            const parsedNr = parseInt((r.p._nr || "").match(/\d+/)?.[0] || "", 10);
            let nr;
            if (parsedNr) {
              nr = String(parsedNr);
            } else {
              maxNr += 1;
              nr = String(maxNr);
            }
            const nf = createFlightFromPDF(nr, r.p);
            saveFlight(nf);
            newFlights.push(nf);
          }
          setFlights((prev) => {
            const merged = [...newFlights, ...prev];
            return merged.sort((a, b) => parseInt((b.name || "").match(/\d+/)?.[0] || "0", 10) - parseInt((a.name || "").match(/\d+/)?.[0] || "0", 10));
          });
          setRowImportText("");
          setRowImportError("");
          setShowRowImport(false);
          if (newFlights.length === 1) {
            setSelected(newFlights[0]);
            setView("detail");
          }
        } catch (e) {
          setRowImportError("Fehler beim Verarbeiten: " + e.message);
        }
      },
      style: { marginTop: 8, width: "100%", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 8, padding: "8px", color: "#4ade80", fontSize: 13, fontWeight: 700, cursor: "pointer" }
    },
    "+ Flüge aus Zeile(n) erstellen"
  )))), filterText.trim() && /* @__PURE__ */ React.createElement("div", { style: { padding: "0 16px 8px", fontSize: 12, color: "rgba(232,244,253,0.45)" } }, filteredFlights.length, " Treffer"), /* @__PURE__ */ React.createElement("div", { style: { padding: "4px 0 16px" } }, flights.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "60px 20px", color: "rgba(232,244,253,0.25)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 48, marginBottom: 12 } }, "✈️"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 600, marginBottom: 6 } }, "Noch keine Flüge"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13 } }, "CSV importieren oder IGC-Dateien ablegen")), sortFlights(filteredFlights, sortId, sortDir).map((f) => /* @__PURE__ */ React.createElement(
    FlightRow,
    {
      key: f.id,
      f,
      isLongest: f.id === longestId,
      sortId,
      selectMode,
      isSelected: selectedIds.has(f.id),
      onToggleSelect: (id) => setSelectedIds((prev) => {
        const n = new Set(prev);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      }),
      onClick: () => {
        listScrollRef.current = window.scrollY;
        setSelected(f);
        setView("detail");
      }
    }
  ))), showFieldEditor && /* @__PURE__ */ React.createElement(FieldEditor, { customFieldDefs, onSave: handleSaveFields, onClose: () => setShowFieldEditor(false) }));
}

;window.__FLUGBUCH_APP__ = FlugbuchApp;
})(window.React, window.ReactDOM);
