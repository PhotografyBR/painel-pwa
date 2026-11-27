/* Abre o cofre no aparelho. Mesmo formato do cofre.py (openssl enc):
   "Salted__" + 8 bytes de sal + AES-256-CBC, chave e IV vindos de
   PBKDF2-SHA256 com 200000 iteracoes (48 bytes: 32 de chave, 16 de IV). */
(function (raiz) {
  "use strict";
  const ITER = 200000;

  async function abreCofre(bytes, chaveTexto) {
    const b = new Uint8Array(bytes);
    const cab = new TextDecoder().decode(b.slice(0, 8));
    if (b.length < 32 || cab !== "Salted__") throw new Error("formato");
    const sal = b.slice(8, 16), cifrado = b.slice(16);
    const base = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(chaveTexto.trim()), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: sal, iterations: ITER, hash: "SHA-256" }, base, 384));
    const k = await crypto.subtle.importKey(
      "raw", bits.slice(0, 32), "AES-CBC", false, ["decrypt"]);
    let claro;
    try {
      claro = await crypto.subtle.decrypt({ name: "AES-CBC", iv: bits.slice(32, 48) }, k, cifrado);
    } catch (e) { throw new Error("chave"); }      // padding invalido = chave errada
    const texto = new TextDecoder("utf-8", { fatal: true }).decode(claro);
    JSON.parse(texto);                              // so aceita o que e JSON de verdade
    return texto;
  }
  raiz.abreCofre = abreCofre;
})(typeof window !== "undefined" ? window : globalThis);
