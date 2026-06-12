'use strict';

/* ════════════════════════════════════════════════════════════════
   MKD Conversor — lógica da ferramenta
   Backends: API mkd-pandoc (/converter, /saude) + SML Storage API
═════════════════════════════════════════════════════════════════ */

/* ── Constantes e estado ─────────────────────────────────────── */
const PADROES = {
  endpoint:    'http://localhost:8000',
  smlEndpoint: 'https://us-east1-sml-storage.cloudfunctions.net',
  smlProjeto:  'mkd-pdf'
};
const CAMPOS_FM = ['turma', 'disciplina', 'professor', 'capitulo',
                   'apontamento', 'titulo', 'subtitulo', 'unidade', 'ano'];
const RODAPES = ['rodape1', 'rodape2', 'rodape3'];
const DEBOUNCE_MS = 600;
const MAX_HISTORICO = 10;

const $ = (id) => document.getElementById(id);
const editor = $('editor');

// Campos editados manualmente: o valor digitado sobrepõe o YAML colado.
const camposSujos = new Set();
const rodapesSujos = new Set();

// Último arquivo gerado (Blob) — usado pelo botão Download.
let ultimoArquivo = null;
let ultimoNomeArquivo = 'documento.pdf';
let contadorMermaid = 0;

/* ════════════════════════════════════════════════════════════════
   CONFIGURAÇÃO (localStorage: mkd_config)
═════════════════════════════════════════════════════════════════ */
function carregarConfig() {
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem('mkd_config') || '{}'); } catch (e) {}
  $('cfg-endpoint').value     = cfg.endpoint    || '';
  $('cfg-apikey').value       = cfg.apiKey      || '';
  // SML endpoint e projeto vêm pré-preenchidos com os padrões
  $('cfg-sml-endpoint').value = cfg.smlEndpoint || PADROES.smlEndpoint;
  $('cfg-sml-apikey').value   = cfg.smlApiKey   || '';
  $('cfg-sml-projeto').value  = cfg.smlProjeto  || PADROES.smlProjeto;
}

function salvarConfig() {
  localStorage.setItem('mkd_config', JSON.stringify({
    endpoint:    $('cfg-endpoint').value.trim(),
    apiKey:      $('cfg-apikey').value.trim(),
    smlEndpoint: $('cfg-sml-endpoint').value.trim(),
    smlApiKey:   $('cfg-sml-apikey').value.trim(),
    smlProjeto:  $('cfg-sml-projeto').value.trim()
  }));
  const fb = $('feedback-salvo');
  fb.classList.add('visivel');
  setTimeout(() => fb.classList.remove('visivel'), 1800);
  toast('Configurações salvas');
}

function configAtual() {
  return {
    endpoint:    ($('cfg-endpoint').value.trim()     || PADROES.endpoint).replace(/\/+$/, ''),
    apiKey:       $('cfg-apikey').value.trim(),
    smlEndpoint: ($('cfg-sml-endpoint').value.trim() || PADROES.smlEndpoint).replace(/\/+$/, ''),
    smlApiKey:    $('cfg-sml-apikey').value.trim(),
    smlProjeto:   $('cfg-sml-projeto').value.trim()  || PADROES.smlProjeto
  };
}

/* Teste de conexão — GET /saude (rota pública da API mkd-pandoc) */
async function testarConexao() {
  const el = $('status-conexao');
  el.className = '';
  el.textContent = 'Verificando…';
  try {
    const r = await fetch(configAtual().endpoint + '/saude');
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      el.className = 'ok';
      el.textContent = '✓ API acessível' + (d.status ? ' — ' + d.status : '');
    } else {
      el.className = 'falha';
      el.textContent = '✕ API respondeu HTTP ' + r.status;
    }
  } catch (e) {
    el.className = 'falha';
    el.textContent = '✕ Sem conexão (endpoint ou CORS)';
  }
}

/* Olhinho dos campos de senha */
document.querySelectorAll('.btn-olho').forEach((btn) => {
  btn.addEventListener('click', () => {
    const alvo = $(btn.dataset.alvo);
    alvo.type = (alvo.type === 'password') ? 'text' : 'password';
  });
});

