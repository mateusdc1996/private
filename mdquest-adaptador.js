/* =====================================================================
   MDQuest · adaptador
   O programa foi feito para rodar dentro do claude.ai e pede ao
   ambiente cinco "tomadas": claude.use("user" | "db" | "sample" |
   "downloads" | "assets"). Este arquivo fornece as mesmas tomadas,
   ligadas ao Supabase (login, banco, arquivos) e ao servidor
   /api/claude (IA com cota). O programa em si não muda.
   ===================================================================== */
(function () {
  "use strict";
  const CFG = window.MDQ_CONFIG || {};
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  window.mdqSupabase = sb;
  const BUCKET = "arquivos";

  /* ------------------------------------------------------------------
     LOGIN — tela simples que aparece antes do programa
     ------------------------------------------------------------------ */
  const CSS = `
  #mdq-login{position:fixed;inset:0;z-index:99999;background:#f3f5f7;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif;color:#1f2a2e}
  #mdq-login .cx{background:#fff;border:1px solid #dde3e8;border-radius:14px;padding:28px 26px;width:min(380px,92vw);box-shadow:0 6px 24px rgba(0,0,0,.06)}
  #mdq-login h1{font-size:22px;margin:0 0 4px} #mdq-login p{margin:0 0 16px;color:#45535a;font-size:14px}
  #mdq-login label{display:block;font-size:13px;margin:10px 0 4px;color:#45535a}
  #mdq-login input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #dde3e8;border-radius:8px;font-size:15px}
  #mdq-login button{width:100%;margin-top:16px;padding:11px;border:0;border-radius:8px;background:#2f6f44;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  #mdq-login button[disabled]{opacity:.6;cursor:wait}
  #mdq-login .lk{display:flex;justify-content:space-between;margin-top:14px;font-size:13px}
  #mdq-login .lk a{color:#2f6f44;cursor:pointer;text-decoration:underline}
  #mdq-login .msg{margin-top:12px;font-size:13px;min-height:1em} #mdq-login .msg.erro{color:#b4372a} #mdq-login .msg.ok{color:#1c5634}
  #mdq-conta{position:fixed;right:10px;bottom:10px;z-index:9999;background:#1f3747;color:#fff;font:12px Inter,system-ui,sans-serif;padding:6px 10px;border-radius:8px;opacity:.85}
  #mdq-conta a{color:#cfe8d6;cursor:pointer;margin-left:8px;text-decoration:underline}`;

  function el(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }
  function estilo() { if (!document.getElementById("mdq-css")) { const s = document.createElement("style"); s.id = "mdq-css"; s.textContent = CSS; document.head.appendChild(s); } }

  function telaLogin(modoInicial) {
    estilo();
    return new Promise((resolve) => {
      let modo = modoInicial || "entrar";
      const box = el(`<div id="mdq-login"><div class="cx"></div></div>`);
      const cx = box.firstChild;
      const desenhar = (msg, tipo) => {
        const T = {
          entrar: ["Entrar no MDQuest", "Use o e-mail e a senha da sua conta.", "Entrar"],
          criar: ["Criar conta", "Você vai receber um e-mail para confirmar o cadastro.", "Criar conta"],
          esqueci: ["Recuperar senha", "Enviaremos um link para você criar uma senha nova.", "Enviar link"],
          nova: ["Nova senha", "Digite a senha nova da sua conta.", "Salvar senha"],
        }[modo];
        cx.innerHTML = `<h1>${T[0]}</h1><p>${T[1]}</p>
          ${modo !== "nova" ? `<label>E-mail</label><input id="mdq-email" type="email" autocomplete="email">` : ""}
          ${modo !== "esqueci" ? `<label>Senha</label><input id="mdq-senha" type="password" autocomplete="${modo === "entrar" ? "current-password" : "new-password"}" minlength="8">` : ""}
          ${modo === "criar" ? `<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px"><input id="mdq-aceite" type="checkbox" style="width:auto;margin-top:2px"> <span>Li e aceito os <a href="/termos.html" target="_blank">termos de uso</a> e a <a href="/privacidade.html" target="_blank">política de privacidade</a>.</span></label>` : ""}
          <button id="mdq-ok">${T[2]}</button>
          <div class="lk">${modo === "entrar" ? `<a data-m="criar">Criar conta</a><a data-m="esqueci">Esqueci a senha</a>` : modo !== "nova" ? `<a data-m="entrar">Voltar para entrar</a>` : ""}</div>
          <div class="msg ${tipo || ""}">${msg || ""}</div>`;
        cx.querySelectorAll("[data-m]").forEach((a) => a.onclick = () => { modo = a.dataset.m; desenhar(); });
        cx.querySelectorAll("input").forEach((i) => i.onkeydown = (e) => { if (e.key === "Enter") enviar(); });
        cx.querySelector("#mdq-ok").onclick = enviar;
      };
      async function enviar() {
        const email = (cx.querySelector("#mdq-email") || {}).value?.trim();
        const senha = (cx.querySelector("#mdq-senha") || {}).value || "";
        const b = cx.querySelector("#mdq-ok"); b.disabled = true;
        try {
          if (modo === "entrar") {
            const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
            if (error) throw error;
            box.remove(); resolve(data.session); return;
          }
          if (modo === "criar") {
            if (!cx.querySelector("#mdq-aceite").checked) throw new Error("Para criar a conta, aceite os termos de uso e a política de privacidade.");
            if (senha.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
            const { data, error } = await sb.auth.signUp({ email, password: senha, options: { emailRedirectTo: location.origin, data: { aceite_termos: new Date().toISOString() } } });
            if (error) throw error;
            if (data.session) { box.remove(); resolve(data.session); return; }
            modo = "entrar"; desenhar("Conta criada. Abra o e-mail de confirmação que enviamos para " + email + " e depois entre aqui.", "ok"); return;
          }
          if (modo === "esqueci") {
            const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
            if (error) throw error;
            desenhar("Se houver uma conta com esse e-mail, o link chega em alguns minutos.", "ok"); return;
          }
          if (modo === "nova") {
            if (senha.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
            const { error } = await sb.auth.updateUser({ password: senha });
            if (error) throw error;
            const { data } = await sb.auth.getSession(); box.remove(); resolve(data.session); return;
          }
        } catch (e) {
          desenhar(traduzErro(e), "erro");
        }
      }
      desenhar();
      const pôr = () => document.body.appendChild(box);
      document.body ? pôr() : document.addEventListener("DOMContentLoaded", pôr);
    });
  }

  function traduzErro(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/Invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
    if (/Email not confirmed/i.test(m)) return "Confirme o cadastro pelo link enviado ao seu e-mail.";
    if (/already registered/i.test(m)) return "Já existe uma conta com esse e-mail. Use “Entrar” ou “Esqueci a senha”.";
    if (/rate limit/i.test(m)) return "Muitas tentativas seguidas. Aguarde alguns minutos.";
    if (/Password should be/i.test(m)) return "A senha é fraca demais. Use pelo menos 8 caracteres, misturando letras e números.";
    return m;
  }

  let sessaoPronta = null;
  let modoRecuperacao = false;
  sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") modoRecuperacao = true; });

  function garantirSessao() {
    if (!sessaoPronta) sessaoPronta = (async () => {
      const { data } = await sb.auth.getSession();
      if (/type=recovery/.test(location.hash) || modoRecuperacao) return telaLogin("nova");
      if (data.session) return data.session;
      return telaLogin("entrar");
    })().then((s) => { mostrarConta(s); return s; });
    return sessaoPronta;
  }
  async function token() { const { data } = await sb.auth.getSession(); return data.session && data.session.access_token; }

  function mostrarConta(s) {
    if (!s || document.getElementById("mdq-conta")) return;
    estilo();
    const c = el(`<div id="mdq-conta"><span></span><a>Sair</a></div>`);
    c.firstChild.textContent = s.user.email;
    c.querySelector("a").onclick = async () => { await sb.auth.signOut(); location.reload(); };
    ehEquipe().then((eq) => { if (!eq) return;
      const imp = document.createElement("a"); imp.textContent = "Importar área comum"; imp.onclick = escolherImportacao; c.appendChild(imp); });
    const pôr = () => document.body.appendChild(c);
    document.body ? pôr() : document.addEventListener("DOMContentLoaded", pôr);
  }

  let papel = null;
  async function ehEquipe() {
    if (papel === null) {
      const s = await garantirSessao();
      const { data } = await sb.from("perfis").select("papel").eq("id", s.user.id).maybeSingle();
      papel = (data && data.papel) || "aluno";
    }
    return papel === "equipe";
  }

  /* ------------------------------------------------------------------
     DB — mesma "cara" do banco do claude.ai (doc / collection)
     ------------------------------------------------------------------ */
  const limpa = (p) => String(p).replace(/^\/+|\/+$/g, "");
  const pai = (p) => p.split("/").slice(0, -1).join("/");
  const ultimo = (p) => p.split("/").pop();
  const erroDb = (error) => { const e = new Error(error.message || "erro no banco"); e.code = error.code === "42501" ? "permission-denied" : (error.code || "db"); throw e; };
  const semIndefinidos = (o) => JSON.parse(JSON.stringify(o === undefined ? {} : o));
  const OPS = { "==": "eq", "!=": "neq", ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" };

  function snapDoc(caminho, linha) {
    return { id: ultimo(caminho), ref: docRef(caminho), exists: !!linha, data: () => (linha ? linha.dados : undefined) };
  }

  function docRef(caminho) {
    caminho = limpa(caminho);
    return {
      id: ultimo(caminho), path: caminho,
      collection: (nome) => colRef(caminho + "/" + limpa(nome)),
      async get() {
        await garantirSessao();
        const { data, error } = await sb.from("documentos").select("dados").eq("caminho", caminho).maybeSingle();
        if (error) erroDb(error);
        return snapDoc(caminho, data);
      },
      async set(dados) {
        await garantirSessao();
        const { error } = await sb.from("documentos").upsert(
          { caminho, colecao: pai(caminho), doc_id: ultimo(caminho), dados: semIndefinidos(dados) },
          { onConflict: "caminho" });
        if (error) erroDb(error);
      },
      async update(dados) {
        await garantirSessao();
        const { data, error } = await sb.from("documentos").select("dados").eq("caminho", caminho).maybeSingle();
        if (error) erroDb(error);
        if (!data) { const e = new Error("documento não existe"); e.code = "not-found"; throw e; }
        const { error: e2 } = await sb.from("documentos").update({ dados: { ...data.dados, ...semIndefinidos(dados) } }).eq("caminho", caminho);
        if (e2) erroDb(e2);
      },
      async delete() {
        await garantirSessao();
        const { error } = await sb.from("documentos").delete().eq("caminho", caminho);
        if (error) erroDb(error);
      },
    };
  }

  function colRef(caminho, filtros = [], ordem = null, lim = null) {
    caminho = limpa(caminho);
    const q = {
      id: ultimo(caminho), path: caminho,
      doc: (id) => docRef(caminho + "/" + limpa(id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)))),
      where: (campo, op, valor) => colRef(caminho, [...filtros, [campo, op, valor]], ordem, lim),
      orderBy: (campo, dir) => colRef(caminho, filtros, [campo, dir === "desc"], lim),
      limit: (n) => colRef(caminho, filtros, ordem, n),
      async add(dados) { const d = q.doc(); await d.set(dados); return d; },
      async get() {
        await garantirSessao();
        const PAG = 1000; let linhas = [];
        for (let de = 0; ; de += PAG) {
          let b = sb.from("documentos").select("caminho,dados").eq("colecao", caminho);
          for (const [campo, op, valor] of filtros) {
            const col = campo === "__name__" ? "doc_id" : "dados->>" + campo;
            if (op === "in") b = b.in(col, valor.map(String));
            else if (op === "array-contains") b = b.contains("dados->" + campo, JSON.stringify([valor]));
            else if (OPS[op]) b = b.filter(col, OPS[op], String(valor));
          }
          const desig = filtros.find(([, op]) => /[<>]/.test(op));
          if (ordem) b = b.order("dados->>" + ordem[0], { ascending: !ordem[1] });
          else if (desig) b = b.order("dados->>" + desig[0], { ascending: true });
          else b = b.order("doc_id", { ascending: true });
          const quer = lim ? Math.min(PAG, lim - linhas.length) : PAG;
          const { data, error } = await b.range(de, de + quer - 1);
          if (error) erroDb(error);
          linhas = linhas.concat(data || []);
          if (!data || data.length < quer || (lim && linhas.length >= lim)) break;
        }
        const docs = linhas.map((l) => snapDoc(l.caminho, l));
        return { docs, size: docs.length, empty: !docs.length, forEach: (f) => docs.forEach(f) };
      },
    };
    return q;
  }

  const DB = { doc: docRef, collection: colRef };

  /* ------------------------------------------------------------------
     SAMPLE — a IA, sempre pelo servidor /api/claude
     ------------------------------------------------------------------ */
  async function blobParaImagem(blob) {
    // reduz fotos grandes para caber no envio (máx. ~1600 px, JPEG)
    try {
      const bmp = await createImageBitmap(blob);
      const esc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(bmp.width * esc); cv.height = Math.round(bmp.height * esc);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      const url = cv.toDataURL("image/jpeg", 0.82);
      return { media_type: "image/jpeg", data: url.split(",")[1] };
    } catch {
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { media_type: blob.type || "image/jpeg", data: btoa(s) };
    }
  }

  async function sample(entrada, opcoes = {}) {
    await garantirSessao();
    const corpo = { modelTier: opcoes.modelTier || "default" };
    if (Array.isArray(entrada)) { corpo.messages = entrada; corpo.tipo = "professor"; }
    else corpo.prompt = String(entrada);
    if (opcoes.tipo) corpo.tipo = opcoes.tipo;
    if (opcoes.images && opcoes.images.length) corpo.images = await Promise.all([...opcoes.images].map(blobParaImagem));

    let r;
    try {
      r = await fetch("/api/claude", {
        method: "POST", signal: opcoes.signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await token()) },
        body: JSON.stringify(corpo),
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw { code: "cancelled" };
      throw { code: "cors", message: "Sem conexão com o servidor." };
    }
    if (!r.ok) {
      let j = {}; try { j = await r.json(); } catch {}
      throw { code: j.code || "http_" + r.status, message: j.message, cota: j.cota };
    }
    const leitor = r.body.getReader(); const dec = new TextDecoder();
    let buf = "", texto = "", fim = null;
    try {
      for (;;) {
        const { value, done } = await leitor.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const linha = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!linha.trim()) continue;
          const ev = JSON.parse(linha);
          if (ev.t === "delta") { texto += ev.text; if (opcoes.onText) try { opcoes.onText({ text: texto }); } catch {} }
          else if (ev.t === "error") throw { code: ev.code || "erro", message: ev.message };
          else if (ev.t === "done") fim = ev;
        }
      }
    } catch (e) {
      if (e && e.name === "AbortError") throw { code: "cancelled" };
      throw e;
    }
    if (fim && fim.cota) window.mdqUltimaCota = fim.cota;
    return { text: fim ? fim.text : texto, stopReason: fim && fim.stop_reason };
  }

  function extrairJSON(t) {
    if (!t) return null;
    let s = String(t).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try { return JSON.parse(s); } catch {}
    const a = Math.min(...["{", "["].map((c) => { const i = s.indexOf(c); return i < 0 ? Infinity : i; }));
    const z = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (a < Infinity && z > a) { try { return JSON.parse(s.slice(a, z + 1)); } catch {} }
    return null;
  }
  sample.json = async (entrada, opcoes = {}) => {
    const r = await sample(entrada, opcoes);
    const j = extrairJSON(r.text);
    if (j === null) throw { code: "invalid_json", message: "resposta fora do formato" };
    return j;
  };
  sample.limits = async () => ({ images: true, maxImages: 20 });

  /* ------------------------------------------------------------------
     DOWNLOADS
     ------------------------------------------------------------------ */
  const DOWNLOADS = {
    async save({ filename, data, mimeType }) {
      const b = data instanceof Blob ? data : new Blob([data], { type: mimeType || "application/octet-stream" });
      const u = URL.createObjectURL(b); const a = document.createElement("a");
      a.href = u; a.download = filename || "arquivo"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 5000);
      return { ok: true };
    },
  };

  /* ------------------------------------------------------------------
     ASSETS — arquivos (PDFs, pacotes) no Supabase Storage
     ------------------------------------------------------------------ */
  const LIMITE_ARQUIVOS = 1000, LIMITE_BYTES = 1024 * 1024 * 1024;
  const ASSETS = {
    async upload(blob, opcoes = {}) {
      const s = await garantirSessao();
      const pasta = (await ehEquipe()) ? "comum" : s.user.id;
      const id = pasta + "/" + crypto.randomUUID().replace(/-/g, "");
      const { error } = await sb.storage.from(BUCKET).upload(id, blob, { contentType: opcoes.type || blob.type || "application/octet-stream", upsert: false });
      if (error) { const e = new Error(error.message); e.code = "upload"; throw e; }
      return { id, sizeBytes: blob.size };
    },
    async list() {
      const s = await garantirSessao();
      const { data, error } = await sb.storage.from(BUCKET).list(s.user.id, { limit: LIMITE_ARQUIVOS });
      if (error) throw error;
      const arquivos = (data || []).filter((f) => f.id);
      const bytes = arquivos.reduce((t, f) => t + ((f.metadata && f.metadata.size) || 0), 0);
      return { assets: arquivos.map((f) => ({ id: s.user.id + "/" + f.name, sizeBytes: (f.metadata && f.metadata.size) || 0 })),
               usage: { files: arquivos.length, maxFiles: LIMITE_ARQUIVOS, bytes, maxBytes: LIMITE_BYTES } };
    },
    async delete(id) {
      await garantirSessao();
      const { error } = await sb.storage.from(BUCKET).remove([id]);
      if (error) throw error;
    },
  };

  // O programa lê arquivos em "/_blob/<id>": aqui isso vira leitura no Storage.
  // Ids antigos do claude.ai (sem "/") são procurados na pasta comum/.
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async function (url, opcoes) {
    const u = typeof url === "string" ? url : url && url.url;
    if (u && u.startsWith("/_blob/")) {
      await garantirSessao();
      let id = decodeURIComponent(u.slice(7));
      if (!id.includes("/")) id = "comum/" + id;
      const { data, error } = await sb.storage.from(BUCKET).download(id);
      if (error || !data) return new Response("não encontrado", { status: 404 });
      return new Response(data, { status: 200, headers: { "Content-Type": data.type || "application/json" } });
    }
    return fetchOriginal(url, opcoes);
  };

  /* ------------------------------------------------------------------
     MIGRAÇÃO — importa os arquivos "mdq-comum-*.json" exportados no claude.ai
     (só aparece para a equipe)
     ------------------------------------------------------------------ */
  function escolherImportacao() {
    const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = ".json,application/json";
    inp.onchange = () => importarComum([...inp.files]); inp.click();
  }
  async function importarComum(arquivos) {
    if (!arquivos.length) return;
    const aviso = (m) => { const s = document.querySelector("#mdq-conta span"); if (s) s.textContent = m; };
    let docs = 0, pacotes = 0, falhas = [];
    try {
      for (const [i, f] of arquivos.entries()) {
        aviso(`lendo ${i + 1}/${arquivos.length}: ${f.name}`);
        let j; try { j = JSON.parse(await f.text()); } catch { falhas.push(f.name + " (não é JSON)"); continue; }
        if (!j || j.tipo !== "mdq-comum") { falhas.push(f.name + " (não é arquivo de migração)"); continue; }
        const lista = (j.docs || []).map((d) => { const c = limpa(d.caminho); return { caminho: c, colecao: pai(c), doc_id: ultimo(c), dados: d.dados || {} }; });
        for (let k = 0; k < lista.length; k += 200) {
          aviso(`${f.name}: gravando ${Math.min(k + 200, lista.length)}/${lista.length}`);
          const { error } = await sb.from("documentos").upsert(lista.slice(k, k + 200), { onConflict: "caminho" });
          if (error) throw new Error(f.name + ": " + error.message);
        }
        docs += lista.length;
        for (const a of j.assets || []) {
          aviso(`${f.name}: enviando pacote ${a.id}`);
          const id = a.id.includes("/") ? a.id : "comum/" + a.id;
          const { error } = await sb.storage.from(BUCKET).upload(id, new Blob([a.conteudo], { type: a.contentType || "application/json" }), { upsert: true, contentType: a.contentType || "application/json" });
          if (error) throw new Error("pacote " + a.id + ": " + error.message);
          pacotes++;
        }
      }
      alert(`Importação concluída: ${docs} registros e ${pacotes} pacote(s).` + (falhas.length ? "\n\nIgnorados:\n" + falhas.join("\n") : "") + "\n\nRecarregue a página para ver o conteúdo.");
    } catch (e) {
      alert("A importação parou: " + (e.message || e) + `\n\nJá gravados: ${docs} registros e ${pacotes} pacote(s). Pode repetir a importação: o que já entrou é apenas regravado.`);
    }
    const { data } = await sb.auth.getSession(); aviso(data.session ? data.session.user.email : "");
  }

  /* ------------------------------------------------------------------
     claude.use(...)
     ------------------------------------------------------------------ */
  window.claude = {
    async use(nome) {
      if (nome === "user") { const s = await garantirSessao(); return { id: async () => s.user.id, email: async () => s.user.email }; }
      if (nome === "db") { await garantirSessao(); return DB; }
      if (nome === "sample") { await garantirSessao(); return sample; }
      if (nome === "downloads") return DOWNLOADS;
      if (nome === "assets") { await garantirSessao(); return ASSETS; }
      throw { code: "unavailable", message: nome + " não está disponível no site" };
    },
  };

  // mensagens de cota/plano aparecem com o texto claro do servidor
  window.addEventListener("load", () => {
    const orig = window.erroMsg;
    if (typeof orig !== "function") return;
    const PROPRIOS = ["cota_esgotada", "sem_plano", "rede", "servidor", "chave_servidor", "cors"];
    window.erroMsg = (e) => (e && e.message && PROPRIOS.includes(e.code)) ? e.message : orig(e);
  });

  // pede o login já ao abrir a página
  garantirSessao();
})();
