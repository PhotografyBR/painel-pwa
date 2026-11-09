/* Casca do PWA: pede a chave do cofre e um token de leitura do GitHub, busca o
   cofre cifrado no repositorio privado, abre no aparelho e monta o app de sempre
   (src/app.template.html). O motor nao e tocado: a mesma conta que o app do
   desktop e o aviso do Telegram usam.

   Ler so o cofre nao bastava: o numero do dia so fica verdadeiro com o gasto do
   dia dentro (pedido do Caio, 09/11). Como o celular nao escreve no cofre, o
   gasto entra numa FILA local, que alimenta o motor na hora e vira um bloco de
   texto no formato do lanca.py para o Caio colar no chat. */
(function () {
  "use strict";
  const REPO = "PhotografyBR/financial-reset";
  const CAMINHO = "cofre/dados.json.enc";
  const URL_COFRE = "https://api.github.com/repos/" + REPO + "/contents/" + CAMINHO;
  const CHAVE_LS = "fr_chave", TOKEN_LS = "fr_token", CACHE_COFRE = "fr-cofre";
  const FILA_LS = "fr_fila";
  const RECARGA_MIN = 15;          // volta ao primeiro plano depois disso: recarrega
  const $ = id => document.getElementById(id);
  const carregadoEm = Date.now();
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    del: k => { try { localStorage.removeItem(k); } catch (e) {} }
  };

  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("sw.js").catch(() => {});

  /* ---- cofre: GitHub primeiro, copia guardada so se nao houver conexao ---- */
  async function guardaCopia(bytes) {
    try {
      const c = await caches.open(CACHE_COFRE);
      await c.put("cofre", new Response(bytes.slice(0),
        { headers: { "x-copia-de": new Date().toISOString() } }));
    } catch (e) {}
  }
  async function daCopia() {
    try {
      const r = await (await caches.open(CACHE_COFRE)).match("cofre");
      if (r) return { bytes: await r.arrayBuffer(), offline: true,
                      copiaDe: r.headers.get("x-copia-de") || "" };
    } catch (e) {}
    throw new Error("rede");
  }
  async function baixaCofre(token) {
    let r;
    try {
      // so Authorization e Accept: sao o que o CORS da API do GitHub aceita sem
      // pre-condicao (X-GitHub-Api-Version nao esta na lista deles)
      r = await fetch(URL_COFRE, { cache: "no-store", headers: {
        "Accept": "application/vnd.github.raw+json",
        "Authorization": "Bearer " + token.trim() } });
    } catch (e) { return daCopia(); }                  // sem conexao
    if (r.status === 401) throw new Error("token");
    if (r.status === 403 || r.status === 404) throw new Error("acesso");
    if (!r.ok) return daCopia();                       // GitHub fora do ar
    const bytes = await r.arrayBuffer();
    guardaCopia(bytes);
    return { bytes, offline: false, copiaDe: "" };
  }

  /* ---- barra do topo ---- */
  let BARRA = null;                     // {span, dados, offline, copiaDe}

  function textoBarra() {
    const { dados, offline, copiaDe } = BARRA;
    const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    const [a, m, d] = dados.atualizado_em.split("-").map(Number);
    const dias = Math.round((hoje - new Date(a, m - 1, d, 12)) / 864e5);
    const fmt = x => String(x).padStart(2, "0");
    let txt = "Dados de " + fmt(d) + "/" + fmt(m) +
      (dias <= 0 ? " (hoje)" : dias === 1 ? " (ontem)" : " (" + dias + " dias atrás)");
    if (offline) txt += " · sem conexão com o GitHub: cópia guardada" +
      (copiaDe ? " de " + new Date(copiaDe).toLocaleString("pt-BR",
        { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
    const naFila = FILA.filter(g => !g.enviado_em).length;
    if (naFila) txt += " · " + naFila + (naFila > 1 ? " na fila" : " na fila");
    BARRA.span.textContent = txt;
    BARRA.el.className = (dias >= 2 || offline || naFila) ? "velho" : "";
  }

  function barra(dados, offline, copiaDe) {
    const b = document.createElement("div");
    b.id = "pwa-barra";
    const t = document.createElement("span");
    const bt1 = document.createElement("button"); bt1.textContent = "Atualizar";
    bt1.onclick = () => location.reload();
    const bt2 = document.createElement("button"); bt2.textContent = "Sair";
    bt2.title = "Esquece a chave e o token neste aparelho";
    bt2.onclick = async () => {
      if (FILA.length && !confirm("Há lançamentos na fila que ainda não foram para o "
          + "Claude. Sair apaga a chave, mas a fila continua guardada neste aparelho. "
          + "Quer sair mesmo assim?")) return;
      ls.del(CHAVE_LS); ls.del(TOKEN_LS);
      try { await caches.delete(CACHE_COFRE); } catch (e) {}
      location.reload();
    };
    b.append(t, bt1, bt2);
    BARRA = { el: b, span: t, dados, offline, copiaDe };
    textoBarra();
    return b;
  }

  const CSS_EXTRA = `
    /* "Baixar dados" gravaria o cofre ABERTO no aparelho, fora do app; e a
       confirmacao de assinatura so gravaria nesta aba. Ficam de fora. */
    #baixar{display:none!important}
    #fila-cx{margin-top:12px;border-top:1px solid var(--linha);padding-top:12px}
    #fila-cx .linha{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
    #fila-cx .aviso{margin-top:10px;padding:8px 10px;border-radius:8px;
      background:var(--alertabg);color:var(--alerta);font-size:12.5px}
    #fila-texto{width:100%;margin-top:10px;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;
      padding:8px;border:1px solid var(--linha);border-radius:8px;background:var(--card);
      color:var(--txt);min-height:88px}
    #fila-cx tr.enviado td{color:var(--fraco)}
    #pwa-barra{display:flex;gap:6px;align-items:center;flex-wrap:nowrap;justify-content:space-between;
      margin:0 0 14px;padding:8px 12px;border:1px solid var(--linha);
      border-radius:10px;background:var(--card);color:var(--fraco);font-size:12.5px}
    #pwa-barra.velho{border-color:var(--alerta);background:var(--alertabg);color:var(--alerta)}
    #pwa-barra button{padding:4px 8px;font-size:12px;flex:none}
    #pwa-barra span{flex:1 1 auto;min-width:0}`;


  /* ================= fila de lancamentos (Etapa 2) =================
     O celular nao escreve no cofre. O gasto entra aqui, alimenta o motor na
     hora (mesmo caminho dos gastos da pagina publicada, `GASTOS_APP`) e vira um
     bloco de texto no formato do lanca.py para o Caio colar no chat.

     Quando sai da conta: so quando o Caio toca em "Ja entraram". Some antes
     disso o item sumiria do saldo enquanto ainda nao estivesse no cofre, e o
     saldo ficaria MAIOR que o verdadeiro. Contar duas vezes por um dia erra
     para o lado seguro; a tela avisa a hora de limpar. */
  let FILA = [];

  function leFila() {
    try { FILA = JSON.parse(ls.get(FILA_LS) || "[]"); } catch (e) { FILA = []; }
    if (!Array.isArray(FILA)) FILA = [];
  }
  function salvaFila() {
    try { localStorage.setItem(FILA_LS, JSON.stringify(FILA)); return true; }
    catch (e) { return false; }      // cota cheia: o chamador avisa, nao perde calado
  }

  const dataBR = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7);
  const vlr = v => (v < 0 ? "-" : "") + "R$ " + Math.abs(v)
    .toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // uma linha do --gasto: data;valor;desc;conta;categoria[;Nx][;entrada]
  function linhaGasto(g) {
    const v = g.valor.toFixed(2).replace(".", ",");
    const desc = g.desc.replace(/[;\n\r]/g, " ").trim();   // ";" separa campos
    return [g.data, v, desc, g.conta, g.categoria]
      .concat(g.parcelas > 1 ? [g.parcelas + "x"] : [])
      .concat(g.tipo === "entrada" ? ["entrada"] : []).join(";");
  }
  function blocoDaFila(itens) {
    return "Gastos lançados no celular (" + itens.length + "):\n" +
      itens.map(linhaGasto).join("\n");
  }

  function aplicaFila() {
    // o motor le a fila inteira, enviados inclusive, ate o Caio confirmar
    GASTOS_APP = FILA.map(g => ({ ...g }));
    calcula(); render(); renderLancar();
    if (BARRA) textoBarra();
  }

  function diasDesde(iso8601) {
    return Math.floor((Date.now() - new Date(iso8601).getTime()) / 864e5);
  }

  /* ---- a tela da fila, no lugar do painel de pendentes do app ---- */
  function renderFila() {
    const cx = $("g-pendentes");
    cx.innerHTML = "";
    if (!FILA.length) return;
    cx.id = "g-pendentes";
    const div = document.createElement("div");
    div.id = "fila-cx";

    const tab = document.createElement("table");
    const tb = document.createElement("tbody");
    const cab = tb.insertRow();
    // o titulo nao pode dizer "na fila" quando ja foi tudo enviado
    const titulo = FILA.some(g => !g.enviado_em)
      ? "Lançado no celular, ainda não enviado" : "Enviado, esperando o Claude lançar";
    [titulo, "Valor", ""].forEach((t, i) => {
      const th = document.createElement("th");
      th.textContent = t; if (i === 1) th.className = "r";
      cab.appendChild(th);
    });
    FILA.slice().sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1)).forEach(g => {
      const tr = tb.insertRow();
      if (g.enviado_em) tr.className = "enviado";
      const c1 = tr.insertCell();
      c1.appendChild(document.createTextNode(g.desc));
      const det = document.createElement("div");
      det.className = "det";
      const c = typeof conta === "function" ? conta(g.conta) : null;
      det.textContent = dataBR(g.data) + " · " + ((c && c.nome) || g.conta) +
        (g.parcelas > 1 ? " · " + g.parcelas + "x" : "") +
        (g.enviado_em ? " · enviado" : "");
      c1.appendChild(det);
      const c2 = tr.insertCell();
      c2.className = "r num" + (g.tipo === "entrada" ? " pos" : "");
      c2.textContent = (g.tipo === "entrada" ? "+" : "") + vlr(g.valor);
      const c3 = tr.insertCell(); c3.className = "r";
      const bap = document.createElement("button");
      bap.type = "button"; bap.textContent = "Apagar";
      bap.onclick = () => {
        if (!confirm("Apagar \"" + g.desc + "\" da fila?")) return;
        FILA = FILA.filter(x => x.id !== g.id);
        salvaFila(); aplicaFila();
      };
      c3.appendChild(bap);
    });
    tab.appendChild(tb); div.appendChild(tab);

    const naFila = FILA.filter(g => !g.enviado_em);
    const enviados = FILA.filter(g => g.enviado_em);
    const linha = document.createElement("div"); linha.className = "linha";

    if (naFila.length) {
      const bc = document.createElement("button");
      bc.type = "button"; bc.className = "primario";
      bc.id = "fila-copiar";
      bc.textContent = "Copiar para o Claude (" + naFila.length + ")";
      bc.onclick = async () => {
        const texto = blocoDaFila(naFila);
        let copiou = false;
        try { await navigator.clipboard.writeText(texto); copiou = true; } catch (e) {}
        const agora = new Date().toISOString();
        naFila.forEach(g => { g.enviado_em = agora; });
        const gravou = salvaFila();
        aplicaFila();
        const ta = $("fila-texto");
        if (ta) {
          ta.value = texto;
          ta.hidden = false;
          if (!copiou) { ta.focus(); ta.select(); }
        }
        const m = $("fila-msg");
        if (m) m.textContent = (copiou ? "Copiado. Cole na conversa com o Claude."
          : "Não consegui copiar sozinho: selecione o texto abaixo e copie.") +
          (gravou ? "" : " ATENÇÃO: não consegui guardar a fila neste aparelho — " +
                         "não feche o app antes de colar.");
      };
      linha.appendChild(bc);
    }
    if (enviados.length) {
      const be = document.createElement("button");
      be.type = "button"; be.id = "fila-entraram";
      be.textContent = "Já entraram (" + enviados.length + ")";
      be.title = "Tire da conta depois que o Claude confirmar que lançou";
      be.onclick = () => {
        FILA = FILA.filter(g => !g.enviado_em);
        salvaFila(); aplicaFila();
      };
      linha.appendChild(be);
    }
    const msg = document.createElement("span");
    msg.id = "fila-msg"; msg.className = "det";
    linha.appendChild(msg);
    div.appendChild(linha);

    const ta = document.createElement("textarea");
    ta.id = "fila-texto"; ta.readOnly = true; ta.hidden = true;
    ta.setAttribute("aria-label", "Texto para colar na conversa com o Claude");
    div.appendChild(ta);

    // avisos: fila parada, e enviado que o cofre ja deve ter absorvido
    const velhos = naFila.filter(g => diasDesde(g.criado_em) >= 1);
    if (velhos.length) {
      const a = document.createElement("div"); a.className = "aviso"; a.id = "fila-parada";
      const d = Math.max(...velhos.map(g => diasDesde(g.criado_em)));
      a.textContent = velhos.length + (velhos.length > 1 ? " lançamentos estão" : " lançamento está") +
        " na fila há " + (d === 1 ? "1 dia" : d + " dias") + " sem ir para o Claude. " +
        "Enquanto não forem, eles existem só neste aparelho.";
      div.appendChild(a);
    }
    const base = (typeof DADOS === "object" && DADOS.atualizado_em) || "";
    const jaNoCofre = enviados.filter(g => base > g.enviado_em.slice(0, 10));
    if (jaNoCofre.length) {
      const a = document.createElement("div"); a.className = "aviso"; a.id = "fila-dobrada";
      a.textContent = "O cofre já é de " + dataBR(base) + ", depois do envio destes " +
        jaNoCofre.length + ". Se o Claude já lançou, toque em “Já entraram” — senão " +
        "eles contam duas vezes e o saldo aparece menor do que é.";
      div.appendChild(a);
    }
    cx.appendChild(div);
  }

  /* ---- liga o formulario que ja existe no app a fila ---- */
  function ligaLancamento() {
    /* O que a fila usa do motor. Nao da para procurar em `window`: `conta` e
       `DADOS` sao const no topo do template e const nao vira propriedade do
       objeto global — foi assim que a primeira versao disto derrubou a tela
       inteira. Entao cada nome e testado por referencia mesmo. */
    const precisa = [
      ["calcula", () => typeof calcula],
      ["render", () => typeof render],
      ["renderLancar", () => typeof renderLancar],
      ["conta", () => typeof conta],
      ["DADOS", () => typeof DADOS],
      ["GASTOS_APP", () => { GASTOS_APP; return "ok"; }]
    ];
    const falta = precisa.filter(([, f]) => {
      try { return f() === "undefined"; } catch (e) { return true; }
    }).map(([n]) => n);
    if (falta.length) throw new Error("o motor mudou de nome: " + falta.join(", "));

    leFila();

    // a versao do app fala com o banco do claude.ai, que nao existe aqui
    renderLancar = function () {
      const sel = $("g-conta");
      if (!sel.options.length) {
        DADOS.contas.forEach(c => sel.add(new Option(c.nome, c.id)));
        sel.value = DADOS.contas.some(c => c.id === "cc_nubank")
          ? "cc_nubank" : DADOS.contas[0].id;
        const cat = $("g-cat");
        DADOS.categorias.filter(c => c.id !== "renda")
          .forEach(c => cat.add(new Option(c.nome, c.id)));
        if (DADOS.categorias.some(c => c.id === "mercado")) cat.value = "mercado";
        const d = new Date();
        $("g-data").value = d.getFullYear() + "-" +
          String(d.getMonth() + 1).padStart(2, "0") + "-" +
          String(d.getDate()).padStart(2, "0");
      }
      const c = conta(sel.value);
      $("g-parc-rot").hidden = !(c && c.tipo === "cartao");
      if (!(c && c.tipo === "cartao")) $("g-parc").value = 1;
      renderFila();
    };

    $("form-lancar").onsubmit = ev => {
      ev.preventDefault();
      const msg = $("g-msg");
      const valor = Math.round(parseFloat($("g-valor").value) * 100) / 100;
      const desc = $("g-desc").value.trim();
      const data = $("g-data").value;
      if (!(valor > 0) || !desc || !data) {
        msg.textContent = "Preencha valor, descrição e data."; return;
      }
      const entrada = $("g-entrada").checked;
      const cc = conta($("g-conta").value);
      const nParc = Math.max(1, Math.min(24, parseInt($("g-parc").value, 10) || 1));
      const parcelas = (entrada || !cc || cc.tipo !== "cartao") ? 1 : nParc;
      if (nParc > 1 && parcelas === 1) {
        msg.textContent = "Parcelado só em cartão."; return;
      }
      const g = {
        id: "app-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
        data, desc, valor, conta: $("g-conta").value,
        categoria: entrada ? "renda" : $("g-cat").value,
        tipo: entrada ? "entrada" : "saida", parcelas,
        criado_em: new Date().toISOString(), enviado_em: null
      };
      FILA.push(g);
      if (!salvaFila()) {
        msg.textContent = "Não consegui guardar neste aparelho. Copie para o Claude agora.";
      } else {
        msg.textContent = "Na fila: " + vlr(valor) + " — " + desc +
          (parcelas > 1 ? " em " + parcelas + "x" : "") + ". Já entrou na conta.";
      }
      $("g-valor").value = ""; $("g-desc").value = "";
      $("g-parc").value = 1; $("g-entrada").checked = false;
      aplicaFila();
      $("g-valor").focus();
    };

    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    aplicaFila();
  }

  async function montaApp(texto, offline, copiaDe) {
    const r = await fetch("app.tpl.html", { cache: "no-cache" });
    if (!r.ok) throw new Error("rede");
    const doc = new DOMParser().parseFromString(await r.text(), "text/html");
    const estilo = doc.querySelector("style").textContent;
    const script = doc.querySelector("body script").textContent;
    doc.querySelectorAll("body script").forEach(s => s.remove());
    if (script.split("/*__DADOS__*/").length !== 2) throw new Error("template");

    $("bloqueio").remove();
    const st = document.createElement("style");
    st.textContent = estilo + CSS_EXTRA;
    document.head.appendChild(st);
    document.body.append(...doc.body.childNodes);

    // a secao de confirmar assinatura grava so na aba (sem banco): fica fora do
    // modo leitura, para nao prometer o que o celular nao faz
    const conf = $("confirma");
    if (conf && conf.closest(".sub-bloco")) conf.closest(".sub-bloco").style.display = "none";

    const dados = JSON.parse(texto);
    const s = document.createElement("script");
    s.textContent = script.replace("/*__DADOS__*/", () => texto);   // sem interpretar "$"
    document.body.appendChild(s);

    /* Se a fila nao subir, o app ainda serve para ver: melhor so leitura com
       aviso do que uma tela pela metade, que foi o que aconteceu ao trocar o
       jeito de procurar o motor. */
    let erroFila = "";
    try { ligaLancamento(); }
    catch (e) {
      erroFila = e.message || "erro";
      const b = $("abre-lancar"); if (b) b.style.display = "none";
    }
    (document.querySelector(".wrap") || document.body)
      .prepend(barra(dados, offline, copiaDe));   // no topo: no fim ninguem ve
    if (erroFila) {
      BARRA.span.textContent += " · lançar está fora do ar (" + erroFila + ")";
      BARRA.el.className = "velho";
    }
  }

  /* ---- abrir ---- */
  const MENSAGENS = {
    chave: "A chave não abriu o cofre. Confira se colou inteira, sem espaço sobrando.",
    token: "O GitHub não aceitou o token (errado, vencido ou apagado). Cole um token novo.",
    acesso: "O token não tem acesso ao repositório do cofre. Ele precisa de leitura de Contents em financial-reset.",
    rede: "Sem conexão e sem cópia guardada neste aparelho. Tente de novo com internet.",
    formato: "O arquivo do cofre não está no formato esperado.",
    template: "A versão do app não bate com a da casca. Atualize a página."
  };

  async function tenta(chave, token, daTela) {
    const botao = $("abrir");
    if (botao) botao.disabled = true;
    try {
      const { bytes, offline, copiaDe } = await baixaCofre(token);
      const texto = await window.abreCofre(bytes, chave);
      ls.set(CHAVE_LS, chave.trim()); ls.set(TOKEN_LS, token.trim());
      await montaApp(texto, offline, copiaDe);
    } catch (e) {
      if (!$("bloqueio")) { console.error(e); return; }
      if (!daTela) {                                   // veio do que estava guardado
        if (e.message === "chave") ls.del(CHAVE_LS);
        if (e.message === "token" || e.message === "acesso") ls.del(TOKEN_LS);
        $("chave").value = ls.get(CHAVE_LS) || "";      // so falta o que quebrou
        $("token").value = ls.get(TOKEN_LS) || "";
      }
      $("erro").textContent = MENSAGENS[e.message] || "Não consegui abrir: " + e.message;
      if (botao) botao.disabled = false;
    }
  }

  $("form-chave").addEventListener("submit", ev => {
    ev.preventDefault();
    $("erro").textContent = "";
    tenta($("chave").value, $("token").value, true);
  });

  const kg = ls.get(CHAVE_LS), tg = ls.get(TOKEN_LS);
  if (kg && tg) tenta(kg, tg, false);
  else { $("chave").value = kg || ""; $("token").value = tg || ""; }

  // o iPhone mantem a pagina viva por dias: ao voltar, recarrega se ja passou
  // um tempo, para nao mostrar o cartao do dia e os dados de ontem
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !$("bloqueio") &&
        Date.now() - carregadoEm > RECARGA_MIN * 60000) location.reload();
  });
})();