/* ════════════════════════════════════════════════════════════════
   FRONT MATTER YAML — leitura, geração e fusão
═════════════════════════════════════════════════════════════════ */
const RE_YAML = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

function lerFrontMatter(md) {
  const m = md.match(RE_YAML);
  if (!m) return {};
  const dados = {};
  m[1].split(/\r?\n/).forEach((linha) => {
    const par = linha.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!par) return;
    let valor = par[2].trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    dados[par[1]] = valor;
  });
  return dados;
}

function aspas(v) { return '"' + String(v).replace(/"/g, '\\"') + '"'; }

function camposAtuais() {
  const c = {};
  CAMPOS_FM.forEach((nome) => { c[nome] = $('fm-' + nome).value.trim(); });
  RODAPES.forEach((nome) => {
    c[nome] = rodapesSujos.has(nome) ? $('fm-' + nome).value.trim() : '';
  });
  return c;
}

function buildFrontMatter(f) {
  const linhas = ['---'];
  if (f.turma)       linhas.push('turma: ' + f.turma);
  if (f.disciplina)  linhas.push('disciplina: ' + f.disciplina);
  if (f.professor)   linhas.push('professor: ' + f.professor);
  if (f.capitulo && !f.apontamento)
                     linhas.push('capitulo: ' + aspas(f.capitulo));
  if (f.apontamento && !f.capitulo)
                     linhas.push('apontamento: ' + aspas(f.apontamento));
  if (f.titulo)      linhas.push('titulo: ' + aspas(f.titulo));
  if (f.subtitulo)   linhas.push('subtitulo: ' + aspas(f.subtitulo));
  if (f.unidade)     linhas.push('unidade: ' + f.unidade);
  if (f.ano)         linhas.push('ano: ' + aspas(f.ano));
  if (f.rodape1)     linhas.push('rodape1: ' + aspas(f.rodape1));
  if (f.rodape2)     linhas.push('rodape2: ' + aspas(f.rodape2));
  if (f.rodape3)     linhas.push('rodape3: ' + aspas(f.rodape3));
  linhas.push('---');
  return linhas.join('\n');
}

function mergeMarkdown(rawMd, fields) {
  const semYaml = rawMd.replace(RE_YAML, '');
  return buildFrontMatter(fields) + '\n\n' + semYaml.replace(/^\s*\n/, '');
}

/* Preenche os campos do cabeçalho com o YAML colado (sem sobrepor
   campos editados manualmente). */
function sincronizarCamposComYaml() {
  const yaml = lerFrontMatter(editor.value);
  CAMPOS_FM.forEach((nome) => {
    if (camposSujos.has(nome)) return;
    // capitulo e apontamento são exclusivos: se o YAML trouxer os dois,
    // capitulo vence.
    if (nome === 'apontamento' && yaml.capitulo) { $('fm-apontamento').value = ''; return; }
    $('fm-' + nome).value = yaml[nome] !== undefined ? yaml[nome] : '';
  });
  RODAPES.forEach((nome) => {
    if (rodapesSujos.has(nome)) return;
    if (yaml[nome] !== undefined) {
      $('fm-' + nome).value = yaml[nome];
      rodapesSujos.add(nome);   // valor explícito no YAML conta como customizado
    }
  });
  atualizarRodapesAuto();
}

/* ════════════════════════════════════════════════════════════════
   RODAPÉS AUTOMÁTICOS (linhas montadas a partir do cabeçalho)
═════════════════════════════════════════════════════════════════ */
function linhasRodapeAuto(f) {
  const j = (partes, sep) => partes.filter(Boolean).join(sep);
  return {
    rodape1: 'CENTRO TERRITORIAL DE EDUCAÇÃO PROFISSIONAL DO LITORAL NORTE E AGRESTE BAIANO — CETEP-LNAB',
    rodape2: j([
      f.turma      && ('Turma: ' + f.turma),
      f.disciplina && ('Disciplina: ' + f.disciplina),
      f.professor  && ('Prof.: ' + f.professor),
      f.ano
    ], ' · '),
    rodape3: j(['CETEP-LNAB', f.disciplina, f.unidade], ' · ') +
             (f.professor ? ' © ' + f.professor : '') +
             (f.ano ? ' · ' + f.ano : '')
  };
}

function atualizarRodapesAuto() {
  const auto = linhasRodapeAuto(camposAtuais());
  RODAPES.forEach((nome) => {
    const input = $('fm-' + nome);
    input.placeholder = auto[nome];
    if (!rodapesSujos.has(nome)) input.value = '';
  });
}

/* ════════════════════════════════════════════════════════════════
   PREVIEW AO VIVO — marked.js + mermaid.js (100% local, sem API)
═════════════════════════════════════════════════════════════════ */
marked.use({ gfm: true, breaks: false });

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'loose',
  themeVariables: {
    primaryColor:       '#D6E8F8',
    primaryBorderColor: '#004B8D',
    primaryTextColor:   '#004B8D',
    lineColor:          '#b0bdd4',
    secondaryColor:     '#D0F0E3',
    tertiaryColor:      '#FFF9C4',
    fontFamily:         'Nunito, sans-serif',
    fontSize:           '13px'
  }
});

