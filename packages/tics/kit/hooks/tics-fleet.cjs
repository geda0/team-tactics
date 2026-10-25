/* eslint-disable -- generated kit reader (CommonJS Node) */
"use strict";
// tics-fleet.js — the ADR 0030 fleet folds (stage gate, predicates, quarantine, acks, leases/registry, referee
// liveness, delegation, triage, advance), loaded lazily by tics-view.cjs, which passes its helpers in `H`.
// Read-side only: every verb folds the one bus. Zero-dep; do NOT edit (refreshed).
const fs = require("fs"), path = require("path"), cp = require("child_process");
const BROADCAST = new Set(["", "*", "fleet", "all"]);
const DISPATCH = new Set(["delegate", "handoff", "assign"]);
module.exports = function (H) {
  const now = () => H.nowMs();
  const words = (s) => String(s || "").split(/[\s,]+/).filter(Boolean);
  const gateOf = (x) => { const m = x.kind === "verdict" && x.from !== "triage" && /^gate:([\w.-]+)/.exec(x.msg || ""); return m ? m[1] : null; };
  const kvOf = (msg, k) => { const m = new RegExp("(?:^|\\s)" + k + "=(\\S+)").exec(msg || ""); return m ? m[1] : ""; };
  const last = (a) => a[a.length - 1];
  // ADR 0030 §1 (N6): STAGES="stage:role[,role] ..." -> [{stage, roles}] or {error}. `triage` never gates (§8).
  function stages(dir) {
    const raw = H.cfgStr(dir, "STAGES", "").trim();
    if (!raw) return { error: "STAGES is not declared in tdd.config" };
    const list = [];
    for (const tok of raw.split(/\s+/)) {
      const m = /^([\w.-]+):([\w.-]+(?:,[\w.-]+)*)$/.exec(tok);
      if (!m) return { error: "STAGES is malformed at '" + tok + "' (want stage:role[,role])" };
      const roles = m[2].split(",");
      if (roles.includes("triage")) return { error: "STAGES names triage as a role in '" + tok + "' — triage never gates" };
      list.push({ stage: m[1], roles });
    }
    return { list };
  }
  // Stage evidence indexed once: sha -> stage -> [{x, i}] in bus order, ONLY from the roles STAGES declares for that
  // stage (tdd-critic CONCERNS: a lane must not self-report its own mechanical green). Order within one second
  // follows the reader's (ts, seq) sort; seqs from separate hosts are advisory (ADR 0026), so a same-second tie
  // between hosts is ordered arbitrarily.
  function evidence(list, tics) {
    const roles = new Map(list.map((s) => [s.stage, new Set(s.roles)])), idx = new Map();
    tics.forEach((x, i) => {
      const st = gateOf(x);
      if (!st || !x.ref || !roles.has(st) || !roles.get(st).has(x.from)) return;
      if (!idx.has(x.ref)) idx.set(x.ref, new Map());
      const by = idx.get(x.ref);
      if (!by.has(st)) by.set(st, []);
      by.get(st).push({ x, i });
    });
    return idx;
  }
  const at = (ev, sha, stage, role) => ((ev.get(sha) || new Map()).get(stage) || []).filter((e) => !role || e.x.from === role);
  function gate(dir, all, sha) {
    if (!sha) { console.error("usage: tics gate --sha <sha>"); return 2; }
    const st = stages(dir);
    if (st.error) { console.error("Stage gate: " + st.error); return 2; }
    const tics = H.loadFor(dir, all), ev = evidence(st.list, tics), problems = [];
    for (const { stage, roles } of st.list) for (const role of roles) {
      const l = last(at(ev, sha, stage, role));
      if (!l) problems.push(stage + ": " + role + " — missing");
      else if (l.x.result !== "pass") problems.push(stage + ": " + role + " — " + (l.x.result || "no result") + " (#" + (l.x.seq || "?") + ")");
    }
    for (const q of quarantines(tics, now()).expired) problems.push("quarantine expired: " + q.ref);
    if (!problems.length) { console.log("Stage gate: CLEAR at " + sha + " — every declared stage passed."); return 0; }
    console.error("Stage gate: BLOCKED at " + sha + " — " + problems.length + " issue(s):");
    for (const p of problems) console.error("  - " + p);
    return 1;
  }
  // ADR 0030 §3 (N8): quarantine = note result=quarantine ref=<test> msg="owner=<role> until=<date> ..."; unquarantine lifts.
  function quarantines(tics, nowMs) {
    const live = new Map();
    for (const x of tics) if (x.kind === "note" && x.ref) { if (x.result === "quarantine") live.set(x.ref, x); else if (x.result === "unquarantine") live.delete(x.ref); }
    const today = new Date(nowMs).toISOString().slice(0, 10), r = { active: [], expired: [] };
    for (const [ref, x] of live) {
      const owner = kvOf(x.msg, "owner"), until = kvOf(x.msg, "until");
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(until) && new Date(until + "T00:00:00Z").toISOString().slice(0, 10) === until;
      const q = { ref, owner, until, msg: x.msg };
      if (!owner || !ok) { q.invalid = true; r.expired.push(q); } else if (until < today) r.expired.push(q); else r.active.push(q);
    }
    return r;
  }
  function quarantine(dir, all) {
    const q = quarantines(H.loadFor(dir, all), now());
    for (const x of q.active) console.log("  active   " + x.ref + "  owner=" + x.owner + " until=" + x.until);
    for (const x of q.expired) console.log("  " + (x.invalid ? "INVALID  " : "EXPIRED  ") + x.ref + "  owner=" + (x.owner || "?") + " until=" + (x.until || "?"));
    return q.expired.length ? 1 : 0;
  }
  // ADR 0030 §2 (N7): PREDICATES="requires:A:before:B kill:stage>=n kill:stage<=n" over the role-filtered evidence.
  function firings(dir, ev) {
    const out = [];
    for (const name of words(H.cfgStr(dir, "PREDICATES", ""))) {
      let m;
      if ((m = /^requires:([\w.-]+):before:([\w.-]+)$/.exec(name))) {
        for (const [sha] of ev) {
          const b = at(ev, sha, m[2])[0];
          if (b && !at(ev, sha, m[1]).some((e) => e.i < b.i && e.x.result === "pass")) out.push({ name, sha, seq: b.x.seq });
        }
      } else if ((m = /^kill:([\w.-]+)(>=|<=)(-?\d+(?:\.\d+)?)$/.exec(name))) {
        for (const [sha] of ev) {
          const l = last(at(ev, sha, m[1])), n = Number(l && l.x.result);
          if (l && String(l.x.result).trim() !== "" && isFinite(n) && (m[2] === ">=" ? n >= Number(m[3]) : n <= Number(m[3]))) out.push({ name, sha, seq: l.x.seq });
        }
      }
    }
    return out;
  }
  // `--emit <from>` goes through the real emitter (tics-lib.sh), once per firing ref (P4).
  function predicates(dir, all, emitFrom) {
    // The referee's identities stay the hooks' own (tic.sh refuses them too); a flag is never a role.
    if (emitFrom !== null && (!emitFrom || emitFrom[0] === "-" || H.HOOK_IDENTITIES.has(emitFrom))) { console.error("predicates: --emit needs a role name, not '" + emitFrom + "' (hook identities are reserved)"); return 2; }
    const st = stages(dir);
    if (st.error) { console.error("predicates: " + st.error + " (predicates read stage evidence)"); return 2; }
    const tics = H.loadFor(dir, all), fs_ = firings(dir, evidence(st.list, tics));
    for (const f of fs_) console.log("FIRES  " + f.name + "  at " + f.sha + "  (#" + f.seq + ")");
    if (emitFrom) {
      const lib = path.join(dir, ".claude", "hooks", "tics-lib.sh");
      for (const f of fs_) {
        const ref = "pred:" + f.name + ":" + f.sha;
        if (tics.some((x) => x.kind === "block" && x.ref === ref)) continue;
        const r = cp.spawnSync("bash", ["-c", '. "' + lib + '"; emit_tic "$@"', "_", emitFrom, "*", "block", "predicate " + f.name + " fired at " + f.sha + " (verdict #" + f.seq + ")", ref], { encoding: "utf8", env: Object.assign({}, process.env, { ROOT: dir }) });
        if (r.status !== 0) { console.error("predicates: emit failed: " + (r.stderr || "").trim()); return 2; }
        console.log("  block emitted: " + ref);
      }
    }
    return fs_.length ? 1 : 0;
  }
  // ADR 0030 §4 (N11): a dispatch is open until a tic FROM the addressee cites its ref (any kind), no earlier than
  // ACK_SKEW_SEC before the dispatch (hosts' clocks differ). Dispatches older than ACK_WINDOW_MIN collapse to a count
  // (dogfood: a two-day bus listed every past brief, the 0.70 trial's "board flooded by stale history"); one with no
  // parseable ts can never age, so it is reported invalid rather than left open forever.
  function dispatches(tics, nowMs, ackMin, windowMin, skewSec) {
    const r = { open: [], unacked: [], undirected: [], invalid: [], older: 0 }, cites = new Map();   // ref -> [{from, t}]
    for (const x of tics) if (x.ref) { if (!cites.has(x.ref)) cites.set(x.ref, []); cites.get(x.ref).push({ x, t: Date.parse(x.ts) }); }
    for (const d of tics) {
      if (!DISPATCH.has(d.kind) || !d.ref) continue;
      const t = Date.parse(d.ts);
      if (isNaN(t)) { r.invalid.push(d); continue; }
      const ageMin = (nowMs - t) / 60000;
      if (ageMin > windowMin) { r.older++; continue; }
      if (BROADCAST.has(d.to || "")) { r.undirected.push(d); continue; }
      if (cites.get(d.ref).some((c) => c.x !== d && c.x.from === d.to && c.t >= t - skewSec * 1000)) continue;
      (ageMin > ackMin ? r.unacked : r.open).push(Object.assign({ ageMin: Math.floor(ageMin) }, d));
    }
    return r;
  }
  const ackFold = (dir, tics) => dispatches(tics, now(), H.cfgNum(dir, "ACK_MINUTES", 10), H.cfgNum(dir, "ACK_WINDOW_MIN", 1440), H.cfgNum(dir, "ACK_SKEW_SEC", 120));
  // The board line is opt-in (ACK_MINUTES declared): every TDD install emits directed delegates to in-session
  // subagents, which never ack (tdd-critic CONCERNS; ADR 0030 dogfood finding), so a default line would nag them all.
  function unackedCount(dir, tics) { return H.cfgStr(dir, "ACK_MINUTES", "") === "" ? 0 : ackFold(dir, tics).unacked.length; }
  function acks(dir, all) {
    const d = ackFold(dir, H.loadFor(dir, all)), line = (x) => x.ref + " -> " + x.to + " from " + x.from + " (" + x.ageMin + "m)";
    if (d.older) console.log("  " + d.older + " older dispatch(es) outside ACK_WINDOW_MIN — not checked");
    for (const x of d.invalid) console.log("  invalid (no ts)  " + x.ref + " -> " + (x.to || "*") + " from " + x.from);
    for (const x of d.unacked) console.log("  UNACKNOWLEDGED  " + line(x));
    for (const x of d.open) console.log("  open            " + line(x));
    if (d.undirected.length) { console.log("  undirected — cannot be acknowledged:"); for (const x of d.undirected) console.log("    " + x.ref + " (" + x.kind + " from " + x.from + " to " + (x.to || "*") + ")"); }
    return d.unacked.length || d.invalid.length ? 1 : 0;
  }
  // ADR 0030 §5 (N4): registry = session tics carrying caps=/domain=; lease state from the claim fold.
  function declared(tics, pred) {
    let caps = "", domain = "";
    for (const x of tics) if (x.kind === "session" && pred(x)) { caps = kvOf(x.msg, "caps") || caps; domain = kvOf(x.msg, "domain") || domain; }
    return { caps, domain };
  }
  function fleet(dir, all) {
    const tics = H.loadFor(dir, all), nowMs = now(), idle = H.cfgNum(dir, "LIVENESS_IDLE_SEC", 300), stale = H.cfgNum(dir, "LIVENESS_STALE_SEC", 900);
    const ids = new Map();   // member id -> {role, last}
    for (const x of tics) { const id = H.memberId(x); if (id) ids.set(id, { role: x.from, last: x.ts || "" }); }
    const held = [...H.activeClaims(tics).values()], leased = new Set([...H.claimsFor(dir, tics).values()]);
    console.log("Fleet registry:");
    const wr = Math.max(14, ...[...ids.values()].map((m) => m.role.length + 2)), wi = Math.max(16, ...[...ids.keys()].map((k) => k.length + 2));   // long ids never run into the next column
    for (const [id, m] of ids) {
      const dc = declared(tics, (x) => H.memberId(x) === id);
      const mine = held.filter((c) => H.memberId(c) === id), claim = last(mine);
      const disp = tics.filter((x) => DISPATCH.has(x.kind) && x.to === m.role && x.ref).pop();
      const job = claim ? claim.ref : disp ? disp.ref : "-";
      const lease = !mine.length ? "-" : mine.every((c) => !leased.has(c)) ? "LAPSED" : "lease ok";
      console.log("  " + m.role.padEnd(wr) + id.padEnd(wi) + (dc.domain || "-").padEnd(10) + (dc.caps || "-").padEnd(14) + ("job " + job).padEnd(18) + H.livenessTier(m.last, nowMs, idle, stale).padEnd(8) + lease);
    }
    const lead = words(H.cfgStr(dir, "FLEET_LEAD", ""))[0], fo = words(H.cfgStr(dir, "FLEET_FAILOVER", ""))[0];
    if (lead && fo) {
      const dl = declared(tics, (x) => x.from === lead).domain, df = declared(tics, (x) => x.from === fo).domain;
      if (dl && dl === df) { console.log("SAME FAULT DOMAIN: " + lead + " and " + fo + " share " + dl + " — one usage limit takes both down"); return 1; }
    }
    return 0;
  }
  // ADR 0030 §6 (N13): armed = a hook-identity tic since .claude/state/session-started; the NEWEST hook tic's kit
  // is compared to the installed one (an older stamped tic must not vouch for a newer unstamped run).
  // A kit install (manifest present) with no session-started marker means the hooks never ran in this checkout —
  // the silent case N13 exists for (dogfood: the line was absent exactly there). A tics-only install has no referee.
  function referee(dir, tics) {
    let started, inst = null;
    try { inst = JSON.parse(fs.readFileSync(path.join(dir, ".claude", ".team-tactics", "manifest.json"), "utf8")).kitVersion || ""; } catch (e) {}
    try { started = Date.parse(fs.readFileSync(path.join(dir, ".claude", "state", "session-started"), "utf8").trim()); } catch (e) { started = NaN; }
    if (isNaN(started)) return inst === null ? null : "referee: UNARMED — no session-started marker: the hooks never ran in this checkout; greens are self-reported";
    const hook = last(tics.filter((x) => H.HOOK_IDENTITIES.has(x.from) && Date.parse(x.ts) >= started));
    if (!hook) return "referee: UNARMED — greens this session are self-reported";
    if (hook.kit && inst && hook.kit !== inst) return "referee: armed (kit " + hook.kit + ", installed " + inst + " — restart to re-arm)";
    return "referee: armed" + (hook.kit ? " (kit " + hook.kit + ")" : "");
  }
  // ADR 0030 §7 (N10): lead dispatches vs self-work; failover claims exempt; an idle owner is named to staff.
  function delegation(dir, all) {
    const leads = words(H.cfgStr(dir, "FLEET_LEAD", ""));
    if (!leads.length) return 0;
    const tics = H.loadFor(dir, all);
    for (const lead of leads) {
      // Delegation is a directed dispatch to ANOTHER role; a self-addressed one is self-work, a broadcast reaches no
      // one in particular (it cannot be acked, §4) and is counted apart (tdd-critic re-review).
      let d = 0, s = 0, b = 0; const owners = new Map(), sent = new Map();
      for (const x of tics) {
        if (DISPATCH.has(x.kind) && x.ref && x.from !== lead) sent.set(x.ref, x.to);
        if (x.from !== lead) continue;
        if (DISPATCH.has(x.kind)) {
          if (x.ref) sent.set(x.ref, x.to);
          if (BROADCAST.has(x.to || "")) b++; else if (x.to === lead) s++; else d++;
        }
        else if (x.kind === "note" || x.kind === "verdict") s++;
        else if (x.kind === "claim" && sent.has(x.ref) && sent.get(x.ref) !== lead && !/failover/i.test(x.msg || "")) { s++; owners.set(sent.get(x.ref), x.ref); }
      }
      console.log(lead.padEnd(14) + "dispatch/self " + d + "/" + s + (b ? "  (+" + b + " broadcast)" : "") + (d ? "" : "  NO DELEGATION"));
      for (const [role, ref] of owners) if (!tics.some((x) => x.from === role)) console.log("  to staff: " + role + " (owns " + ref + ", no tics)");
    }
    return 0;
  }
  // ADR 0030 §8: a triage concern is confirmed/dismissed only by TRIAGE_REVIEWERS (default tdd-critic, auditor) — the
  // drafting lane cannot clear a flag on its own work. A fresh concern after a ruling is pending again. Never gates.
  function triageFlags(dir, tics) {
    const rev = new Set(words(H.cfgStr(dir, "TRIAGE_REVIEWERS", "tdd-critic auditor"))), flags = new Map();   // ref -> flag
    for (const x of tics) {
      if (x.kind !== "verdict" || !x.ref) continue;
      if (x.from === "triage") { if (x.result === "concerns") flags.set(x.ref, { ref: x.ref, msg: x.msg, state: "pending" }); }
      else if (rev.has(x.from) && (x.result === "confirm" || x.result === "dismiss") && flags.has(x.ref)) flags.get(x.ref).state = x.result === "confirm" ? "confirmed" : "dismissed";
    }
    return flags;
  }
  function triage(dir, all) {
    const fl = [...triageFlags(dir, H.loadFor(dir, all)).values()], n = (s) => fl.filter((f) => f.state === s);
    const c = n("confirmed").length, dm = n("dismissed").length;
    console.log("triage flags: confirmed " + c + "  dismissed " + dm + "  pending " + n("pending").length + "  precision " + (c + dm ? (c / (c + dm)).toFixed(2) : "n/a"));
    for (const f of n("pending")) console.log("  pending " + f.ref + "  " + (f.msg || ""));
    return 0;
  }
  // ADR 0030 §9: AUTO-ADVANCE only when every auto stage is first-try green for every role it declares and nothing
  // else objects. The bus-wide folds (evidence, firings, triage, quarantine) are computed once per call, so
  // `--stats` stays linear in the bus (tdd-critic CONCERNS: 107 s on a 20k-tic bus before).
  function context(dir, tics) {
    const st = stages(dir);
    if (st.error) return { error: st.error };
    const auto = words(H.cfgStr(dir, "AUTO_STAGES", "")), known = st.list.map((s) => s.stage), bad = auto.filter((a) => !known.includes(a));
    if (!auto.length) return { error: "AUTO_STAGES is not declared — nothing may advance without a reviewer" };
    if (bad.length) return { error: "AUTO_STAGES names " + bad.join(", ") + " absent from STAGES" };
    const ev = evidence(st.list, tics), fires = new Map();
    for (const f of firings(dir, ev)) { if (!fires.has(f.sha)) fires.set(f.sha, []); fires.get(f.sha).push(f); }
    return { ev, fires, auto: st.list.filter((s) => auto.includes(s.stage)), flags: triageFlags(dir, tics), expired: quarantines(tics, now()).expired };
  }
  function reviewReasons(c, sha) {
    const why = [];
    for (const { stage, roles } of c.auto) for (const role of roles) {
      const v = at(c.ev, sha, stage, role), l = last(v);
      if (!l || l.x.result !== "pass") why.push(stage + ": no passing " + role + " verdict at " + sha + (l ? " (latest: " + (l.x.result || "none") + ")" : ""));
      else if (v[0].x.result !== "pass") why.push(stage + ": not first-try green for " + role + " (a failing verdict came first)");
    }
    for (const f of c.fires.get(sha) || []) why.push("predicate " + f.name + " fires (#" + f.seq + ")");
    const fl = c.flags.get(sha);
    if (fl && fl.state !== "dismissed") why.push("triage concerns " + fl.state + ": " + (fl.msg || ""));
    for (const q of c.expired) why.push("quarantine expired: " + q.ref);
    return why;
  }
  function advance(dir, all, sha, stats) {
    if (!stats && !sha) { console.error("usage: tics advance <sha> | tics advance --stats"); return 2; }
    const tics = H.loadFor(dir, all), c = context(dir, tics);
    if (c.error) { console.error("advance: " + c.error); return 2; }
    if (stats) {
      const shas = [...c.ev.keys()], adv = shas.filter((s) => !reviewReasons(c, s).length), set = new Set(adv), hit = new Set();
      // A block counts against a sha when it cites the sha itself or a predicate on it (pred:<name>:<sha>).
      for (const x of tics) if (x.kind === "block" && x.ref) { const s = x.ref.startsWith("pred:") ? x.ref.slice(x.ref.lastIndexOf(":") + 1) : x.ref; if (set.has(s)) hit.add(s); }
      const pct = (n, m) => (m ? " (" + Math.round((100 * n) / m) + "%)" : "");
      console.log("auto-advance " + adv.length + "/" + shas.length + pct(adv.length, shas.length));
      console.log("blocked after auto-advance " + hit.size + "/" + adv.length + pct(hit.size, adv.length));
      return 0;
    }
    const why = reviewReasons(c, sha);
    if (!why.length) { console.log("AUTO-ADVANCE " + sha + " — first-try green on " + c.auto.map((s) => s.stage).join(", ") + "; judgment stages still need tics gate --sha."); return 0; }
    console.log("REVIEW " + sha + ":");
    for (const w of why) console.log("  - " + w);
    return 1;
  }
  return { gate, quarantine, predicates, acks, unackedCount, fleet, referee, delegation, triage, advance };
};
