# MaGames IA Offline

Chat de IA que roda **100% no celular**, dentro do Chrome. Depois de baixar o modelo uma vez, funciona **sem internet**, **de graça** e **sem enviar nada para servidor nenhum**.

👉 **Abrir:** https://magames075-lgtm.github.io/magames-ia-offline/

## Como usar no Android
1. Abra o link no **Chrome** (de preferência no Wi-Fi).
2. Escolha um modelo e toque em **Baixar e usar** (só na primeira vez).
3. Toque em ⋮ → **Instalar app** / **Adicionar à tela inicial**. Pronto: abre como aplicativo, até no modo avião.

## Modelos (GGUF Q4_K_M, baixados do Hugging Face)
| Opção | Modelo | Download | RAM ideal |
|---|---|---|---|
| **Leve (rápido)** — recomendado | Gemma 3 1B Instruct | ~770 MB | 3–4 GB |
| **Melhor (precisa de mais RAM)** | Qwen3.5 2B | ~1,2 GB | 6 GB+ |
| **Mini (celular fraco)** | Qwen3.5 0.8B | ~510 MB | 2–3 GB (erra mais em fatos) |

## Como funciona
- Motor: [wllama](https://github.com/ngxson/wllama) 3.8.1 (llama.cpp em WebAssembly). Usa vários núcleos quando o navegador permite (o service worker liga o *cross-origin isolation*), senão 1 núcleo. Em Chrome antigo (sem JSPI/Memory64) usa o build “compat”, mais lento. GPU (WebGPU) é opcional e experimental.
- O modelo fica guardado no armazenamento do navegador (OPFS). O app (HTML/JS/wasm) fica no cache do service worker.
- Conversas ficam só no aparelho (localStorage).
- Nada é pago, sem chaves, sem servidor próprio. Hospedagem: GitHub Pages.

## Limites
- É um modelo pequeno: pode errar fatos, datas e contas. Não substitui pesquisa.
- A velocidade depende do celular (CPU). A primeira resposta demora alguns segundos para “ler” a pergunta.
- Precisa de espaço livre (modelo + ~30 MB do app). Se o Android limpar os dados do Chrome, o modelo é baixado de novo.

## Licenças
Código do app: MIT. wllama: MIT (`vendor/`). Modelos: Gemma (Gemma Terms of Use, Google), Qwen3.5 (Apache 2.0, Alibaba) — baixados direto do Hugging Face pelo usuário.

Feito por **MaGames** — Maicon Vieira Gonçalves.
