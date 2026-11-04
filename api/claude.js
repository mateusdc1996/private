// =====================================================================
// MDQuest · /api/claude — o "balcão" entre o aluno e a IA
// 1. confere quem é o aluno (login do Supabase)
// 2. confere se ele ainda tem cota no ciclo
// 3. chama a Anthropic com a chave guardada SÓ aqui no servidor
// 4. registra o uso — apenas se a chamada terminar bem
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY     chave da Anthropic
//   SUPABASE_URL          https://<projeto>.supabase.co
//   SUPABASE_SECRET_KEY   "Secret key" (service_role) do Supabase
//   MODELO_QUICK / MODELO_DEFAULT / MODELO_COMPLEX   (opcionais)
// =====================================================================

const MODELOS = {
  quick:   process.env.MODELO_QUICK   || "claude-haiku-5-5",
  default: process.env.MODELO_DEFAULT || "claude-sonnet-5-5",
  complex: process.env.MODELO_COMPLEX || "claude-opus-5-5",
};
const MAX_TOKENS = { quick: 4096, default: 16000, complex: 32000 };

function evento(res, obj) { res.write(JSON.stringify(obj) + "\n"); }

async function supa(caminho, opcoes = {}) {
  const r = await fetch(process.env.SUPABASE_URL + caminho, {
    ...opcoes,
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: "Bearer " + process.env.SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
      ...(opcoes.headers || {}),
    },
  });
  if (!r.ok) throw new Error("supabase " + r.status + " " + (await r.text()).slice(0, 200));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function quemE(token) {
  const r = await fetch(process.env.SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: process.env.SUPABASE_SECRET_KEY, Authorization: "Bearer " + token },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

function montarMensagens(corpo) {
  let msgs;
  if (Array.isArray(corpo.messages)) {
    msgs = corpo.messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: m.content }));
  } else {
    msgs = [{ role: "user", content: String(corpo.prompt || "") }];
  }
  // imagens (fotos de prova, PDF digitalizado) vão junto da última mensagem do aluno
  if (Array.isArray(corpo.images) && corpo.images.length) {
    const ult = msgs[msgs.length - 1];
    const texto = typeof ult.content === "string" ? [{ type: "text", text: ult.content }] : ult.content;
    const imgs = corpo.images.slice(0, 20).map((im) => ({
      type: "image",
      source: { type: "base64", media_type: im.media_type || "image/jpeg", data: im.data },
    }));
    ult.content = [...imgs, ...texto];
  }
  return msgs;
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ code: "method" }); return; }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = token && (await quemE(token));
  if (!user) { res.status(401).json({ code: "not_granted", message: "Entre na sua conta para usar a IA." }); return; }

  const corpo = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const tipo = corpo.tipo === "professor" ? "professor" : "geral";
  const tier = MODELOS[corpo.modelTier] ? corpo.modelTier : "default";

  // ---- cota: decide ANTES de gastar com a API ----
  let cota;
  try {
    cota = await supa("/rest/v1/rpc/situacao_cota", {
      method: "POST", body: JSON.stringify({ p_user: user.id, p_tipo: tipo }),
    });
  } catch (e) {
    res.status(500).json({ code: "servidor", message: "Não consegui verificar sua cota agora. Tente de novo em instantes." });
    return;
  }
  if (!cota || !cota.permitido) {
    const sem = cota && cota.motivo === "sem_plano";
    res.status(402).json({
      code: sem ? "sem_plano" : "cota_esgotada",
      message: sem
        ? "Seu plano atual não inclui geração pela IA. Assine um plano ou cluster para liberar."
        : `Você usou as ${cota.limite} chamadas do seu plano neste ciclo. A cota renova em ${cota.renova_em}; se preferir, assine um cluster adicional.`,
      cota,
    });
    return;
  }

  // ---- chamada à Anthropic (com streaming) ----
  const modelo = MODELOS[tier];
  const controle = new AbortController();
  req.on("close", () => { if (!res.writableEnded) controle.abort(); });

  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controle.signal,
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: MAX_TOKENS[tier],
        stream: true,
        ...(corpo.system ? { system: String(corpo.system) } : {}),
        messages: montarMensagens(corpo),
      }),
    });
  } catch (e) {
    res.status(502).json({ code: "rede", message: "A IA não respondeu. Tente de novo; nada foi descontado da sua cota." });
    return;
  }

  if (!resp.ok) {
    const txt = await resp.text();
    const code = resp.status === 429 || resp.status === 529 ? "rate_limited"
      : /prompt is too long|too many tokens/i.test(txt) ? "prompt_too_large"
      : resp.status === 401 ? "chave_servidor" : "api_" + resp.status;
    console.error("anthropic", resp.status, txt.slice(0, 500));
    res.status(resp.status === 429 ? 429 : 502).json({ code, message: "A IA recusou o pedido (" + code + "). Nada foi descontado da sua cota." });
    return;
  }

  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });

  let texto = "", entrada = 0, saida = 0, parada = null, buffer = "";
  try {
    const leitor = resp.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const linha = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
        if (!linha.startsWith("data:")) continue;
        let ev; try { ev = JSON.parse(linha.slice(5)); } catch { continue; }
        if (ev.type === "message_start") entrada = ev.message?.usage?.input_tokens || 0;
        else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          texto += ev.delta.text; evento(res, { t: "delta", text: ev.delta.text });
        } else if (ev.type === "message_delta") {
          saida = ev.usage?.output_tokens || saida; parada = ev.delta?.stop_reason || parada;
        } else if (ev.type === "error") {
          throw new Error(ev.error?.type || "erro");
        }
      }
    }
  } catch (e) {
    if (!res.writableEnded) { evento(res, { t: "error", code: controle.signal.aborted ? "cancelled" : "rede", message: "A resposta foi interrompida. Nada foi descontado da sua cota." }); res.end(); }
    return; // não conta o uso
  }

  if (parada === "refusal") {
    evento(res, { t: "error", code: "refused" }); res.end(); return;
  }

  // ---- registra o uso (só chega aqui se a chamada terminou bem) ----
  try {
    await supa("/rest/v1/consumo_api", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: user.id, tipo, modelo, tokens_entrada: entrada, tokens_saida: saida }),
    });
  } catch (e) { console.error("registro de consumo falhou", e.message); }

  evento(res, { t: "done", text: texto, stop_reason: parada, cota: { ...cota, usado: (cota.usado || 0) + 1 } });
  res.end();
}