const BLOCOS_VALIDOS = ['conceito', 'dica', 'atencao', 'exemplo', 'reflexao',
                        'saibamais', 'exercicios', 'leitura', 'referencias'];

/* Converte os fenced divs do Pandoc (::: classe ... :::) em <div>,
   renderizando o miolo com marked. Blocos ``` são respeitados para
   que ::: dentro de código não seja interpretado. */
function renderizarComBlocos(md) {
  const linhas = md.split('\n');
  let html = '';
  let buffer = [];
  let abertos = 0;
  let dentroDeCodigo = false;

  const despejar = () => {
    if (buffer.length) { html += marked.parse(buffer.join('\n')); buffer = []; }
  };

  for (const linha of linhas) {
    if (/^\s*(```|~~~)/.test(linha)) dentroDeCodigo = !dentroDeCodigo;
    if (!dentroDeCodigo) {
      const abre = linha.match(/^:{3,}\s*\{?\.?([A-Za-z][\w-]*)\}?\s*$/);
      const fecha = /^:{3,}\s*$/.test(linha);
      if (abre) {
        const classe = abre[1].toLowerCase();
        despejar();
        abertos++;
        html += '<div class="bloco ' + (BLOCOS_VALIDOS.includes(classe) ? classe : 'conceito') + '">';
        continue;
      }
      if (fecha && abertos > 0) {
        despejar();
        abertos--;
        html += '</div>';
        continue;
      }
    }
    buffer.push(linha);
  }
  despejar();
  while (abertos-- > 0) html += '</div>';
  return html;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
}

/* Cabeçalho simulado do documento (badge + título + subtítulo) */
function cabecalhoPreview(f) {
  let h = '';
  if (f.capitulo && !f.apontamento) {
    h += '<div class="doc-badge"><span class="dot"></span>Capítulo ' + escapeHtml(f.capitulo) + '</div>';
  } else if (f.apontamento) {
    h += '<div class="doc-badge apontamento">&#x1F4DD; ' + escapeHtml(f.apontamento) + '</div>';
  }
  if (f.titulo)    h += '<div class="doc-titulo">' + escapeHtml(f.titulo) + '</div>';
  if (f.subtitulo) h += '<div class="doc-subtitulo">' + escapeHtml(f.subtitulo) + '</div>';
  return h;
}

function atualizarPreview() {
  const corpo = editor.value.replace(RE_YAML, '');
  const alvo = $('preview');
  alvo.innerHTML = cabecalhoPreview(camposAtuais()) + renderizarComBlocos(corpo);

  // Imagens quebradas (404 / CORS) → placeholder cinza com o alt
  alvo.querySelectorAll('img').forEach((img) => {
    const substituir = () => {
      const ph = document.createElement('div');
      ph.className = 'img-quebrada';
      ph.textContent = '🖼 ' + (img.alt || 'imagem indisponível');
      img.replaceWith(ph);
    };
    if (img.complete && img.naturalWidth === 0 && img.src) substituir();
    else img.addEventListener('error', substituir, { once: true });
  });

  // Blocos ```mermaid → <div class="mermaid"> renderizado
  const pendentes = [];
  alvo.querySelectorAll('pre code.language-mermaid, pre code.mermaid').forEach((code) => {
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.id = 'mmd-' + (++contadorMermaid);
    div.textContent = code.textContent;
    code.parentElement.replaceWith(div);
    pendentes.push(div);
  });
  if (pendentes.length) {
    mermaid.run({ nodes: pendentes }).catch(() => {
      pendentes.forEach((d) => {
        if (!d.querySelector('svg')) {
          d.innerHTML = '<em style="color:var(--vermelho-erro);font-size:12px;">Erro de sintaxe no diagrama Mermaid</em>';
        }
      });
    });
  }
}

function atualizarCodigoBruto() {
  $('codigo-bruto-code').textContent = editor.value;
}

function atualizarContador() {
  const t = editor.value;
  const palavras = (t.match(/\S+/g) || []).length;
  $('contador').textContent = palavras + ' palavra' + (palavras === 1 ? '' : 's') +
                              ' · ' + t.length + ' caractere' + (t.length === 1 ? '' : 's');
}

/* Pipeline completo após mudanças no editor */
function aoMudarEditor() {
  localStorage.setItem('mkd_last_md', editor.value);
  const agora = new Date();
  $('rascunho-info').textContent = 'Rascunho salvo às ' +
    agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  sincronizarCamposComYaml();
  atualizarPreview();
  atualizarCodigoBruto();
  atualizarContador();
}

/* ════════════════════════════════════════════════════════════════
   ABAS (Preview | Código bruto)
═════════════════════════════════════════════════════════════════ */
function ativarAba(idAba) {
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('ativa', t.dataset.aba === idAba));
  document.querySelectorAll('.aba').forEach((a) =>
    a.classList.toggle('ativa', a.id === idAba));
}
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => ativarAba(t.dataset.aba)));

