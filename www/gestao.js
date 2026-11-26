/* Gestão de vendas de areia da Morais Tavares: tabela de compra, vendas, comprovantes,
   contabilidade (receita − despesas = lucro) e planilha Excel. Tudo fica guardado no celular. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const brl = (v) => "R$ " + (Math.round((+v || 0) * 100) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf = (v) => (+v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const hoje = () => new Date().toISOString().slice(0, 10);
  const dataBR = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
  const num = (v) => { const n = parseFloat(String(v).replace(/\./g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
  const NAT = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const plug = (n) => { if (!NAT) return null; try { if (window.Capacitor.registerPlugin) return window.Capacitor.registerPlugin(n); } catch (e) {} return (window.Capacitor.Plugins || {})[n] || null; };
  const LT = plug("LerTexto"), RC = plug("Recebidos"), WE = plug("WhatsEnviar");

  /* ---------------- categorias ---------------- */
  const DESP = ["Compra de areia", "Pagamento do motorista", "Combustível", "Lanche", "Outras despesas"];
  const REC = ["Pagamento do cliente"];

  /* ---------------- tabela de compra (preço por tonelada) ---------------- */
  const TABELA_PADRAO = {
    fator: 1.2, // toneladas por m³
    fornecedores: [
      { id: "dleon", nome: "D'Leon Mineradora", contato: "Raphael (62) 99984-0858", colunas: ["À vista", "A prazo"],
        itens: [{ id: "fina", nome: "Areia fina", p: [42, 44] }, { id: "grossa", nome: "Areia grossa", p: [45, 47] }] },
      { id: "campolimpo", nome: "Brita Campo Limpo", contato: "Vigência a partir de 13/10/2026 · consumidor final e depósitos/distribuidores", colunas: ["Consumidor", "Depósito"],
        itens: [{ id: "brita0", nome: "Brita 0", p: [114, 105] }, { id: "brita1", nome: "Brita 1", p: [101, 93] }, { id: "marroada", nome: "Pedra marroada", p: [101, 93] },
          { id: "bgs", nome: "BGS", p: [105, 97] }, { id: "areia", nome: "Areia", p: [null, null] }, { id: "po", nome: "Pó de brita", p: [101, 93] }] }
    ],
    // qual areia da mineradora corresponde a cada areia vendida (fornecedor.item)
    vinculo: { "Areia média de rio": "", "Areia grossa": "dleon.grossa", "Areia fina": "dleon.fina", "Areia fina lavada": "dleon.fina", "Areia mista (saibrosa)": "" },
    coluna: 0 // 0 = à vista, 1 = a prazo
  };

  /* ---------------- armazenamento no celular (IndexedDB) ---------------- */
  let db = null;
  function abrir() {
    return new Promise((ok, erro) => {
      const r = indexedDB.open("morais-gestao", 1);
      r.onupgradeneeded = () => { const d = r.result; ["vendas", "lanc", "cfg", "orcs"].forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "id" }); }); };
      r.onsuccess = () => { db = r.result; ok(db); };
      r.onerror = () => erro(r.error);
    });
  }
  const st = (s, m) => db.transaction(s, m || "readonly").objectStore(s);
  const pr = (rq) => new Promise((ok, erro) => { rq.onsuccess = () => ok(rq.result); rq.onerror = () => erro(rq.error); });
  const todos = (s) => pr(st(s).getAll());
  const pega = (s, id) => pr(st(s).get(id));
  const poe = (s, o) => pr(st(s, "readwrite").put(o));
  const tira = (s, id) => pr(st(s, "readwrite").delete(id));
  async function cfg(chave, padrao) { const c = await pega("cfg", chave); return c ? c.v : padrao; }
  const setCfg = (chave, v) => poe("cfg", { id: chave, v });

  let TAB = JSON.parse(JSON.stringify(TABELA_PADRAO));
  let REGRAS = {}; // nome normalizado -> {tipo, cat, desc}
  let MEUS = []; // nomes da Morais/do dono que aparecem nos comprovantes

  /* ---------------- custo estimado da areia ---------------- */
  function precoT(chave, col) {
    if (!chave) return null;
    const [f, i] = chave.split(".");
    const F = TAB.fornecedores.find((x) => x.id === f); const I = F && F.itens.find((x) => x.id === i);
    if (!I) return null; const v = I.p[col == null ? TAB.coluna : col];
    return v == null || v === "" ? null : +v;
  }
  function custoAreia(itens, col) {
    let total = 0, faltou = [];
    (itens || []).filter((i) => i.k === "A").forEach((i) => {
      const p = precoT(TAB.vinculo[i.d], col);
      if (p == null) { faltou.push(i.d); return; }
      total += i.q * i.m3 * TAB.fator * p;
    });
    return { total, faltou };
  }

  /* ---------------- leitura do comprovante ---------------- */
  const ROT_DEST = /^(destino|para|recebedor|favorecido|benefici[aá]rio|quem recebeu|nome do recebedor|dados do recebedor|pago a|transferido para|enviado para|conta destino)\b/i;
  const ROT_ORIG = /^(origem|de|pagador|quem pagou|dados do pagador|remetente|enviado por|conta origem|dados de quem pagou)\b/i;
  const ROT_LIXO = /^(nome|cpf|cnpj|cpf\/cnpj|institui[cç][aã]o|banco|ag[eê]ncia|conta|chave|tipo|valor|data|hor[aá]rio|id|autentica|c[oó]digo|n[uú]mero|descri[cç][aã]o|mensagem|pix|transa[cç][aã]o)\b/i;
  function nomeDepois(linhas, i) {
    const mesma = linhas[i].replace(ROT_DEST, "").replace(ROT_ORIG, "").replace(/^[\s:\-–]+/, "").trim();
    if (mesma.length > 2 && /[a-zà-ú]{2}/i.test(mesma) && !ROT_LIXO.test(mesma)) return mesma;
    for (let j = i + 1; j < Math.min(linhas.length, i + 6); j++) {
      let l = linhas[j].trim();
      if (!l) continue;
      l = l.replace(/^nome[\s:]*/i, "").trim();
      if (!l || ROT_LIXO.test(l) || ROT_DEST.test(l) || ROT_ORIG.test(l)) continue;
      if (/^[\d\s.*\-\/()]+$/.test(l) || /\d{3}\.\d{3}|\*\*\*/.test(l)) continue;
      if (/[a-zà-ú]{2}/i.test(l)) return l;
    }
    return "";
  }
  function analisar(texto) {
    const t = String(texto || ""), linhas = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
    let valor = 0;
    const mv = t.match(/valor[^\n\d]{0,25}(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/i) || t.match(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/) || t.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
    if (mv) valor = num(mv[1]);
    let data = "";
    const md = t.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const MES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
    const mt = t.match(/(\d{1,2})\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?\s*(?:de\s+)?(\d{4})/i);
    if (md) data = `${md[3]}-${md[2]}-${md[1]}`; else if (mt) data = `${mt[3]}-${String(MES[mt[2].toLowerCase()]).padStart(2, "0")}-${mt[1].padStart(2, "0")}`;
    let dest = "", orig = "";
    linhas.forEach((l, i) => { if (!dest && ROT_DEST.test(l)) dest = nomeDepois(linhas, i); if (!orig && ROT_ORIG.test(l)) orig = nomeDepois(linhas, i); });
    const eu = (n) => n && MEUS.some((m) => norm(n).includes(m) || m.includes(norm(n)));
    let tipo = /recebid|voc[eê] recebeu|entrada|cr[eé]dito recebido/i.test(t) ? "receita" : "despesa";
    if (eu(dest)) tipo = "receita"; else if (eu(orig)) tipo = "despesa";
    const nome = tipo === "receita" ? (orig || (eu(dest) ? "" : dest)) : (dest || orig);
    return { valor, data: data || hoje(), nome: nome.replace(/\s+/g, " ").slice(0, 80), dest, orig, tipo };
  }
  const chaveNome = (n) => norm(n).replace(/\b(ltda|me|eireli|epp|s\/?a|sa)\b/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  function regraDe(nome) {
    const k = chaveNome(nome); if (!k) return null;
    if (REGRAS[k]) return REGRAS[k];
    const hit = Object.keys(REGRAS).find((r) => r.length > 4 && (k.includes(r) || r.includes(k)));
    return hit ? REGRAS[hit] : null;
  }

  /* imagens: diminui pra guardar e pra ler */
  function carregaImg(src) { return new Promise((ok, erro) => { const im = new Image(); im.onload = () => ok(im); im.onerror = erro; im.src = src; }); }
  function reduz(im, max, q) {
    const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas");
    c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", q || 0.8);
  }
  async function pdfParaTexto(bytes) {
    if (!window.pdfjsLib) return { texto: "", img: "" };
    try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js"; } catch (e) {}
    const doc = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const pg = await doc.getPage(1);
    const tc = await pg.getTextContent();
    let linhas = [], ultY = null;
    tc.items.forEach((it) => { const y = Math.round(it.transform[5]); if (ultY !== null && Math.abs(y - ultY) > 3) linhas.push("\n"); linhas.push(it.str + " "); ultY = y; });
    const vp = pg.getViewport({ scale: 1.6 }), c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    return { texto: linhas.join("").replace(/ +\n/g, "\n"), img: c.toDataURL("image/jpeg", 0.85) };
  }
  async function lerArquivo(tipo, b64) {
    // devolve {texto, mini}
    if (/pdf/i.test(tipo)) {
      const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const r = await pdfParaTexto(u);
      let texto = r.texto;
      if (texto.replace(/\s/g, "").length < 20 && r.img && LT) { try { texto = (await LT.ler({ imagem: r.img.split(",")[1] })).texto || ""; } catch (e) {} }
      let mini = ""; if (r.img) { try { mini = reduz(await carregaImg(r.img), 520, 0.7); } catch (e) {} }
      return { texto, mini };
    }
    const im = await carregaImg(`data:${tipo || "image/jpeg"};base64,${b64}`);
    const grande = reduz(im, 1800, 0.9), mini = reduz(im, 520, 0.7);
    let texto = "";
    if (LT) { try { texto = (await LT.ler({ imagem: grande.split(",")[1] })).texto || ""; } catch (e) {} }
    return { texto, mini };
  }

  /* ---------------- telas ---------------- */
  const CSS = `
  .gtabs{display:flex;gap:6px;padding:10px max(4vw,14px) 0;max-width:640px;margin:0 auto}
  .gtabs button{flex:1;min-height:44px;border-radius:12px 12px 0 0;border:1px solid var(--line);border-bottom:0;background:var(--card);color:var(--mute);font:600 15px Inter,sans-serif}
  .gtabs button[aria-selected=true]{background:var(--dark);color:var(--gold);border-color:var(--gold)}
  .gsec{max-width:640px;margin:0 auto;padding:16px max(4vw,14px) 40px}
  .gcard{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px;margin:0 0 12px}
  .gcard h2{font:700 20px/1.2 'Libre Baskerville',Georgia,serif;margin:0 0 8px}
  .gcard h3{font-size:16px;margin:14px 0 6px}
  .gnum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px}
  .gnum div{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:8px 10px}
  .gnum small{display:block;color:var(--mute);font-size:12px}.gnum b{font-size:17px;white-space:nowrap}
  .gpos{color:#1F8F4E}.gneg{color:var(--warn)}
  .gvenda{display:block;width:100%;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:0 0 8px;color:var(--ink);font:15px Inter,sans-serif}
  .gvenda .l1{display:flex;justify-content:space-between;gap:8px;font-weight:700}.gvenda .l2{color:var(--mute);font-size:13px;margin-top:2px}
  .gpill{font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid var(--line);white-space:nowrap}
  .gtab{width:100%;border-collapse:collapse;font-size:14px}.gtab td,.gtab th{padding:7px 4px;border-bottom:1px solid var(--line);text-align:left}
  .gtab td.v,.gtab th.v{text-align:right;white-space:nowrap}.gtab tr.tot td{font-weight:700;border-top:2px solid var(--gold)}
  .gtab input{min-height:40px;padding:6px 8px;text-align:right;width:76px;max-width:76px}.gsec .scroll{overflow-x:auto}
  .glanc{display:grid;grid-template-columns:54px 1fr auto;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}
  .glanc img{width:54px;height:54px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}.glanc .sem{width:54px;height:54px;border-radius:8px;background:var(--bg);border:1px dashed var(--line)}
  .glanc .c{font-size:13px;color:var(--mute)}.glanc .v{font-weight:700;white-space:nowrap;text-align:right}
  .gmodal{position:fixed;inset:0;z-index:20;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center}
  .gmodal .box{background:var(--card);color:var(--ink);width:100%;max-width:640px;max-height:92vh;overflow:auto;border-radius:20px 20px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom))}
  .gmodal img.prev{width:100%;max-height:260px;object-fit:contain;background:#fff;border-radius:10px;border:1px solid var(--line)}
  .gchips{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
  .gchips button{min-height:44px;padding:8px 12px;border-radius:12px;border:1.5px solid var(--line);background:var(--bg);color:var(--ink);font:600 14px Inter,sans-serif}
  .gchips button[aria-pressed=true]{background:var(--dark);color:var(--gold);border-color:var(--gold)}
  .gauto{font-size:13px;color:#1F8F4E;font-weight:600;margin:6px 0 0}
  .gaviso{background:#1F8F4E;color:#fff;border-radius:14px;padding:12px 14px;margin:0 0 12px;font-weight:600}
  .gest{margin-top:10px;padding:10px 12px;border-radius:12px;background:var(--bg);border:1px dashed var(--gold);font-size:14px}`;

  function montar() {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    const main = document.querySelector("main"), header = document.querySelector("header");
    const nav = document.createElement("nav"); nav.className = "gtabs"; nav.setAttribute("role", "tablist");
    nav.innerHTML = '<button type="button" role="tab" data-t="orc" aria-selected="true">Orçamento</button><button type="button" role="tab" data-t="vendas" aria-selected="false">Vendas</button><button type="button" role="tab" data-t="compra" aria-selected="false">Compra</button>';
    header.after(nav);
    const sv = document.createElement("section"); sv.className = "gsec"; sv.id = "gVendas"; sv.hidden = true; main.after(sv);
    const sc = document.createElement("section"); sc.className = "gsec"; sc.id = "gCompra"; sc.hidden = true; sv.after(sc);
    nav.addEventListener("click", (e) => { const b = e.target.closest("button[data-t]"); if (b) aba(b.dataset.t); });
    // estimativa de custo dentro do orçamento (etapa 3)
    const est = document.createElement("div"); est.className = "gest"; est.id = "gEst"; est.hidden = true;
    const fb = $("freteBox"); if (fb) fb.after(est);
  }
  let ABA = "orc";
  function aba(t) {
    ABA = t;
    document.querySelectorAll(".gtabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.t === t));
    document.querySelector("main").hidden = t !== "orc";
    const bar = document.querySelector(".bar"); if (bar) bar.hidden = t !== "orc";
    document.body.style.paddingBottom = t === "orc" ? "" : "0";
    $("gVendas").hidden = t !== "vendas"; $("gCompra").hidden = t !== "compra";
    if (t === "vendas") telaVendas(); if (t === "compra") telaCompra();
    window.scrollTo({ top: 0 });
  }

  /* ---------- contas de uma venda ---------- */
  function contas(v, ls) {
    const r = { receita: 0, desp: {}, despTotal: 0 };
    DESP.forEach((c) => (r.desp[c] = 0));
    ls.forEach((l) => { if (l.tipo === "receita") r.receita += +l.valor || 0; else { r.desp[l.cat] = (r.desp[l.cat] || 0) + (+l.valor || 0); r.despTotal += +l.valor || 0; } });
    r.temReceita = ls.some((l) => l.tipo === "receita");
    r.receitaUsada = r.temReceita ? r.receita : (+v.total || 0);
    r.lucro = r.receitaUsada - r.despTotal;
    r.est = custoAreia(v.itens);
    return r;
  }

  /* ---------- tela Vendas ---------- */
  let PEND = []; // comprovantes recebidos esperando escolher a venda
  async function telaVendas() {
    const [vendas, lanc, orcs] = await Promise.all([todos("vendas"), todos("lanc"), todos("orcs")]);
    vendas.sort((a, b) => (b.criada || "").localeCompare(a.criada || ""));
    const mes = hoje().slice(0, 7);
    let R = 0, D = 0;
    const linhas = vendas.map((v) => {
      const c = contas(v, lanc.filter((l) => l.venda === v.id));
      if ((v.data || "").slice(0, 7) === mes) { R += c.receitaUsada; D += c.despTotal; }
      const it = (v.itens || []).map((i) => i.k === "A" ? `${i.q} carga${i.q > 1 ? "s" : ""} ${i.d.toLowerCase()}` : `${nf(i.q)} tijolos ${i.d}`).join(", ");
      return `<button class="gvenda" type="button" data-v="${esc(v.id)}"><div class="l1"><span>${esc(v.cliente || "Cliente")}</span><span class="${c.lucro >= 0 ? "gpos" : "gneg"}">${brl(c.lucro)}</span></div>
        <div class="l2">${dataBR(v.data)}${v.num ? " · recibo " + esc(v.num) : ""}${v.cidade ? " · " + esc(v.cidade) : ""}</div><div class="l2">${esc(it || v.desc || "")}</div>
        <div class="l2">Receita ${brl(c.receitaUsada)}${c.temReceita ? "" : " (prevista)"} · Despesas ${brl(c.despTotal)} · <span class="gpill">${v.fechada ? "Fechada" : "Aberta"}</span></div></button>`;
    }).join("");
    const orcLs = orcs.sort((a, b) => (b.criada || "").localeCompare(a.criada || "")).slice(0, 15).map((o) =>
      `<div class="glanc" style="grid-template-columns:1fr auto"><div><b>${esc(o.cliente || "Cliente")}</b><div class="c">${dataBR(o.data)} · orçamento ${esc(o.num || "")} · ${brl(o.total)}</div></div><button class="btn alt" type="button" data-virou="${esc(o.id)}">Virou venda</button></div>`).join("");
    $("gVendas").innerHTML = `
      ${PEND.length ? `<div class="gaviso">${PEND.length} comprovante${PEND.length > 1 ? "s" : ""} recebido${PEND.length > 1 ? "s" : ""}. Toque na venda deles (ou crie uma nova).</div>` : ""}
      <div class="gcard"><h2>Este mês</h2><div class="gnum"><div><small>Receita</small><b>${brl(R)}</b></div><div><small>Despesas</small><b>${brl(D)}</b></div><div><small>Lucro</small><b class="${R - D >= 0 ? "gpos" : "gneg"}">${brl(R - D)}</b></div></div>
        <button class="btn w" type="button" id="gXlsTudo">Planilha Excel de todas as vendas</button></div>
      <button class="btn w" type="button" id="gNova" style="margin:0 0 12px">+ Nova venda</button>
      ${linhas || '<div class="gcard">Nenhuma venda ainda. Quando você mandar um <b>recibo</b> pelo app, a venda aparece aqui sozinha. Depois é só mandar os comprovantes.</div>'}
      ${orcLs ? `<div class="gcard"><h3 style="margin-top:0">Orçamentos enviados</h3>${orcLs}</div>` : ""}`;
    $("gVendas").onclick = async (e) => {
      const b = e.target.closest("[data-v]"); if (b) return abrirVenda(b.dataset.v);
      const o = e.target.closest("[data-virou]"); if (o) { const or = await pega("orcs", o.dataset.virou); if (or) { const v = { ...or, id: uid(), criada: new Date().toISOString(), data: hoje(), origem: "orcamento" }; await poe("vendas", v); await tira("orcs", or.id); abrirVenda(v.id); } return; }
      if (e.target.id === "gNova") return novaVenda();
      if (e.target.id === "gXlsTudo") return planilha(null);
    };
  }
  function novaVenda() {
    modal(`<h2 style="margin:0 0 6px">Nova venda</h2>
      <label for="nvC">Cliente</label><input id="nvC"><label for="nvD">O que foi vendido</label><input id="nvD" placeholder="Ex.: 2 cargas de areia grossa">
      <label for="nvV">Valor da venda (R$)</label><input id="nvV" type="number" inputmode="decimal">
      <button class="btn w" type="button" id="nvOk">Criar venda</button><button class="btn alt w" type="button" data-fecha>Cancelar</button>`, async (box) => {
      box.querySelector("#nvOk").onclick = async () => {
        const v = { id: uid(), criada: new Date().toISOString(), data: hoje(), cliente: box.querySelector("#nvC").value.trim(), desc: box.querySelector("#nvD").value.trim(), total: num(box.querySelector("#nvV").value), itens: [] };
        await poe("vendas", v); fechaModal(); abrirVenda(v.id);
      };
    });
  }

  /* ---------- uma venda ---------- */
  let VATUAL = null;
  async function abrirVenda(id) {
    const v = await pega("vendas", id); if (!v) return telaVendas();
    VATUAL = id;
    const ls = (await todos("lanc")).filter((l) => l.venda === id).sort((a, b) => (a.criado || "").localeCompare(b.criado || ""));
    const c = contas(v, ls);
    const it = (v.itens || []).map((i) => `<tr><td>${i.k === "A" ? `${esc(i.d)} (${i.q} carga${i.q > 1 ? "s" : ""} de ${i.m3} m³)` : `Tijolo ${esc(i.d)} (${nf(i.q)} un)`}</td><td class="v">${brl(i.k === "A" ? i.q * i.v : i.q / 1000 * i.v)}</td></tr>`).join("");
    const lanc = (tipo) => ls.filter((l) => l.tipo === tipo).map((l) => `<div class="glanc">${l.mini ? `<img src="${l.mini}" alt="">` : '<div class="sem"></div>'}
        <div><b>${esc(l.cat)}${l.desc ? " · " + esc(l.desc) : ""}</b><div class="c">${esc(l.nome || "")} · ${dataBR(l.data)}${l.auto ? " · reconhecido sozinho" : ""}</div></div>
        <div><div class="v">${brl(l.valor)}</div><button class="btn alt" type="button" data-ed="${esc(l.id)}" style="min-height:36px;padding:4px 10px;margin-top:4px">Editar</button></div></div>`).join("") || '<p class="note">Nenhum ainda.</p>';
    const est = c.est;
    $("gVendas").innerHTML = `
      <button class="btn alt" type="button" id="gVolta" style="margin-bottom:12px">‹ Vendas</button>
      ${PEND.length ? `<div class="gaviso">${PEND.length} comprovante${PEND.length > 1 ? "s" : ""} recebido${PEND.length > 1 ? "s" : ""} pra lançar aqui.<button class="btn w" type="button" id="gPend" style="background:#fff;color:#1F8F4E;border-color:#fff">Lançar nesta venda</button></div>` : ""}
      <div class="gcard"><h2>${esc(v.cliente || "Cliente")}</h2><div class="note">${dataBR(v.data)}${v.num ? " · recibo " + esc(v.num) : ""}${v.cidade ? " · " + esc(v.cidade) : ""}${v.tel ? " · " + esc(v.tel) : ""}</div>
        ${it ? `<table class="gtab" style="margin-top:8px">${it}<tr class="tot"><td>Total da venda</td><td class="v">${brl(v.total)}</td></tr></table>` : `<p>${esc(v.desc || "")} · ${brl(v.total)}</p>`}
        ${est.total ? `<div class="gest">Custo da areia na mineradora (${TAB.coluna ? "a prazo" : "à vista"}): <b>${brl(est.total)}</b>. Sobra antes do frete e do motorista: <b>${brl((+v.total || 0) - est.total)}</b>.</div>` : ""}
        ${est.faltou.length ? `<p class="note">Sem preço de compra pra: ${esc(est.faltou.join(", "))} (aba Compra).</p>` : ""}</div>
      <div class="gcard"><h2>Contas da venda</h2>
        <table class="gtab"><tr><td>Receita${c.temReceita ? "" : " (prevista, sem comprovante)"}</td><td class="v">${brl(c.receitaUsada)}</td></tr>
        ${DESP.map((d) => `<tr><td>− ${esc(d)}</td><td class="v">${brl(c.desp[d] || 0)}</td></tr>`).join("")}
        <tr><td><b>Despesa total</b></td><td class="v"><b>${brl(c.despTotal)}</b></td></tr>
        <tr class="tot"><td>Lucro líquido</td><td class="v ${c.lucro >= 0 ? "gpos" : "gneg"}">${brl(c.lucro)}</td></tr></table>
        <label class="btn w" style="cursor:pointer">Adicionar comprovantes<input type="file" id="gArq" accept="image/*,application/pdf" multiple hidden></label>
        <button class="btn alt w" type="button" id="gMao">Lançar à mão</button>
        <p class="note">Dica: no WhatsApp ou no app do banco, toque em Compartilhar no comprovante e escolha "Orçamento Morais".</p></div>
      <div class="gcard"><h3 style="margin-top:0">Receitas</h3>${lanc("receita")}<h3>Despesas</h3>${lanc("despesa")}</div>
      <button class="btn w" type="button" id="gXls">Planilha Excel desta venda</button>
      <button class="btn alt w" type="button" id="gFecha">${v.fechada ? "Reabrir venda" : "Fechar venda"}</button>
      <button class="btn alt w" type="button" id="gApaga" style="color:var(--warn)">Apagar venda</button>`;
    $("gVendas").onclick = async (e) => {
      const id2 = e.target.id;
      if (id2 === "gVolta") { VATUAL = null; return telaVendas(); }
      if (id2 === "gMao") return classificar([{ texto: "", mini: "", manual: true }], v.id);
      if (id2 === "gPend") { const p = PEND; PEND = []; return processar(p, v.id); }
      if (id2 === "gXls") return planilha(v.id);
      if (id2 === "gFecha") { v.fechada = !v.fechada; await poe("vendas", v); return abrirVenda(v.id); }
      if (id2 === "gApaga") {
        return modal(`<h2 style="margin:0 0 8px">Apagar esta venda?</h2><p>Os comprovantes dela também somem do app.</p><button class="btn w" type="button" id="gSim" style="background:var(--warn);border-color:var(--warn);color:#fff">Apagar</button><button class="btn alt w" type="button" data-fecha>Cancelar</button>`, (box) => {
          box.querySelector("#gSim").onclick = async () => { for (const l of ls) await tira("lanc", l.id); await tira("vendas", v.id); fechaModal(); VATUAL = null; telaVendas(); };
        });
      }
      const ed = e.target.closest("[data-ed]"); if (ed) { const l = ls.find((x) => x.id === ed.dataset.ed); if (l) return classificar([{ ...l, editar: true }], v.id); }
    };
    $("gArq").onchange = async (e) => {
      const fs = [...e.target.files]; e.target.value = "";
      const lista = [];
      for (const f of fs) { const b64 = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.readAsDataURL(f); }); lista.push({ tipo: f.type || (/\.pdf$/i.test(f.name) ? "application/pdf" : "image/jpeg"), dados: b64 }); }
      processar(lista, v.id);
    };
  }

  /* ---------- lê os arquivos e pergunta a categoria (só na primeira vez de cada nome) ---------- */
  async function processar(arquivos, vendaId) {
    if (!arquivos.length) return;
    aviso(`Lendo ${arquivos.length} comprovante${arquivos.length > 1 ? "s" : ""}…`);
    const fila = [];
    for (const a of arquivos) {
      try { const r = await lerArquivo(a.tipo, a.dados); fila.push({ ...r, ...analisar(r.texto) }); }
      catch (e) { fila.push({ texto: "", mini: "", ...analisar("") }); }
    }
    // os que já têm regra e valor entram sozinhos
    const perguntar = [];
    let auto = 0;
    for (const f of fila) {
      const rg = regraDe(f.nome);
      if (rg && f.valor > 0) { await poe("lanc", { id: uid(), venda: vendaId, criado: new Date().toISOString(), tipo: rg.tipo, cat: rg.cat, desc: rg.desc || "", nome: f.nome, valor: f.valor, data: f.data, texto: f.texto, mini: f.mini, auto: true }); auto++; }
      else perguntar.push(f);
    }
    if (auto) aviso(`${auto} reconhecido${auto > 1 ? "s" : ""} sozinho${auto > 1 ? "s" : ""}.`);
    if (perguntar.length) classificar(perguntar, vendaId); else abrirVenda(vendaId);
  }

  function classificar(fila, vendaId) {
    if (!fila.length) return abrirVenda(vendaId);
    const f = fila[0], resto = fila.slice(1);
    let tipo = f.tipo || "despesa", cat = f.cat || (tipo === "receita" ? REC[0] : "");
    const rg = !f.editar && regraDe(f.nome); if (rg) { tipo = rg.tipo; cat = rg.cat; }
    const chips = () => (tipo === "receita" ? REC : DESP).map((c) => `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === cat}">${esc(c)}</button>`).join("");
    modal(`
      <h2 style="margin:0 0 6px">${f.editar ? "Editar lançamento" : f.manual ? "Lançar à mão" : "De que se trata este comprovante?"}</h2>
      ${resto.length ? `<p class="note">Faltam mais ${resto.length} depois deste.</p>` : ""}
      ${f.mini ? `<img class="prev" src="${f.mini}" alt="Comprovante">` : ""}
      ${!f.manual && !f.editar && !f.texto ? '<p class="note">Não consegui ler o texto desse comprovante. Preencha abaixo.</p>' : ""}
      <div class="seg" role="group" aria-label="Tipo" style="margin-top:10px"><button type="button" id="gcDesp" aria-pressed="${tipo === "despesa"}">Despesa (eu paguei)</button><button type="button" id="gcRec" aria-pressed="${tipo === "receita"}">Receita (recebi)</button></div>
      <div class="gchips" id="gcCats">${chips()}</div>
      <div id="gcOutra" ${cat === "Outras despesas" ? "" : "hidden"}><label for="gcDesc">Qual despesa?</label><input id="gcDesc" value="${esc(f.desc || "")}" placeholder="Ex.: pneu, pedágio, ajudante"></div>
      <div class="row"><div><label for="gcVal">Valor (R$)</label><input id="gcVal" type="number" inputmode="decimal" step="0.01" value="${f.valor ? f.valor : ""}"></div><div><label for="gcData">Data</label><input id="gcData" type="date" value="${esc(f.data || hoje())}"></div></div>
      <label for="gcNome">${tipo === "receita" ? "Quem pagou" : "Pra quem foi pago"}</label><input id="gcNome" value="${esc(f.nome || "")}">
      <label class="chk"><input type="checkbox" id="gcLembra" ${f.editar ? "" : "checked"}> Lembrar: próximos comprovantes desse nome entram sozinhos nessa categoria</label>
      <button class="btn w" type="button" id="gcOk">${resto.length ? "Salvar e ir pro próximo" : "Salvar"}</button>
      ${f.editar ? '<button class="btn alt w" type="button" id="gcDel" style="color:var(--warn)">Apagar lançamento</button>' : ""}
      <button class="btn alt w" type="button" id="gcPula">${f.editar || f.manual ? "Cancelar" : "Pular este"}</button>`, (box) => {
      const q = (s) => box.querySelector(s);
      const set = () => { q("#gcDesp").setAttribute("aria-pressed", tipo === "despesa"); q("#gcRec").setAttribute("aria-pressed", tipo === "receita"); q("#gcCats").innerHTML = chips(); q("#gcOutra").hidden = cat !== "Outras despesas"; box.querySelector('label[for="gcNome"]').textContent = tipo === "receita" ? "Quem pagou" : "Pra quem foi pago"; };
      q("#gcDesp").onclick = () => { tipo = "despesa"; if (!DESP.includes(cat)) cat = ""; if (f.orig && f.dest && !f.editar) q("#gcNome").value = f.dest; set(); };
      q("#gcRec").onclick = () => { tipo = "receita"; cat = REC[0]; if (f.orig && !f.editar) q("#gcNome").value = f.orig; set(); };
      q("#gcCats").onclick = (e) => { const b = e.target.closest("[data-cat]"); if (!b) return; cat = b.dataset.cat; set(); if (cat === "Outras despesas") q("#gcDesc").focus(); };
      q("#gcPula").onclick = () => { fechaModal(); if (f.editar || f.manual) return abrirVenda(vendaId); classificar(resto, vendaId); };
      if (q("#gcDel")) q("#gcDel").onclick = async () => { await tira("lanc", f.id); fechaModal(); abrirVenda(vendaId); };
      q("#gcOk").onclick = async () => {
        const valor = num(q("#gcVal").value), nome = q("#gcNome").value.trim(), desc = cat === "Outras despesas" ? q("#gcDesc").value.trim() : "";
        if (!cat) { aviso("Escolha a categoria."); return; }
        if (!(valor > 0)) { aviso("Coloque o valor."); q("#gcVal").focus(); return; }
        if (cat === "Outras despesas" && !desc) { aviso("Escreva qual é a despesa."); q("#gcDesc").focus(); return; }
        const reg = { id: f.editar ? f.id : uid(), venda: vendaId, criado: f.criado || new Date().toISOString(), tipo, cat, desc, nome, valor, data: q("#gcData").value || hoje(), texto: f.texto || "", mini: f.mini || "", auto: false };
        await poe("lanc", reg);
        if (q("#gcLembra").checked && nome) { REGRAS[chaveNome(nome)] = { tipo, cat, desc }; await setCfg("regras", REGRAS); }
        // aprende o nome da Morais: numa receita, quem recebeu é a Morais
        if (tipo === "receita" && f.dest && norm(f.dest) !== norm(nome)) { const m = norm(f.dest); if (m && !MEUS.includes(m)) { MEUS.push(m); await setCfg("meus", MEUS); } }
        if (tipo === "despesa" && f.orig && norm(f.orig) !== norm(nome)) { const m = norm(f.orig); if (m && !MEUS.includes(m)) { MEUS.push(m); await setCfg("meus", MEUS); } }
        fechaModal(); classificar(resto, vendaId);
      };
    });
  }

  /* ---------- tela Compra (tabela da mineradora) ---------- */
  function telaCompra() {
    const opcoes = ['<option value="">Sem preço de compra</option>'].concat(TAB.fornecedores.flatMap((F) => F.itens.map((I) => `<option value="${F.id}.${I.id}">${esc(F.nome)} · ${esc(I.nome)}</option>`))).join("");
    $("gCompra").innerHTML = `
      <div class="gcard"><h2>Tabela de compra</h2><p class="note">Preço por tonelada. O app converte: 1 m³ = <b>${nf(TAB.fator)}</b> t, então a carga de 6 m³ = ${nf(TAB.fator * 6)} t.</p>
        <label for="gFator">Toneladas por m³</label><input id="gFator" type="number" step="0.01" inputmode="decimal" value="${TAB.fator}">
        <label for="gCol">Custo usado nas contas</label><select id="gCol"><option value="0" ${TAB.coluna ? "" : "selected"}>Pagando à vista</option><option value="1" ${TAB.coluna ? "selected" : ""}>Pagando a prazo</option></select></div>
      ${TAB.fornecedores.map((F, fi) => `<div class="gcard"><h3 style="margin-top:0">${esc(F.nome)}</h3><div class="note">${esc(F.contato || "")}</div>
        <div class="scroll"><table class="gtab"><tr><th>Material</th>${F.colunas.map((c) => `<th class="v">${esc(c)}<br><small>R$/t</small></th>`).join("")}${fi === 0 ? '<th class="v">R$/m³<br><small>carga 6 m³</small></th>' : ""}</tr>
        ${F.itens.map((I, ii) => `<tr><td>${esc(I.nome)}</td>${I.p.map((p, pi) => `<td class="v"><input type="number" step="0.01" inputmode="decimal" data-f="${fi}" data-i="${ii}" data-p="${pi}" value="${p == null ? "" : p}" aria-label="${esc(I.nome)} ${esc(F.colunas[pi])}"></td>`).join("")}
          ${fi === 0 ? `<td class="v">${I.p[TAB.coluna] != null && I.p[TAB.coluna] !== "" ? brl(I.p[TAB.coluna] * TAB.fator) + "<br><small>" + brl(I.p[TAB.coluna] * TAB.fator * 6) + "</small>" : "—"}</td>` : ""}</tr>`).join("")}</table></div></div>`).join("")}
      <div class="gcard"><h3 style="margin-top:0">Areia vendida × areia comprada</h3><p class="note">Pra cada areia do orçamento, qual areia da mineradora ela é.</p>
        ${Object.keys(TAB.vinculo).map((k) => `<label>${esc(k)}</label><select data-vinc="${esc(k)}">${opcoes.replace(`value="${TAB.vinculo[k]}"`, `value="${TAB.vinculo[k]}" selected`)}</select>`).join("")}</div>
      <button class="btn alt w" type="button" id="gPadrao">Voltar aos preços da tabela da mineradora</button>`;
    const sec = $("gCompra");
    sec.oninput = async (e) => {
      const t = e.target;
      if (t.dataset.f != null) { TAB.fornecedores[t.dataset.f].itens[t.dataset.i].p[t.dataset.p] = t.value === "" ? null : num(t.value); }
      else if (t.id === "gFator") { TAB.fator = num(t.value) || 1.2; }
      else return;
      await setCfg("tabela", TAB);
    };
    sec.onchange = async (e) => {
      const t = e.target;
      if (t.id === "gCol") TAB.coluna = +t.value; else if (t.dataset.vinc) TAB.vinculo[t.dataset.vinc] = t.value; else if (t.dataset.f == null && t.id !== "gFator") return;
      await setCfg("tabela", TAB); telaCompra(); estimativa();
    };
    $("gPadrao").onclick = async () => { TAB = JSON.parse(JSON.stringify(TABELA_PADRAO)); await setCfg("tabela", TAB); telaCompra(); };
  }

  /* ---------- estimativa no orçamento ---------- */
  let ULT = null;
  function estimativa(det) {
    if (det) ULT = det; const e = $("gEst"); if (!e || !ULT) return;
    const c = custoAreia(ULT.items);
    const temA = (ULT.items || []).some((i) => i.k === "A");
    e.hidden = !temA;
    if (!temA) return;
    const receita = ULT.tot || 0;
    e.innerHTML = c.total ? `Custo da areia na mineradora (${TAB.coluna ? "a prazo" : "à vista"}): <b>${brl(c.total)}</b><br>Sobra antes do combustível e do motorista: <b>${brl(receita - c.total)}</b>${c.faltou.length ? `<br><small>Sem preço de compra: ${esc(c.faltou.join(", "))}</small>` : ""}` : `Sem preço de compra pra ${esc(c.faltou.join(", "))}. Ajuste na aba Compra.`;
  }

  /* ---------- planilha Excel ---------- */
  const COR = "FF2A2722", OURO = "FFDCC595";
  function cab(ws, cols) {
    ws.columns = cols.map((c) => ({ header: c[0], key: c[1], width: c[2] }));
    const h = ws.getRow(1); h.font = { bold: true, color: { argb: OURO } }; h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR } }; h.alignment = { vertical: "middle", wrapText: true }; h.height = 30;
  }
  const FMT = '"R$" #,##0.00';
  async function planilha(vendaId) {
    if (!window.ExcelJS) { aviso("O gerador de planilha não carregou."); return; }
    aviso("Montando a planilha…");
    let vendas = await todos("vendas"); const lanc = await todos("lanc");
    if (vendaId) vendas = vendas.filter((v) => v.id === vendaId);
    vendas.sort((a, b) => (a.data || "").localeCompare(b.data || ""));
    const wb = new window.ExcelJS.Workbook(); wb.creator = "Orçamento Morais Tavares"; wb.created = new Date();
    // aba Resumo
    const ws = wb.addWorksheet(vendaId ? "Venda" : "Vendas", { views: [{ state: "frozen", ySplit: 1 }] });
    cab(ws, [["Data", "data", 12], ["Nº", "num", 11], ["Cliente", "cliente", 24], ["Cidade", "cidade", 16], ["O que foi vendido", "itens", 34], ["Receita", "rec", 14], ...DESP.map((d, i) => [d, "d" + i, 15]), ["Despesa total", "dt", 15], ["Lucro líquido", "lucro", 15], ["Situação", "sit", 11]]);
    const soma = { F: 0, G: 0, H: 0, I: 0, J: 0, K: 0, L: 0, M: 0 };
    vendas.forEach((v) => {
      const c = contas(v, lanc.filter((l) => l.venda === v.id));
      const row = { data: dataBR(v.data), num: v.num || "", cliente: v.cliente || "", cidade: v.cidade || "", itens: (v.itens || []).map((i) => i.k === "A" ? `${i.q}× ${i.d} (${i.m3} m³)` : `${nf(i.q)} tijolos ${i.d}`).join("; ") || v.desc || "", rec: c.receitaUsada, sit: (v.fechada ? "Fechada" : "Aberta") + (c.temReceita ? "" : " · receita prevista") };
      DESP.forEach((d, i) => (row["d" + i] = c.desp[d] || 0));
      const r = ws.addRow(row), n = r.number;
      r.getCell("dt").value = { formula: `SUM(G${n}:K${n})`, result: c.despTotal }; r.getCell("lucro").value = { formula: `F${n}-L${n}`, result: c.lucro };
      soma.F += c.receitaUsada; DESP.forEach((d, i) => (soma["GHIJK"[i]] += c.desp[d] || 0)); soma.L += c.despTotal; soma.M += c.lucro;
    });
    const ult = ws.rowCount;
    if (vendas.length) {
      const t = ws.addRow({ cliente: "TOTAL" }), n = t.number;
      ["F", "G", "H", "I", "J", "K", "L", "M"].forEach((col) => (t.getCell(col).value = { formula: `SUM(${col}2:${col}${ult})`, result: soma[col] }));
      t.font = { bold: true }; t.border = { top: { style: "medium", color: { argb: OURO } } };
    }
    ["F", "G", "H", "I", "J", "K", "L", "M"].forEach((col) => (ws.getColumn(col).numFmt = FMT));
    // aba Lançamentos
    const wl = wb.addWorksheet("Lançamentos", { views: [{ state: "frozen", ySplit: 1 }] });
    cab(wl, [["Data", "data", 12], ["Venda (cliente)", "venda", 24], ["Tipo", "tipo", 10], ["Categoria", "cat", 22], ["Descrição", "desc", 22], ["Nome no comprovante", "nome", 30], ["Valor", "valor", 14]]);
    const ids = new Set(vendas.map((v) => v.id));
    lanc.filter((l) => ids.has(l.venda)).sort((a, b) => (a.data || "").localeCompare(b.data || "")).forEach((l) => {
      const v = vendas.find((x) => x.id === l.venda);
      wl.addRow({ data: dataBR(l.data), venda: (v && v.cliente) || "", tipo: l.tipo === "receita" ? "Receita" : "Despesa", cat: l.cat, desc: l.desc || "", nome: l.nome || "", valor: l.tipo === "receita" ? +l.valor : -l.valor });
    });
    wl.getColumn("valor").numFmt = FMT;
    // aba Tabela de compra
    const wt = wb.addWorksheet("Tabela de compra");
    cab(wt, [["Fornecedor", "f", 24], ["Material", "m", 18], ["Preço 1 (R$/t)", "p1", 16], ["Preço 2 (R$/t)", "p2", 16], ["R$/m³ (preço 1)", "m3", 15], ["Carga 6 m³ (preço 1)", "c6", 18]]);
    TAB.fornecedores.forEach((F, fi) => F.itens.forEach((I) => { const r = wt.addRow({ f: `${F.nome} (${F.colunas.join(" / ")})`, m: I.nome, p1: I.p[0], p2: I.p[1] }); if (fi === 0 && I.p[0] != null) { r.getCell("m3").value = { formula: `C${r.number}*${TAB.fator}`, result: I.p[0] * TAB.fator }; r.getCell("c6").value = { formula: `C${r.number}*${TAB.fator}*6`, result: I.p[0] * TAB.fator * 6 }; } }));
    ["C", "D", "E", "F"].forEach((col) => (wt.getColumn(col).numFmt = FMT));
    wt.addRow({}); wt.addRow({ f: `Areia: 1 m³ = ${nf(TAB.fator)} t` });
    const buf = await wb.xlsx.writeBuffer();
    let bin = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
    const v0 = vendaId && vendas[0];
    const nome = (vendaId ? `Venda_${(v0 && v0.cliente) || "cliente"}_${dataBR(v0 && v0.data).replace(/\//g, "-")}` : `Vendas_Morais_Tavares_${hoje()}`).normalize("NFD").replace(/[^\w\-]/g, "_") + ".xlsx";
    if (WE) { try { await WE.enviar({ pdf: btoa(bin), nome, compartilhar: true, tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); aviso("Escolha onde salvar ou mandar a planilha."); } catch (e) { aviso("Não deu pra abrir a planilha."); } }
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([buf])); a.download = nome; document.body.appendChild(a); a.click(); a.remove(); }
  }

  /* ---------- modal e aviso ---------- */
  function modal(html, liga) {
    fechaModal();
    const m = document.createElement("div"); m.className = "gmodal"; m.id = "gModal";
    m.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-fecha]")) fechaModal(); });
    liga(m.querySelector(".box"));
  }
  function fechaModal() { const m = $("gModal"); if (m) m.remove(); }
  function aviso(t) { const e = $("toast"); if (!e) return; e.textContent = t; e.hidden = false; clearTimeout(aviso._t); aviso._t = setTimeout(() => (e.hidden = true), 4000); }

  /* ---------- comprovantes compartilhados pro app ---------- */
  async function recebidos() {
    if (!RC) return;
    try {
      const r = await RC.pegar(); const a = (r && r.arquivos) || [];
      if (!a.length) return;
      PEND = PEND.concat(a.map((x) => ({ tipo: x.tipo, dados: x.dados })));
      aba("vendas");
      if (VATUAL) abrirVenda(VATUAL);
    } catch (e) {}
  }

  /* ---------- liga tudo ---------- */
  async function iniciar() {
    try { await abrir(); } catch (e) { return; }
    TAB = await cfg("tabela", JSON.parse(JSON.stringify(TABELA_PADRAO)));
    REGRAS = await cfg("regras", {}); MEUS = await cfg("meus", []);
    montar();
    // venda criada sozinha quando um recibo é enviado; orçamento fica guardado
    window.addEventListener("orc:enviado", async (e) => {
      const d = e.detail || {}; const base = { id: uid(), criada: new Date().toISOString(), data: hoje(), num: d.num, cliente: d.cliente, tel: d.tel, cidade: d.cidade, end: d.end, itens: d.itens, total: d.total, pagamento: d.pagamento };
      if (d.doc === "R") await poe("vendas", base); else await poe("orcs", base);
    });
    window.addEventListener("orc:soma", (e) => estimativa(e.detail));
    window.addEventListener("comprovantesRecebidos", recebidos);
    document.addEventListener("resume", recebidos);
    setTimeout(recebidos, 800);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
  window.__gestao = { analisar, custoAreia, planilha, aba };
})();
