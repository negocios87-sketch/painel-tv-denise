/**
 * PAINEL TV — Time Denise (Sniper / Elite / Olympus)
 * =====================================================
 * Porta pra Node.js/Vercel da lógica do calcular_abril() do Forecast
 * Dashboard (Flask/Render), restrita ao Time Denise.
 *
 * ⚠️ NÃO TESTADO CONTRA DADO REAL — fui construído lendo o código Python
 * original, sem acesso à sua API do Pipedrive nem às suas planilhas.
 * Rode com um console.log(JSON.stringify(...)) numa das etapas e compara
 * com o painel real antes de confiar no número que aparece na TV.
 *
 * Variáveis de ambiente esperadas (configura no dashboard da Vercel,
 * Project Settings → Environment Variables — NUNCA commita isso no repo):
 *   PIPE_API_KEY        (obrigatória)
 *   URL_COLAB, URL_METAS, URL_FERIADOS   (opcionais, já tem default abaixo)
 *   FILTER_DEALS, FILTER_DEALS_RV, FILTER_ACTIVITIES  (opcionais)
 */

const BASE_V1 = "https://boardacademy.pipedrive.com/api/v1";
const BASE_V2 = "https://boardacademy.pipedrive.com/api/v2";

const API_KEY = process.env.PIPE_API_KEY || "";
const FILTER_DEALS = parseInt(process.env.FILTER_DEALS || "74674", 10);
const FILTER_DEALS_RV = parseInt(process.env.FILTER_DEALS_RV || "1431880", 10);
const FILTER_ACTIVITIES = parseInt(process.env.FILTER_ACTIVITIES || "1310451", 10);

const CF_MULTIPLICADOR = "7e0e43c2734751f77be292a72527f638a850ad50";
const CF_QUALIFICADOR = "a6f13cc27c8d041f3af4091283ce0d4fe0913875";

const URL_COLAB = process.env.URL_COLAB ||
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSvwO3Ag2f2cbkVgR1pJZp6fANQcbualGKlAG50fmOljuEGKZ1gJBbSAjRdO3SomXUEVQOWnTvlfHRd/pub?gid=1782440078&single=true&output=csv";
const URL_METAS = process.env.URL_METAS ||
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSvwO3Ag2f2cbkVgR1pJZp6fANQcbualGKlAG50fmOljuEGKZ1gJBbSAjRdO3SomXUEVQOWnTvlfHRd/pub?gid=0&single=true&output=csv";
const URL_FERIADOS = process.env.URL_FERIADOS ||
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSvwO3Ag2f2cbkVgR1pJZp6fANQcbualGKlAG50fmOljuEGKZ1gJBbSAjRdO3SomXUEVQOWnTvlfHRd/pub?gid=1010928978&single=true&output=csv";

// Squads do Time Denise (raw normalizado -> display name)
const DENISE_SQUADS = { sniper: "Sniper", elite: "Elite", olympus: "Olympus", mgm: "Olympus" };
const MARCO_ATINGIMENTO = 40.0; // checkpoint fixo — ajuste se for dinâmico

// ── HELPERS ──────────────────────────────────────────────────
function norm(s) {
  if (!s) return "";
  return String(s).trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function arred(v) {
  const f = parseFloat(v);
  if (isNaN(f) || !isFinite(f)) return 0;
  return Math.round(f * 100) / 100;
}
function safeDiv(a, b) {
  const fa = parseFloat(a), fb = parseFloat(b);
  if (!fb) return 0;
  return fa / fb;
}
function ceilSafeDiv(a, b) {
  const fa = parseFloat(a), fb = parseFloat(b);
  if (!fb) return 0;
  return Math.ceil(fa / fb);
}
function cf(deal, key) {
  const val = deal[key];
  if (val === null || val === undefined) return null;
  if (typeof val === "object") return val.value ?? val.label ?? null;
  return val;
}
function getOwnerName(deal) {
  const uid = deal.user_id;
  if (uid && typeof uid === "object") return uid.name || "";
  return "";
}
function getOwnerId(deal) {
  const uid = deal.user_id;
  if (uid && typeof uid === "object") return uid.id;
  return uid;
}
function hojeBRTStr() {
  // Aproximação BRT = UTC-3 (Brasil não observa horário de verão atualmente)
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return brt.toISOString().slice(0, 10);
}

function wonTimeBR(deal) {
  const wt = deal.won_time;
  if (!wt) return "";
  try {
    const dt = new Date(String(wt).replace(" ", "T") + (String(wt).endsWith("Z") ? "" : "Z"));
    dt.setHours(dt.getHours() - 3);
    return dt.toISOString().slice(0, 19).replace("T", " ");
  } catch { return String(wt); }
}

function parseCSV(text) {
  // Parser simples com suporte a campos entre aspas (Google Sheets CSV export)
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(v => v !== "")).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx].trim() : ""; });
    return obj;
  });
}