$('btn-alternar-codigo').addEventListener('click', () => {
  const codigoAtivo = $('aba-codigo').classList.contains('ativa');
  ativarAba(codigoAtivo ? 'aba-preview' : 'aba-codigo');
});

$('btn-copiar-md').addEventListener('click', async () => {
  await copiarTexto(editor.value);
  toast('Markdown copiado');
});

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch (e) {
    // Fallback para file:// ou contextos sem Clipboard API
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/* ════════════════════════════════════════════════════════════════
   ARQUIVOS — abrir .md (botão + drag-and-drop) e baixar .md
═════════════════════════════════════════════════════════════════ */
function carregarArquivo(arquivo) {
  const leitor = new FileReader();
  leitor.onload = () => {
    editor.value = leitor.result;
    // Documento novo: o YAML dele passa a mandar nos campos
    camposSujos.clear();
    rodapesSujos.clear();
    aoMudarEditor();
    toast('Arquivo carregado: ' + arquivo.name);
  };
  leitor.readAsText(arquivo, 'utf-8');
}

$('arquivo-md').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) carregarArquivo(f);
  e.target.value = '';
});
$('btn-abrir').addEventListener('click', () => $('arquivo-md').click());

editor.addEventListener('dragover', (e) => {
  e.preventDefault();
  editor.classList.add('arrastando');
});
editor.addEventListener('dragleave', () => editor.classList.remove('arrastando'));
editor.addEventListener('drop', (e) => {
  e.preventDefault();
  editor.classList.remove('arrastando');
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) carregarArquivo(f);
});

function baixarMarkdown() {
  const blob = new Blob([mergeMarkdown(editor.value, camposAtuais())],
                        { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = slug($('fm-titulo').value) + '.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Markdown baixado (com YAML atualizado)');
}
$('btn-baixar-md').addEventListener('click', baixarMarkdown);

/* Limpar editor + campos */
$('btn-limpar').addEventListener('click', () => {
  if (editor.value.trim() &&
      !confirm('Limpar o editor e todos os campos do documento?')) return;
  editor.value = '';
  camposSujos.clear();
  rodapesSujos.clear();
  CAMPOS_FM.concat(RODAPES).forEach((n) => { $('fm-' + n).value = ''; });
  aoMudarEditor();
});

/* ════════════════════════════════════════════════════════════════
   EVENTOS DO EDITOR E DOS CAMPOS
═════════════════════════════════════════════════════════════════ */
let timerDebounce = null;
editor.addEventListener('input', () => {
  clearTimeout(timerDebounce);
  timerDebounce = setTimeout(aoMudarEditor, DEBOUNCE_MS);
});

/* Tab dentro do editor insere 2 espaços em vez de mudar o foco */
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
  }
});

