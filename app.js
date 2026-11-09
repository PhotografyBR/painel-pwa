/* Casca do PWA: pede a chave do cofre e um token de leitura do GitHub, busca o
   cofre cifrado no repositorio privado, abre no aparelho e monta o app de sempre
   (src/app.template.html) em modo somente leitura. O motor nao e tocado: a mesma
   conta que o app do desktop e o aviso do Telegram usam. */
(function () {
  "use strict";
  const REPO = "PhotografyBR/financial-reset";
  const CAMINHO = "cofre/dados.json.enc";
  const URL_COFRE = "https://api.github.com/repos/" + REPO + "/contents/" + CAMINHO;
  const CHAVE_LS = "fr_chave", TOKEN_LS = "fr_token", CACHE_COFRE = "fr-cofre";
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
  function barra(dados, offline, copiaDe) {
    const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    const [a, m, d] = dados.atualizado_em.split("-").map(Number);
    const dias = Math.round((hoje - new Date(a, m - 1, d, 12)) / 864e5);
    const fmt = x => String(x).padStart(2, "0");
    const b = document.createElement("div");
    b.id = "pwa-barra";
    let txt = "Só leitura · dados de " + fmt(d) + "/" + fmt(m) +
      (dias <= 0 ? " (hoje)" : dias === 1 ? " (ontem)" : " (" + dias + " dias atrás)");
    if (offline) txt += " · sem conexão com o GitHub: cópia guardada" +
      (copiaDe ? " de " + new Date(copiaDe).toLocaleString("pt-BR",
        { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
    b.className = (dias >= 2 || offline) ? "velho" : "";
    const t = document.createElement("span"); t.textContent = txt;
    const bt1 = document.createElement("button"); bt1.textContent = "Atualizar";
    bt1.onclick = () => location.reload();
    const bt2 = document.createElement("button"); bt2.textContent = "Sair";
    bt2.title = "Esquece a chave e o token neste aparelho";
    bt2.onclick = async () => {
      ls.del(CHAVE_LS); ls.del(TOKEN_LS);
      try { await caches.delete(CACHE_COFRE); } catch (e) {}
      location.reload();
    };
    b.append(t, bt1, bt2);
    return b;
  }

  const CSS_EXTRA = `
    /* somente leitura: lancar e confirmar ficam para a Etapa 2 */
    #abre-lancar,#lancar,#baixar{display:none!important}
    #pwa-barra{display:flex;gap:6px;align-items:center;flex-wrap:nowrap;justify-content:space-between;
      margin:0 0 14px;padding:8px 12px;border:1px solid var(--linha);
      border-radius:10px;background:var(--card);color:var(--fraco);font-size:12.5px}
    #pwa-barra.velho{border-color:var(--alerta);background:var(--alertabg);color:var(--alerta)}
    #pwa-barra button{padding:4px 8px;font-size:12px;flex:none}
    #pwa-barra span{flex:1 1 auto;min-width:0}`;

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

    (document.querySelector(".wrap") || document.body)
      .prepend(barra(dados, offline, copiaDe));   // no topo: no fim ninguem ve
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