async function fetchSheet(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Falha ao ler planilha (${resp.status}): ${url}`);
  const text = await resp.text();
  return parseCSV(text);
}

function toNumMoney(v) {
  if (v === null || v === undefined || v === "") return 0;
  try {
    return parseFloat(String(v).replace("R$", "").replace(/\./g, "").replace(",", ".").trim()) || 0;
  } catch { return 0; }
}

// ── DATAS / DIAS ÚTEIS ───────────────────────────────────────
function daysInMonth(ano, mes) { return new Date(ano, mes, 0).getDate(); }
function isWeekday(d) { const wd = d.getDay(); return wd !== 0 && wd !== 6; }
function ymd(d) { return d.toISOString().slice(0, 10); }

function duMesTotal(ano, mes, feriadosSet) {
  const total = daysInMonth(ano, mes);
  let count = 0;
  for (let d = 1; d <= total; d++) {
    const dt = new Date(Date.UTC(ano, mes - 1, d));
    if (isWeekday(dt) && !feriadosSet.has(ymd(dt))) count++;
  }
  return count;
}
function duPassados(ano, mes, feriadosSet) {
  const hoje = new Date();
  const lastDay = Math.min(hoje.getUTCDate(), daysInMonth(ano, mes));
  let count = 0;
  for (let d = 1; d <= lastDay; d++) {
    const dt = new Date(Date.UTC(ano, mes - 1, d));
    if (isWeekday(dt) && !feriadosSet.has(ymd(dt))) count++;
  }
  return Math.max(count, 1);
}
function duRestantes(ano, mes, feriadosSet) {
  const hoje = new Date();
  const total = daysInMonth(ano, mes);
  let count = 0;
  for (let d = hoje.getUTCDate() + 1; d <= total; d++) {
    const dt = new Date(Date.UTC(ano, mes - 1, d));
    if (isWeekday(dt) && !feriadosSet.has(ymd(dt))) count++;
  }
  return count;
}

async function fetchFeriados() {
  try {
    const rows = await fetchSheet(URL_FERIADOS);
    const set = new Set();
    rows.forEach(r => {
      const raw = Object.values(r)[0];
      if (!raw) return;
      // tenta dd/mm/yyyy, yyyy-mm-dd
      let m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) { set.add(`${m[3]}-${m[1]}-${m[2]}`); return; }
      m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) { set.add(raw); return; }
    });
    return set;
  } catch { return new Set(); }
}

// ── PIPEDRIVE ────────────────────────────────────────────────
async function pipeGetV1(path, params) {
  const url = new URL(`${BASE_V1}${path}`);
  url.searchParams.set("api_token", API_KEY);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Pipedrive v1 ${path} falhou: ${resp.status}`);
  return resp.json();
}
async function pipeGetV2(path, params) {
  const url = new URL(`${BASE_V2}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const resp = await fetch(url, { headers: { "x-api-token": API_KEY } });
  if (!resp.ok) throw new Error(`Pipedrive v2 ${path} falhou: ${resp.status}`);
  return resp.json();
}

async function buscarUsersPipe() {
  const data = await pipeGetV1("/users", {});
  const map = {};
  (data.data || []).forEach(u => { map[u.id] = u.name; });
  return map;
}
async function buscarPipelines() {
  const data = await pipeGetV1("/pipelines", {});
  const map = {};
  (data.data || []).forEach(p => { map[p.id] = norm(p.name); });
  return map;
}
async function buscarQualIds() {
  const data = await pipeGetV1("/dealFields", {});
  for (const field of (data.data || [])) {
    if (field.key === CF_QUALIFICADOR) {
      const map = {};
      (field.options || []).forEach(opt => { map[norm(opt.label)] = String(opt.id); });
      return map;
    }
  }
  return {};
}

async function buscarDealsMes(mes, ano) {
  const mesStr = `${ano}-${String(mes).padStart(2, "0")}`;
  let todos = [], start = 0;
  while (true) {
    const data = await pipeGetV1("/deals", {
      filter_id: FILTER_DEALS, status: "won", sort: "won_time DESC",
      limit: 500, start,
    });
    const lote = data.data || [];
    let foundOlder = false;
    for (const deal of lote) {
      const wtBr = wonTimeBR(deal).slice(0, 7);
      if (wtBr === mesStr) todos.push(deal);
      else if (wtBr < mesStr) foundOlder = true;
    }
    const mais = data.additional_data?.pagination?.more_items_in_collection;
    if (!mais || !lote.length || foundOlder) break;
    start += 500;
  }
  return todos;
}

async function buscarActivitiesMes(mes, ano) {
  const mesStr = `${ano}-${String(mes).padStart(2, "0")}`;
  let todos = [], cursor = null;
  while (true) {
    const params = { filter_id: FILTER_ACTIVITIES, limit: 200 };
    if (cursor) params.cursor = cursor;
    const data = await pipeGetV2("/activities", params);
    const lote = data.data || [];
    for (const act of lote) {
      if (String(act.due_date || "").slice(0, 7) === mesStr) todos.push(act);
    }
    cursor = data.additional_data?.next_cursor;
    if (!cursor || !lote.length) break;
  }
  return todos;
}

async function buscarDealsRvMes() {
  let dealIdsValidos = new Set(), mapaOwner = {}, start = 0;
  while (true) {
    const data = await pipeGetV1("/deals", {
      filter_id: FILTER_DEALS_RV, status: "all_not_deleted", limit: 500, start,
    });
    const lote = data.data || [];
    for (const d of lote) {
      dealIdsValidos.add(d.id);
      const uid = d.user_id;
      mapaOwner[d.id] = uid && typeof uid === "object" ? uid.id : uid;
    }
    const mais = data.additional_data?.pagination?.more_items_in_collection;
    if (!mais || !lote.length) break;
    start += 500;
  }
  return { dealIdsValidos, mapaOwner };
}

// ── PLANILHAS ────────────────────────────────────────────────
async function buscarColaboradores(mes, ano) {
  const rows = await fetchSheet(URL_COLAB);
  if (!rows.length) return [];
  const mesCol = Object.keys(rows[0]).find(c => norm(c).includes("mes") && norm(c).includes("ref"));
  const anoCol = Object.keys(rows[0]).find(c => norm(c).includes("ano") && norm(c).includes("ref"));
  let filtered = rows;
  if (mesCol && anoCol) {
    filtered = rows.filter(r => parseInt(r[mesCol]) === mes && parseInt(r[anoCol]) === ano);
    if (!filtered.length) filtered = rows; // fallback igual ao Python
  }
  const statusCol = Object.keys(rows[0]).find(c => norm(c).includes("status"));
  if (statusCol) filtered = filtered.filter(r => norm(r[statusCol]) === "ativo");
  return filtered;
}

async function buscarMetasTodas(ano, mes) {
  const rows = await fetchSheet(URL_METAS);
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const colAno = cols.find(c => norm(c) === "ano");
  const colMes = cols.find(c => norm(c) === "mes");
  const colNome = cols.find(c => norm(c) === "nome");
  const colReu = cols.find(c => norm(c).includes("reuni") && norm(c).includes("meta"));
  const colFin = cols.find(c => norm(c).includes("financ"));
  const colDu = cols.find(c => norm(c).includes("util"));
  const out = [];
  for (const row of rows) {
    const a = parseInt(row[colAno]), m = parseInt(row[colMes]);
    if (a !== ano || m !== mes) continue;
    const nomeRaw = (row[colNome] || "").trim();
    out.push({
      nome: nomeRaw, nome_norm: norm(nomeRaw),
      meta_reu: colReu ? toNumMoney(row[colReu]) : 0,
      meta_fin: colFin ? toNumMoney(row[colFin]) : 0,
      dias_uteis: colDu ? (parseInt(row[colDu]) || 0) : 0,
    });
  }
  return out;
}

// ── MONTAGEM PRINCIPAL ───────────────────────────────────────
function buildCloserRow(nome, meta, real, realMulti, qtd, duTotal, duPass, duRest) {
  const mtd = duTotal ? safeDiv(meta, duTotal) * duPass : 0;
  return {
    nome, meta: arred(meta),
    meta_du: arred(safeDiv(meta, duTotal)),
    realizado: arred(real),
    realizado_multi: arred(realMulti),
    pct_atingido_multi: arred(safeDiv(realMulti, meta) * 100),
    meta_dia_multi: duRest ? arred(safeDiv(meta - realMulti, duRest)) : 0,
    qtd_ganhos: qtd,
  };
}

export default async function handler(req, res) {
  try {
    if (!API_KEY) {
      return res.status(500).json({ erro: "PIPE_API_KEY não configurada nas env vars da Vercel." });
    }
    const hoje = new Date();
    const mes = parseInt(req.query.mes) || (hoje.getUTCMonth() + 1);
    const ano = parseInt(req.query.ano) || hoje.getUTCFullYear();

    const feriados = await fetchFeriados();
    const duTotal = duMesTotal(ano, mes, feriados);
    const duPass = duPassados(ano, mes, feriados);
    const duRest = duRestantes(ano, mes, feriados);

    const [colabRows, metas, usersPipe, pipes, qualIds, deals, activities, rv] = await Promise.all([
      buscarColaboradores(mes, ano),
      buscarMetasTodas(ano, mes),
      buscarUsersPipe(),
      buscarPipelines(),
      buscarQualIds(),
      buscarDealsMes(mes, ano),
      buscarActivitiesMes(mes, ano),
      buscarDealsRvMes(),
    ]);
    const { dealIdsValidos, mapaOwner } = rv;

    if (!colabRows.length || !metas.length) {
      return res.status(200).json({
        aviso: "Sem dados de colaboradores ou metas para este mês — provavelmente a planilha ainda não foi preenchida.",
        squads: [], top_closers: [], top_sdrs: [],
        periodo: { data: hoje.toLocaleDateString("pt-BR"), du_dec: duPass, du_rest: duRest, du_total: duTotal },
      });
    }

    const colCols = Object.keys(colabRows[0]);
    const subCol = colCols.find(c => norm(c) === "subarea");
    const nomeCol = colCols.find(c => norm(c) === "nome") || "Nome";
    const headCol = colCols.find(c => norm(c).includes("head"));

    const nomeToSub = {}, nomeToHead = {};
    colabRows.forEach(r => {
      const nn = norm(r[nomeCol]);
      nomeToSub[nn] = subCol ? (r[subCol] || "").trim() : "";
      nomeToHead[nn] = headCol ? norm(r[headCol]) : "";
    });

    const uidToNorm = {}, nomeNormToUid = {};
    Object.entries(usersPipe).forEach(([uid, name]) => {
      uidToNorm[uid] = norm(name);
      nomeNormToUid[norm(name)] = uid;
    });

    function squadPorFunil(deal) {
      const ownerNn = norm(getOwnerName(deal));
      if (ownerNn !== "denise mussolin") return null;
      const pipeNorm = pipes[deal.pipeline_id] || "";
      return DENISE_SQUADS[pipeNorm] || null;
    }

    // Realizado por owner (com multiplicador) + distribuição da Denise por funil
    // Duas agregações: MÊS INTEIRO (pra ranking/% atingimento mensal) e HOJE
    // (pra "quanto vendeu hoje", literal, calendário — confirmado com o Rodrigo)
    const hojeStr = hojeBRTStr();
    const dealsHoje = deals.filter(d => wonTimeBR(d).slice(0, 10) === hojeStr);

    function agregarDeals(listaDeals) {
      const closerReal = {};
      const denisePorSquad = {};
      listaDeals.forEach(deal => {
        let ownerNn = norm(getOwnerName(deal));
        if (!ownerNn) ownerNn = uidToNorm[getOwnerId(deal)] || "";
        if (!ownerNn) return;
        const valor = parseFloat(deal.value) || 0;
        const valorMulti = parseFloat(cf(deal, CF_MULTIPLICADOR)) || 0;
        const squadFunil = squadPorFunil(deal);
        if (squadFunil) {
          denisePorSquad[squadFunil] = denisePorSquad[squadFunil] || { valor: 0, valorMulti: 0, qtd: 0 };
          denisePorSquad[squadFunil].valor += valor;
          denisePorSquad[squadFunil].valorMulti += valorMulti;
          denisePorSquad[squadFunil].qtd += 1;
        } else {
          closerReal[ownerNn] = closerReal[ownerNn] || { valor: 0, valorMulti: 0, qtd: 0 };
          closerReal[ownerNn].valor += valor;
          closerReal[ownerNn].valorMulti += valorMulti;
          closerReal[ownerNn].qtd += 1;
        }
      });
      return { closerReal, denisePorSquad };
    }

    const { closerReal, denisePorSquad } = agregarDeals(deals);
    const { closerReal: closerRealHoje, denisePorSquad: denisePorSquadHoje } = agregarDeals(dealsHoje);

    // Validação de reunião (mesma regra do act_valida do Python)
    function actValida(act) {
      if (!(act.done === true || act.status === "done")) return false;
      const dealId = act.deal_id;
      const actOwner = String(act.owner_id || "");
      const dealOwner = dealId ? String(mapaOwner[dealId] || "") : "";
      if (actOwner && dealOwner && actOwner === dealOwner) return false;
      if (dealId && !dealIdsValidos.has(dealId)) return false;
      return true;
    }
    const actsByOwner = {};
    activities.forEach(act => {
      const oid = String(act.owner_id || "");
      actsByOwner[oid] = actsByOwner[oid] || [];
      actsByOwner[oid].push(act);
    });

    const PESO_REU = (ano > 2026 || (ano === 2026 && mes >= 5)) ? 0.70 : 0.50;
    const PESO_FIN = 1 - PESO_REU;

    // Monta squads: Sniper, Elite, Olympus
    const squadsOut = { Sniper: { closers: [], sdrs: [] }, Elite: { closers: [], sdrs: [] }, Olympus: { closers: [], sdrs: [] } };

    const closersMetas = metas.filter(m => m.meta_reu === 0 && m.meta_fin > 0);
    const sdrsMetas = metas.filter(m => m.meta_reu > 0 && m.meta_fin > 0);

    closersMetas.forEach(m => {
      const sub = nomeToSub[m.nome_norm] || "";
      const display = DENISE_SQUADS[norm(sub)];
      if (!display) return;
      const ri = closerReal[m.nome_norm] || { valor: 0, valorMulti: 0, qtd: 0 };
      const row = buildCloserRow(m.nome, m.meta_fin, ri.valor, ri.valorMulti, ri.qtd, duTotal, duPass, duRest);
      row.real_hoje = arred((closerRealHoje[m.nome_norm] || { valorMulti: 0 }).valorMulti);
      squadsOut[display].closers.push(row);
    });

    // Heads que vendem mas não têm meta de closer explícita (meta=0, só soma no total)
    Object.entries(usersPipe).forEach(([uid, uname]) => {
      const nn = norm(uname);
      const ownSub = nomeToSub[nn] || "";
      const display = DENISE_SQUADS[norm(ownSub)];
      if (!display) return;
      if (!closerReal[nn]) return;
      const isHeadOf = nomeToHead[nn] === nn;
      if (!isHeadOf) return;
      const already = squadsOut[display].closers.some(c => norm(c.nome) === nn);
      if (already) return;
      const ri = closerReal[nn];
      const row = buildCloserRow(uname, 0, ri.valor, ri.valorMulti, ri.qtd, duTotal, duPass, duRest);
      row.real_hoje = arred((closerRealHoje[nn] || { valorMulti: 0 }).valorMulti);
      squadsOut[display].closers.push(row);
    });

    // Injeta vendas da Denise (distribuídas por funil) como linha virtual, meta=0
    Object.entries(denisePorSquad).forEach(([display, di]) => {
      if (!squadsOut[display]) return;
      const row = buildCloserRow("Denise Mussolin*", 0, di.valor, di.valorMulti, di.qtd, duTotal, duPass, duRest);
      row.real_hoje = arred((denisePorSquadHoje[display] || { valorMulti: 0 }).valorMulti);
      squadsOut[display].closers.push(row);
    });

    sdrsMetas.forEach(m => {
      const sub = nomeToSub[m.nome_norm] || "";
      const display = DENISE_SQUADS[norm(sub)];
      if (!display) return;
      const uid = nomeNormToUid[m.nome_norm];
      const acts = uid ? (actsByOwner[String(uid)] || []) : [];
      const validadas = acts.filter(actValida).length;
      const validadasHoje = acts.filter(a => String(a.due_date || "").slice(0, 10) === hojeStr && actValida(a)).length;
      const qualId = qualIds[m.nome_norm];
      const dealsSdr = qualId ? deals.filter(d => String(cf(d, CF_QUALIFICADOR)) === String(qualId)) : [];
      const valorMulti = dealsSdr.reduce((s, d) => s + (parseFloat(cf(d, CF_MULTIPLICADOR)) || 0), 0);
      const pctReu = arred(safeDiv(validadas, m.meta_reu) * 100);
      const pctGanhos = arred(safeDiv(valorMulti, m.meta_fin) * 100);
      const pctFinal = arred(pctReu * PESO_REU + pctGanhos * PESO_FIN);
      squadsOut[display].sdrs.push({
        nome: m.nome,
        lider: "", // não crítico pro painel — adicionar se precisar mapear team leader
        meta_diaria: ceilSafeDiv(m.meta_reu, duTotal),
        meta_reuniao: arred(m.meta_reu),
        validadas,
        validadas_hoje: validadasHoje,
        pct_final: pctFinal,
      });
    });

    // ── Monta cards de squad ──────────────────────────────
    function totalCloser(ind) {
      if (!ind.length) return null;
      const tMeta = ind.reduce((s, c) => s + c.meta, 0);
      const tReal = ind.reduce((s, c) => s + c.realizado, 0);
      const tMulti = ind.reduce((s, c) => s + c.realizado_multi, 0);
      const tQtd = ind.reduce((s, c) => s + c.qtd_ganhos, 0);
      const tHoje = ind.reduce((s, c) => s + (c.real_hoje || 0), 0);
      const row = buildCloserRow("TOTAL", tMeta, tReal, tMulti, tQtd, duTotal, duPass, duRest);
      row.real_hoje = arred(tHoje);
      return row;
    }
    function totalSdr(ind) {
      if (!ind.length) return null;
      const tReu = ind.reduce((s, c) => s + c.meta_reuniao, 0);
      const tVal = ind.reduce((s, c) => s + c.validadas, 0);
      const tValHoje = ind.reduce((s, c) => s + (c.validadas_hoje || 0), 0);
      // Média ponderada do % final pela meta de reunião de cada SDR
      const pesoTotal = ind.reduce((s, c) => s + (c.meta_reuniao || 0), 0);
      const pctFinalMedio = pesoTotal
        ? arred(ind.reduce((s, c) => s + c.pct_final * (c.meta_reuniao || 0), 0) / pesoTotal)
        : arred(ind.reduce((s, c) => s + c.pct_final, 0) / ind.length);
      return {
        meta_diaria: ceilSafeDiv(tReu, duTotal),
        validadas: tVal,
        validadas_hoje: tValHoje,
        pct_final: pctFinalMedio,
      };
    }

    const squadsCards = [];
    let totalRealizadoHoje = 0, totalMetaDu = 0, totalMetaDiaMulti = 0;
    let totalReuMetaDiaria = 0, totalReuValidadasHoje = 0;

    for (const nome of ["Sniper", "Elite", "Olympus"]) {
      const sq = squadsOut[nome];
      const tc = totalCloser(sq.closers);
      const ts = totalSdr(sq.sdrs);
      if (tc) {
        totalRealizadoHoje += tc.real_hoje;
        totalMetaDu += tc.meta_du;
        totalMetaDiaMulti += tc.meta_dia_multi;
      }
      if (ts) {
        totalReuMetaDiaria += ts.meta_diaria;
        totalReuValidadasHoje += ts.validadas_hoje;
      }
      const realHojeSq = tc ? tc.real_hoje : 0;

      if (tc) {
        // Squad com meta de closer (Elite/Olympus) — métricas em R$
        squadsCards.push({
          nome, tipo: "financeiro",
          ating_pct: tc.pct_atingido_multi,
          meta_dia: tc.meta_du,
          real_dia: realHojeSq,
          gap_dia: arred(realHojeSq - tc.meta_du),
          marco_pct: arred(safeDiv(tc.pct_atingido_multi, MARCO_ATINGIMENTO) * 100),
        });
      } else if (ts) {
        // Squad 100% SDR (Sniper) — não tem meta de closer, então usa reuniões.
        // Isso é o que resolve o card zerado: antes ele só olhava pra R$, que
        // pro Sniper nunca vai existir.
        squadsCards.push({
          nome, tipo: "reunioes",
          ating_pct: ts.pct_final,
          meta_dia: ts.meta_diaria,
          real_dia: ts.validadas_hoje,
          gap_dia: arred(ts.validadas_hoje - ts.meta_diaria),
          marco_pct: arred(safeDiv(ts.pct_final, MARCO_ATINGIMENTO) * 100),
        });
      } else {
        squadsCards.push({ nome, tipo: "financeiro", ating_pct: 0, meta_dia: 0, real_dia: 0, gap_dia: 0, marco_pct: 0 });
      }
    }

    const realizadoHojeClosers = arred(totalRealizadoHoje);
    const reunioesHoje = totalReuValidadasHoje;

    // ── Top 3 closers (exclui meta=0, ou seja heads e linha virtual da Denise) ──
    // Ranking continua sendo o % de atingimento MENSAL (não faz sentido rankear
    // "quem vendeu mais hoje" — um closer pode estar mal no mês e ter tido um
    // dia bom por sorte). O que muda pra "hoje literal" é só o valor mostrado
    // no badge e o delta.
    let todosClosers = [];
    for (const nome of ["Sniper", "Elite", "Olympus"]) {
      squadsOut[nome].closers.forEach(c => {
        if (c.meta <= 0) return;
        const hoje = c.real_hoje || 0;
        todosClosers.push({
          nome: c.nome, squad: nome, pct: c.pct_atingido_multi,
          meta_dia: c.meta_du, ritmo_dia: hoje,
          delta_dia: arred(hoje - c.meta_du),
        });
      });
    }
    todosClosers.sort((a, b) => b.pct - a.pct);
    const topClosers = todosClosers.slice(0, 3);

    let todosSdrs = [];
    for (const nome of ["Sniper", "Elite", "Olympus"]) {
      squadsOut[nome].sdrs.forEach(s => {
        if (s.meta_reuniao <= 0) return;
        const hojeReu = s.validadas_hoje || 0;
        todosSdrs.push({
          nome: s.nome, lider: s.lider, pct: s.pct_final,
          meta_dia: s.meta_diaria, ritmo_dia: hojeReu,
          delta_dia: arred(hojeReu - s.meta_diaria),
        });
      });
    }
    todosSdrs.sort((a, b) => b.pct - a.pct);
    const topSdrs = todosSdrs.slice(0, 3);

    const payload = {
      periodo: {
        data: hoje.toLocaleDateString("pt-BR"),
        du_dec: duPass, du_rest: duRest, du_total: duTotal,
      },
      meta_diaria_closers: arred(totalMetaDu),
      realizado_hoje_closers: realizadoHojeClosers,
      // Gap = realizado hoje - meta do dia. Negativo = abaixo da meta.
      gap_diario_simples: arred(realizadoHojeClosers - totalMetaDu),
      ritmo_necessario_100: arred(totalMetaDiaMulti),
      meta_reunioes_dia: arred(totalReuMetaDiaria),
      reunioes_hoje: reunioesHoje,
      gap_reunioes: arred(reunioesHoje - totalReuMetaDiaria),
      squads: squadsCards,
      top_closers: topClosers,
      top_sdrs: topSdrs,
      atualizado_em: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    };

    res.setHeader("Cache-Control", "s-maxage=45, stale-while-revalidate=30");
    return res.status(200).json(payload);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: err.message, stack: err.stack });
  }
}