CAMPOS_FM.forEach((nome) => {
  $('fm-' + nome).addEventListener('input', () => {
    camposSujos.add(nome);
    // capitulo ↔ apontamento: mutuamente exclusivos
    if (nome === 'capitulo' && $('fm-capitulo').value.trim()) {
      $('fm-apontamento').value = '';
      camposSujos.add('apontamento');
    }
    if (nome === 'apontamento' && $('fm-apontamento').value.trim()) {
      $('fm-capitulo').value = '';
      camposSujos.add('capitulo');
    }
    atualizarRodapesAuto();
    atualizarPreview();
  });
});

RODAPES.forEach((nome) => {
  $('fm-' + nome).addEventListener('input', () => {
    if ($('fm-' + nome).value.trim()) rodapesSujos.add(nome);
    else rodapesSujos.delete(nome);
  });
});

$('btn-salvar-config').addEventListener('click', salvarConfig);
$('btn-testar-conexao').addEventListener('click', testarConexao);

/* Formato de saída (PDF | HTML) */
const seletorFormato = $('formato');
function atualizarRotuloConverter() {
  $('btn-converter-rotulo').textContent =
    'Converter para ' + seletorFormato.value.toUpperCase();
}
seletorFormato.addEventListener('change', () => {
  localStorage.setItem('mkd_formato', seletorFormato.value);
  atualizarRotuloConverter();
});

/* Atalhos globais: Ctrl+Enter converte · Ctrl+S baixa o .md */
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    converter();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    baixarMarkdown();
  }
});

/* ════════════════════════════════════════════════════════════════
   TOAST
═════════════════════════════════════════════════════════════════ */
let timerToast = null;
function toast(mensagem) {
  const el = $('toast');
  el.textContent = mensagem;
  el.classList.add('visivel');
  clearTimeout(timerToast);
  timerToast = setTimeout(() => el.classList.remove('visivel'), 2200);
}

/* ════════════════════════════════════════════════════════════════
   HISTÓRICO DE CONVERSÕES (localStorage: mkd_historico)
═════════════════════════════════════════════════════════════════ */
function lerHistorico() {
  try { return JSON.parse(localStorage.getItem('mkd_historico') || '[]'); }
  catch (e) { return []; }
}

function adicionarHistorico(item) {
  const h = [item, ...lerHistorico()].slice(0, MAX_HISTORICO);
  localStorage.setItem('mkd_historico', JSON.stringify(h));
  renderizarHistorico();
}

function renderizarHistorico() {
  const lista = $('historico-lista');
  const itens = lerHistorico();
  lista.innerHTML = '';
  if (!itens.length) {
    lista.innerHTML = '<div class="historico-vazio">Nenhuma conversão ainda.</div>';
    return;
  }
  itens.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'historico-item';

    const info = document.createElement('div');
    info.className = 'info';
    const nome = document.createElement('div');
    nome.className = 'nome';
    nome.textContent = item.nome;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = (item.formato || 'pdf').toUpperCase() + ' · ' +
      formatarTamanho(item.tamanho) + ' · ' +
      new Date(item.data).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = item.url;
    info.append(nome, meta, link);

    const btnCopiar = document.createElement('button');
    btnCopiar.type = 'button';
    btnCopiar.className = 'btn btn-mini';
    btnCopiar.textContent = 'Copiar';
    btnCopiar.addEventListener('click', async () => {
      await copiarTexto(item.url);
      toast('Link copiado');
    });

    el.append(info, btnCopiar);
    lista.appendChild(el);
  });
}

$('btn-limpar-historico').addEventListener('click', () => {
  localStorage.removeItem('mkd_historico');
  renderizarHistorico();
});

/* ════════════════════════════════════════════════════════════════
   BARRA DE STATUS
═════════════════════════════════════════════════════════════════ */
const statusBar = $('status-bar');

function statusOcioso() {
  statusBar.className = 'status-bar';
  statusBar.classList.remove('visivel');
}

