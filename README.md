# MKD Conversor — CETEP-LNAB

**Interface web para a API mkd-pandoc + SML Storage**

Página HTML estática que funciona como cliente visual de dois backends:

1. **API mkd-pandoc** (`/converter`) — converte Markdown em PDF ou HTML
   usando o pipeline Pandoc + template `cetep.html` + Chromium headless.
2. **SML Storage API** — armazena o arquivo gerado e devolve uma URL
   pública permanente.

Não requer servidor próprio nem build: funciona aberta diretamente no
browser (`file://`) ou servida de qualquer origem estática (GitHub Pages,
Nginx, etc.).

---

## Sumário

1. [Como usar](#como-usar)
2. [Estrutura do projeto](#estrutura-do-projeto)
3. [Layout da interface](#layout-da-interface)
4. [Seções do painel esquerdo](#seções-do-painel-esquerdo)
5. [Preview ao vivo](#preview-ao-vivo)
6. [Fluxo de conversão e upload](#fluxo-de-conversão-e-upload)
7. [Atalhos de teclado](#atalhos-de-teclado)
8. [Persistência (localStorage)](#persistência-localstorage)
9. [Tecnologias](#tecnologias)
10. [Limitações conhecidas](#limitações-conhecidas)

---

## Como usar

1. Abra o `index.html` no Chrome/Edge (duplo clique resolve).
2. Na seção **Conexão**, informe o endpoint da API mkd-pandoc, a API Key
   e as credenciais da SML Storage. Clique em **Salvar configurações**.
3. Use **Testar conexão** para verificar se a API está acessível
   (chama a rota pública `GET /saude`).
4. Cole (ou arraste um arquivo `.md` para) o editor. O bloco YAML do
   documento preenche automaticamente os campos de cabeçalho.
5. Ajuste os campos se necessário e clique em **Converter para PDF**
   (ou selecione **HTML** no seletor ao lado).
6. A barra de status no rodapé mostra o progresso e, ao final, a URL
   pública com botões **Download**, **Copiar link** e **Abrir**.

> **CORS:** como a página roda fora do domínio da API, o servidor
> FastAPI precisa permitir requisições cross-origin (CORSMiddleware).
> Sem isso o browser bloqueia a chamada ao `/converter`.

---

## Estrutura do projeto

```
mdk-pdf/
├── index.html        ← marcação da página (única entrada)
├── css/
│   └── estilos.css   ← estilos da UI + aproximação visual do cetep.html
├── js/
│   └── app.js        ← toda a lógica (vanilla JS, sem dependências locais)
└── LICENSE
```

---

## Layout da interface

```
┌────────────────────────────────────────────────────────────────┐
│  CABEÇALHO  (logo CETEP + "MKD Conversor")                     │
├──────────────────────────┬─────────────────────────────────────┤
│  PAINEL ESQUERDO         │  PAINEL DIREITO                     │
│  [Conexão]               │  [Abas: Preview | Código bruto]     │
│  [Cabeçalho do documento]│                                     │
│  [Rodapé do documento]   │  Renderização ao vivo               │
│  [Editor Markdown]       │  (marked.js + mermaid.js)           │
│  [Formato + Converter]   │                                     │
│  [Histórico]             │                                     │
├──────────────────────────┴─────────────────────────────────────┤
│  BARRA DE STATUS  (progresso / URL gerada + ações)             │
└────────────────────────────────────────────────────────────────┘
```

Em telas ≤ 768 px as colunas empilham (editor em cima, preview embaixo).

---

## Seções do painel esquerdo

### Conexão

| Campo | Padrão |
|---|---|
| Endpoint da API | `http://localhost:8000` |
| API Key (mkd-pandoc) | — |
| SML Storage Endpoint | `https://us-east1-sml-storage.cloudfunctions.net` |
| SML API Key | — |
| SML Projeto | `mkd-pandoc` |

As API keys têm botão 👁 para revelar/ocultar. **Salvar configurações**
persiste tudo no `localStorage`; **Testar conexão** consulta `GET /saude`.

### Cabeçalho do documento

Campos que correspondem às variáveis do front matter YAML do template
Pandoc (`cetep.html`): `turma`, `disciplina`, `professor`, `capitulo`,
`apontamento`, `titulo`, `subtitulo`, `unidade`, `ano`.

- Ao colar um Markdown com bloco `---` YAML, os campos são preenchidos
  automaticamente.
- Se um campo for editado manualmente, o valor digitado **sobrepõe** o
  do YAML — o Markdown enviado à API é regenerado com o front matter
  atualizado.
- `capitulo` e `apontamento` são mutuamente exclusivos: preencher um
  limpa o outro.

### Rodapé do documento

Três linhas montadas automaticamente a partir do cabeçalho (exibidas
como placeholder). Se o usuário digitar um valor, ele é injetado no
front matter como `rodape1`, `rodape2` ou `rodape3`.

### Editor Markdown

- Fonte monoespaçada, ~40 vh, redimensionável verticalmente.
- Preview atualiza com debounce de 600 ms (sem chamadas de rede).
- Rascunho salvo automaticamente no `localStorage`.
- **Abrir**: carrega um `.md` (botão ou arrastar-e-soltar no editor).
- **⬇ .md**: baixa o Markdown com o YAML regenerado pelos campos.
- **Limpar**: zera editor e campos (com confirmação).
- **`</>` Código**: alterna o painel direito entre Preview e Código bruto.
- Contador de palavras/caracteres e horário do último rascunho salvo.

### Converter

Seletor de formato (**PDF** ou **HTML** — a escolha fica persistida) +
botão de conversão. Durante o processamento mostra spinner; erros
aparecem em vermelho com a mensagem do servidor.

### Histórico

Lista das últimas 10 conversões (nome, formato, tamanho, data e URL
pública) com botão de copiar link. Persistido no `localStorage`.

---

## Preview ao vivo

O preview é renderizado **localmente** com marked.js — é uma
**aproximação** do visual do template `cetep.html`, não uma reprodução
exata (quem dá a palavra final é o Pandoc + Chromium no servidor).

O que o preview reproduz:

- Tipografia Nunito/Poppins e paleta institucional.
- Badge de capítulo/apontamento, título e subtítulo (a partir dos campos).
- Os 9 blocos fenced div do template, com cores e rótulos idênticos:

| Marcador | Cor | Rótulo |
|---|---|---|
| `::: conceito` | Azul | CONCEITO-CHAVE |
| `::: dica` | Laranja/Amarelo | DICA DE OURO |
| `::: atencao` | Vermelho | ATENÇÃO |
| `::: exemplo` | Verde | EXEMPLO PRÁTICO |
| `::: reflexao` | Roxo | CONVITE À REFLEXÃO |
| `::: saibamais` | Teal | SAIBA MAIS |
| `::: exercicios` | Âmbar | EXERCÍCIOS DE FIXAÇÃO |
| `::: leitura` | Rosa | LEITURA RECOMENDADA |
| `::: referencias` | Cinza | BIBLIOGRAFIA |

- Diagramas ` ```mermaid ` renderizados com mermaid.js.
- Tabelas com bordas finas; imagens com fallback para placeholder cinza
  (com o texto alternativo) quando a URL falha (404/CORS).

A aba **Código bruto** exibe o Markdown original sem processamento, com
botão **Copiar**.

### Diferenças conhecidas em relação ao PDF final

- Numeração automática dos `h2` (círculos azuis) só existe no template real.
- Cabeçalho institucional e rodapé do documento não aparecem no preview.
- Margens A4, quebras de página e atributos Pandoc como `{width=300px}`
  só são aplicados na conversão real.

---

## Fluxo de conversão e upload

```
1. Monta o Markdown final
   └─ Remove o bloco YAML original e injeta o front matter
      reconstruído a partir dos campos da interface
2. POST {endpoint}/converter
   Headers: X-API-Key
   Body: { "markdown": "...", "formato": "pdf" | "html" }
   → bytes do arquivo
3. Upload para a SML Storage (3 passos)
   a) POST /getUploadUrl  { projeto, filename, tag1: disciplina,
                            tag2: turma, tag3: ano }  → { uploadUrl, docId }
   b) PUT  {uploadUrl}    (Content-Type: application/pdf | text/html)
   c) POST /confirmUpload { docId }  → { url, size }
4. Barra de status: ✓ PDF gerado — tamanho
   [ Download ] [ Copiar link ] [ Abrir ]
```

Se a conversão funcionar mas o upload falhar, o estado de erro ainda
oferece o **Download** local do arquivo gerado, além de **Tentar novamente**.

---

## Atalhos de teclado

| Atalho | Ação |
|---|---|
| `Ctrl+Enter` | Converter |
| `Ctrl+S` | Baixar o `.md` com o YAML atualizado |
| `Tab` (no editor) | Indenta com 2 espaços |

---

## Persistência (localStorage)

| Chave | Conteúdo |
|---|---|
| `mkd_config` | Endpoints, API keys e projeto SML |
| `mkd_last_md` | Último Markdown editado (restaurado ao reabrir) |
| `mkd_formato` | Último formato de saída escolhido (pdf/html) |
| `mkd_historico` | Últimas 10 conversões (nome, URL, tamanho, data) |

Os campos de cabeçalho **não** são persistidos — são relidos do YAML do
documento a cada edição.

---

## Tecnologias

| Biblioteca | Origem | Uso |
|---|---|---|
| marked.js 12 | cdnjs | Markdown → HTML no preview |
| mermaid.js 10 | cdnjs | Diagramas no preview |
| Nunito + Poppins | Google Fonts | Tipografia |

HTML + CSS + JavaScript vanilla. Sem frameworks, sem Node.js, sem build.

---

## Limitações conhecidas

- O preview usa marked.js, não o Pandoc — pequenas diferenças de
  interpretação de sintaxe são esperadas (ver seção do preview).
- A API mkd-pandoc precisa de CORS habilitado para receber chamadas
  da página.
- O parser de YAML do front matter é simplificado (pares `chave: valor`
  em linha única); estruturas aninhadas não são suportadas — o que cobre
  todas as variáveis usadas pelo template `cetep.html`.

---

## Projetos relacionados

- [`mkd-pandoc`](https://github.com/projetos-ept/mkd-pandoc) — pipeline
  de conversão (Pandoc + template `cetep.html` + Playwright) e API HTTP.