function statusProgresso(texto) {
  statusBar.className = 'status-bar visivel';
  $('status-texto').textContent = texto;
  $('status-progresso').style.display = '';
  $('status-url').style.display = 'none';
  $('status-acoes').innerHTML = '';
}

function botaoAcao(rotulo, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = rotulo;
  b.addEventListener('click', fn);
  return b;
}

function statusSucesso(url, tamanho, formato) {
  statusBar.className = 'status-bar visivel sucesso';
  $('status-texto').textContent =
    '✓ ' + formato.toUpperCase() + ' gerado — ' + formatarTamanho(tamanho);
  $('status-progresso').style.display = 'none';
  const a = $('status-url');
  if (url) { a.href = url; a.textContent = url; a.style.display = ''; }
  else a.style.display = 'none';

  const acoes = $('status-acoes');
  acoes.innerHTML = '';
  acoes.appendChild(botaoAcao('Download', baixarUltimoArquivo));
  if (url) {
    acoes.appendChild(botaoAcao('Copiar link', async () => {
      await copiarTexto(url);
      toast('Link copiado');
    }));
    acoes.appendChild(botaoAcao('Abrir', () => window.open(url, '_blank', 'noopener')));
  }
}

function statusErro(mensagem) {
  statusBar.className = 'status-bar visivel erro';
  $('status-texto').textContent = '✕ ' + mensagem;
  $('status-progresso').style.display = 'none';
  $('status-url').style.display = 'none';
  const acoes = $('status-acoes');
  acoes.innerHTML = '';
  if (ultimoArquivo) acoes.appendChild(botaoAcao('Download do arquivo', baixarUltimoArquivo));
  acoes.appendChild(botaoAcao('Tentar novamente', converter));
}

function baixarUltimoArquivo() {
  if (!ultimoArquivo) return;
  const url = URL.createObjectURL(ultimoArquivo);
  const a = document.createElement('a');
  a.href = url;
  a.download = ultimoNomeArquivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function formatarTamanho(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/* ════════════════════════════════════════════════════════════════
   CONVERSÃO + UPLOAD (somente no clique do botão / Ctrl+Enter)
   1. POST {endpoint}/converter            → bytes do PDF/HTML
   2. POST {sml}/getUploadUrl              → { uploadUrl, docId }
   3. PUT  uploadUrl
   4. POST {sml}/confirmUpload             → { url, size }
═════════════════════════════════════════════════════════════════ */
function slug(texto) {
  return (texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'documento';
}

async function lerErroHttp(resposta, contexto) {
  let detalhe = 'HTTP ' + resposta.status;
  try {
    const corpo = await resposta.text();
    try {
      const json = JSON.parse(corpo);
      detalhe = json.detail || json.error || corpo;
    } catch (e) { if (corpo) detalhe = corpo; }
  } catch (e) {}
  if (typeof detalhe !== 'string') detalhe = JSON.stringify(detalhe);
  return contexto + ': ' + detalhe.slice(0, 600);
}

async function converter() {
  const cfg = configAtual();
  const campos = camposAtuais();
  const formato = seletorFormato.value;            // 'pdf' | 'html'
  const mime = formato === 'pdf' ? 'application/pdf' : 'text/html';
  const btn = $('btn-converter');
  const rotulo = $('btn-converter-rotulo');
  const erroEl = $('erro-conversao');

  erroEl.style.display = 'none';
  erroEl.textContent = '';

  if (!editor.value.trim()) {
    erroEl.textContent = 'O editor está vazio — cole o Markdown antes de converter.';
    erroEl.style.display = 'block';
    return;
  }
  if (btn.disabled) return;   // evita conversões simultâneas (Ctrl+Enter)

  // 1. Markdown final: YAML reconstruído a partir dos campos da interface
  const markdownFinal = mergeMarkdown(editor.value, campos);
  ultimoNomeArquivo = slug(campos.titulo) + '.' + formato;
  ultimoArquivo = null;

  btn.disabled = true;
  rotulo.innerHTML = '<span class="spinner"></span>&nbsp;Convertendo&hellip;';

  try {
    // 2. Conversão Markdown → PDF/HTML na API mkd-pandoc
    statusProgresso('Convertendo Markdown em ' + formato.toUpperCase() + '…');
    let resposta;
    try {
      resposta = await fetch(cfg.endpoint + '/converter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': cfg.apiKey
        },
        body: JSON.stringify({ markdown: markdownFinal, formato: formato })
      });
    } catch (e) {
      throw new Error('Não foi possível conectar à API em ' + cfg.endpoint +
                      ' — verifique o endpoint e o CORS do servidor.');
    }
    if (!resposta.ok) throw new Error(await lerErroHttp(resposta, 'Conversão falhou'));

    const bytes = await resposta.arrayBuffer();
    ultimoArquivo = new Blob([bytes], { type: mime });

    // 3a. SML Storage — URL assinada de upload
    statusProgresso('Solicitando URL de upload (SML Storage)…');
    const headersSml = {
      'Content-Type': 'application/json',
      'x-api-key': cfg.smlApiKey
    };
    const r1 = await fetch(cfg.smlEndpoint + '/getUploadUrl', {
      method: 'POST',
      headers: headersSml,
      body: JSON.stringify({
        projeto: cfg.smlProjeto,
        filename: ultimoNomeArquivo,
        tag1: campos.disciplina || '',
        tag2: campos.turma || '',
        tag3: campos.ano || ''
      })
    });
    const d1 = await r1.json().catch(() => ({}));
    if (!r1.ok || !d1.uploadUrl) {
      throw new Error('getUploadUrl: ' + (d1.error || 'HTTP ' + r1.status));
    }

    // 3b. PUT dos bytes na URL assinada
    statusProgresso('Enviando ' + formato.toUpperCase() + ' para o armazenamento…');
    const r2 = await fetch(d1.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mime },
      body: ultimoArquivo
    });
    if (!r2.ok) throw new Error('Upload falhou (HTTP ' + r2.status + ')');

    // 3c. Confirmação — devolve a URL pública permanente
    statusProgresso('Confirmando upload…');
    const r3 = await fetch(cfg.smlEndpoint + '/confirmUpload', {
      method: 'POST',
      headers: headersSml,
      body: JSON.stringify({ docId: d1.docId })
    });
    const d3 = await r3.json().catch(() => ({}));
    if (!r3.ok || !d3.url) {
      throw new Error('confirmUpload: ' + (d3.error || 'HTTP ' + r3.status));
    }

    // 4. Resultado + histórico
    const tamanho = d3.size || ultimoArquivo.size;
    statusSucesso(d3.url, tamanho, formato);
    adicionarHistorico({
      nome: ultimoNomeArquivo,
      url: d3.url,
      formato: formato,
      tamanho: tamanho,
      data: new Date().toISOString()
    });
  } catch (erro) {
    const msg = erro.message || String(erro);
    statusErro(msg);
    erroEl.textContent = msg;
    erroEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    atualizarRotuloConverter();
  }
}

$('btn-converter').addEventListener('click', converter);

/* ════════════════════════════════════════════════════════════════
   INICIALIZAÇÃO
═════════════════════════════════════════════════════════════════ */
const EXEMPLO = [
  '---',
  'turma: 1TACM1-M2',
  'disciplina: Parasitologia',
  'professor: Lucas Batista',
  'capitulo: "1"',
  'titulo: "O que é Parasitologia?"',
  'subtitulo: "Conceitos e classificação"',
  'unidade: Unidade 1',
  'ano: "2025"',
  '---',
  '',
  '## Introdução',
  '',
  'A **Parasitologia** estuda os organismos que vivem às custas de outros.',
  '',
  '::: conceito',
  '**Parasitismo** é uma relação ecológica desarmônica onde o parasita',
  'obtém benefício às custas do hospedeiro.',
  ':::',
  '',
  '::: dica',
  'O Hospedeiro **D**efinitivo tem o parasita **D**esenvolvido (adulto).',
  ':::',
  ''
].join('\n');

carregarConfig();
seletorFormato.value = localStorage.getItem('mkd_formato') || 'pdf';
atualizarRotuloConverter();
editor.value = localStorage.getItem('mkd_last_md') || EXEMPLO;
sincronizarCamposComYaml();
atualizarPreview();
atualizarCodigoBruto();
atualizarContador();
renderizarHistorico();
statusOcioso();
